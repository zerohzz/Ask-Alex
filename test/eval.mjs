// Retrieval eval harness — scores retrieval quality with a labeled question set
// so retrieval changes become numbers, not vibes. Calls retrieve() in-process
// (read-only SELECTs) and reports recall@k and MRR@k, A/B'ing dense-only vs
// hybrid (dense + full-text RRF) side by side, with a per-class breakdown
// (direct / paraphrase / colloquial / ambiguous / exact) and a negative-
// rejection rate over out-of-scope queries.
//
//   tsx test/eval.mjs              # A/B dense vs hybrid, k=5
//   K=3 tsx test/eval.mjs          # change cutoff
//
// Requires the same env as the app (.env with PG_CONNECTION_STRING + Vertex ADC).
// Read-only: no writes, no schema DDL. Hybrid rows need the content_tsv column
// (run the app / ingest once to migrate); without it, retrieve() logs a fallback
// and hybrid == dense here.
import { retrieve } from "../src/rag.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";

const K = Number(process.env.K ?? 5);

// Labeled set: natural-language question → substring(s) of the expected doc
// title. A retrieval "hits" if any expected substring appears in a returned
// chunk's title. Every question is derived FROM the corpus content — no invented
// facts about Alex — and its `cls` tags how it stresses retrieval:
//   direct     — phrasing that shares words with the target doc's title (easy baseline)
//   paraphrase — describes the problem with NO significant title words in common
//   colloquial — how a recruiter / non-expert asks (vague-but-valid)
//   ambiguous  — must pick the right doc among topically adjacent neighbours
//   exact      — exact-token queries (error codes, API snippets) where dense
//                embeddings blur the term and full-text should recover it
// A few colloquial/soft questions legitimately map to more than one doc (the
// question spans the About / Principles / Solution-Design area); those list
// every genuinely-best doc, and any one of them in the top-k counts as a hit.
const LABELED = [
  // ============================ direct ============================
  // Natural-language questions that share vocabulary with the target title.
  { cls: "direct", q: "How do I fix UNABLE_TO_LOCK_ROW errors?", expect: ["UNABLE_TO_LOCK_ROW"] },
  { cls: "direct", q: "How do I avoid hitting Salesforce governor limits?", expect: ["Governor Limit"] },
  { cls: "direct", q: "How do I bulkify an Apex trigger?", expect: ["Bulkifying Apex Triggers"] },
  { cls: "direct", q: "When should I use Queueable versus Batch Apex?", expect: ["Queueable, Future, and Batch"] },
  { cls: "direct", q: "How do I stop a trigger from firing twice?", expect: ["Trigger Recursion"] },
  { cls: "direct", q: "How do I write selective SOQL queries?", expect: ["SOQL Best Practices"] },
  { cls: "direct", q: "How do I make recalculation logic idempotent?", expect: ["Idempotent"] },
  { cls: "direct", q: "How should I sync child records without deleting them?", expect: ["Reconcile Instead of Delete"] },
  { cls: "direct", q: "How do I authenticate a CI pipeline to Salesforce with JWT?", expect: ["JWT Connected-App Auth"] },
  { cls: "direct", q: "How do I do delta deployments in CI?", expect: ["Delta Deployments"] },
  { cls: "direct", q: "What does your Salesforce CI/CD pipeline architecture look like?", expect: ["Two-Pipeline"] },
  { cls: "direct", q: "How do I seed a sandbox with masked data?", expect: ["Seeding Sandboxes"] },
  { cls: "direct", q: "How do I call an external REST API from Apex safely?", expect: ["REST Callouts with Named Credentials"] },
  { cls: "direct", q: "How do I integrate an external tax engine across states?", expect: ["External Tax Engine"] },
  { cls: "direct", q: "How do I handle 3DS async payment confirmation?", expect: ["Async Payment Confirmation"] },
  { cls: "direct", q: "How do I audit connected apps for OAuth compliance?", expect: ["Connected Apps for OAuth"] },
  { cls: "direct", q: "How do I build a multi-step wizard in LWC?", expect: ["Multi-Step LWC Wizard"] },
  { cls: "direct", q: "How do I preserve a user's manual overrides across re-saves?", expect: ["Preserving Manual Overrides"] },
  { cls: "direct", q: "How do I gate downstream automation on async completion?", expect: ["Gating Downstream Automation"] },
  { cls: "direct", q: "What is the Ralph loop for AI development?", expect: ["Ralph Loop"] },
  { cls: "direct", q: "How do you orchestrate multiple AI agents with clear roles?", expect: ["Multi-Agent Orchestration"] },
  { cls: "direct", q: "How should an agent context file be treated?", expect: ["Agent Context File as a Contract"] },
  { cls: "direct", q: "How do you route edits through validator hooks?", expect: ["Validator Hooks"] },
  { cls: "direct", q: "Should I reuse record types or rebuild them?", expect: ["Reusing Record Types"] },
  { cls: "direct", q: "How do you run end-to-end browser tests for Salesforce UIs?", expect: ["End-to-End Browser Testing"] },
  { cls: "direct", q: "Who is Alex Huang?", expect: ["About Alex"] },
  { cls: "direct", q: "What are Alex's core engineering principles?", expect: ["Engineering Principles"] },

  // ========================= paraphrase ==========================
  // Describe the problem; share no significant words with the target title.
  { cls: "paraphrase", q: "Two jobs updating the same account keep failing intermittently.", expect: ["UNABLE_TO_LOCK_ROW"] },
  { cls: "paraphrase", q: "Which per-transaction ceilings do Salesforce jobs slam into most, and how do I get under them?", expect: ["Governor Limit"] },
  { cls: "paraphrase", q: "My trigger works on one record but dies when Data Loader sends a batch.", expect: ["Bulkifying Apex Triggers"] },
  { cls: "paraphrase", q: "The same automation re-enters and runs my logic a second time within one transaction.", expect: ["Trigger Recursion"] },
  { cls: "paraphrase", q: "I want my recompute to be safe to run repeatedly and skip work when the inputs haven't changed.", expect: ["Idempotent"] },
  { cls: "paraphrase", q: "I need to process a few million records overnight without blowing limits.", expect: ["Queueable, Future, and Batch"] },
  { cls: "paraphrase", q: "My query scans too many rows and throws a non-selective error.", expect: ["SOQL Best Practices"] },
  { cls: "paraphrase", q: "Refreshing the line items wipes their created dates and history every time.", expect: ["Reconcile Instead of Delete"] },
  { cls: "paraphrase", q: "A user sets a time, then adds an item and their edit disappears on reload.", expect: ["Preserving Manual Overrides"] },
  { cls: "paraphrase", q: "My pipeline can't log in to the org without a human clicking through a browser.", expect: ["JWT Connected-App Auth"] },
  { cls: "paraphrase", q: "Where should I keep the endpoint URL and API key so they're not hardcoded in Apex?", expect: ["REST Callouts with Named Credentials"] },
  { cls: "paraphrase", q: "We operate in several states and hardcoding sales-tax rates has become unmanageable.", expect: ["External Tax Engine"] },
  { cls: "paraphrase", q: "Customers get a paid-confirmation email before the bank finishes authenticating them.", expect: ["Async Payment Confirmation"] },
  { cls: "paraphrase", q: "How do I inventory every third-party app that can log into our org and verify its security settings?", expect: ["Connected Apps for OAuth"] },
  { cls: "paraphrase", q: "I'm building a checkout across several screens and one component is becoming a monster.", expect: ["Multi-Step LWC Wizard"] },
  { cls: "paraphrase", q: "How do I load production-like data into QA without leaking real customer PII?", expect: ["Seeding Sandboxes"] },
  { cls: "paraphrase", q: "My Playwright tests against the Salesforce UI are flaky and keep re-logging in.", expect: ["End-to-End Browser Testing"] },
  { cls: "paraphrase", q: "A new brand needs almost the same record type — do I fork the flows or extend them?", expect: ["Reusing Record Types"] },
  { cls: "paraphrase", q: "A confirmation doc generates from half-baked values before the background job finishes.", expect: ["Gating Downstream Automation"] },
  { cls: "paraphrase", q: "Can an agent just keep coding on its own until the tests pass, without me babysitting it?", expect: ["Ralph Loop"] },
  { cls: "paraphrase", q: "How do I split a big build across several AI agents so one plans and the others execute?", expect: ["Multi-Agent Orchestration"] },
  { cls: "paraphrase", q: "My always-loaded instructions file is bloated and eating tokens on every turn.", expect: ["Agent Context File as a Contract"] },
  { cls: "paraphrase", q: "I want lint and tests to run automatically after every edit an agent makes.", expect: ["Validator Hooks"] },

  // ========================= colloquial ==========================
  // How a recruiter or non-expert would ask. Vague but genuinely answerable.
  { cls: "colloquial", q: "Has he actually shipped real AI things or just demos?", expect: ["AI & Agentic Engineering"] },
  { cls: "colloquial", q: "Can he work directly with customers, or is he just a coder?", expect: ["About Alex", "Solution Design & Delivery"] },
  { cls: "colloquial", q: "What's he actually like to work with?", expect: ["Engineering Principles", "About Alex"] },
  { cls: "colloquial", q: "Does he know how to ship code without breaking prod?", expect: ["DevOps & Release Management"] },
  { cls: "colloquial", q: "How does he decide things — does he just wing it?", expect: ["Engineering Principles"] },
  { cls: "colloquial", q: "Has he actually led releases, or only written code?", expect: ["DevOps & Release Management"] },
  { cls: "colloquial", q: "Is he a senior engineer or pretty junior?", expect: ["About Alex"] },
  { cls: "colloquial", q: "Can he own something end to end by himself?", expect: ["About Alex"] },
  { cls: "colloquial", q: "Would he be a good fit for a forward deployed engineer role?", expect: ["About Alex"] },
  { cls: "colloquial", q: "Does he write things down, or keep it all in his head?", expect: ["Engineering Principles", "Solution Design & Delivery"] },
  { cls: "colloquial", q: "How does he handle it when a project depends on another team?", expect: ["Engineering Principles", "Solution Design & Delivery"] },
  { cls: "colloquial", q: "Is he up to date with modern AI tooling like RAG and agents?", expect: ["AI & Agentic Engineering"] },
  { cls: "colloquial", q: "How big was the platform he actually ran?", expect: ["About Alex"] },

  // ========================= ambiguous ==========================
  // Must pick the right doc among topically adjacent neighbours.
  { cls: "ambiguous", q: "Which async Apex type should I pick when jobs must run in a strict order and chain?", expect: ["Queueable, Future, and Batch"] },
  { cls: "ambiguous", q: "How do I stop a flow from firing before my Queueable has finished?", expect: ["Gating Downstream Automation"] },
  { cls: "ambiguous", q: "Restructure a trigger that does SOQL and DML inside a for loop over 200 records.", expect: ["Bulkifying Apex Triggers"] },
  { cls: "ambiguous", q: "Make my query selective so it doesn't scan the whole object.", expect: ["SOQL Best Practices"] },
  { cls: "ambiguous", q: "What actually are the per-transaction limits and their numeric thresholds?", expect: ["Governor Limit"] },
  { cls: "ambiguous", q: "Generate a package.xml and destructiveChanges from the git diff between two refs.", expect: ["Delta Deployments"] },
  { cls: "ambiguous", q: "Should validation and deployment be one pipeline or two?", expect: ["Two-Pipeline"] },
  { cls: "ambiguous", q: "My logic runs twice in the same transaction and doubles my rollups.", expect: ["Trigger Recursion"] },
  { cls: "ambiguous", q: "Make the recompute produce the same result no matter how many times it runs across transactions.", expect: ["Idempotent"] },
  { cls: "ambiguous", q: "Serialize concurrent writes to the same parent so they stop deadlocking.", expect: ["UNABLE_TO_LOCK_ROW"] },
  { cls: "ambiguous", q: "Call an external system from Apex without hardcoding the URL and secret.", expect: ["REST Callouts with Named Credentials"] },
  { cls: "ambiguous", q: "Integrate a third-party sales-tax service across multiple operating companies.", expect: ["External Tax Engine"] },
  { cls: "ambiguous", q: "Authenticate CI to Salesforce using a certificate and a private key, no password.", expect: ["JWT Connected-App Auth"] },
  { cls: "ambiguous", q: "Audit which connected apps have PKCE and refresh-token rotation enabled.", expect: ["Connected Apps for OAuth"] },
  { cls: "ambiguous", q: "Don't overwrite a value the user manually set when I refresh the row from the server.", expect: ["Preserving Manual Overrides"] },
  { cls: "ambiguous", q: "Sync child rows from a payload without losing their ids and audit fields.", expect: ["Reconcile Instead of Delete"] },
  { cls: "ambiguous", q: "Keep the always-loaded agent instructions tiny and load the detail on demand.", expect: ["Agent Context File as a Contract"] },
  { cls: "ambiguous", q: "Run a scoring rubric automatically after each file the agent edits.", expect: ["Validator Hooks"] },
  { cls: "ambiguous", q: "Hold the confirmation email until the payment is truly authenticated under 3-D Secure.", expect: ["Async Payment Confirmation"] },

  // =========================== exact =============================
  // Exact-token queries — dense embeddings blur these; full-text should recover.
  { cls: "exact", q: "UNABLE_TO_LOCK_ROW", expect: ["UNABLE_TO_LOCK_ROW"] },
  { cls: "exact", q: "Too many SOQL queries: 101", expect: ["Governor Limit"] },
  { cls: "exact", q: "CPU time limit 10000 ms", expect: ["Governor Limit"] },
  { cls: "exact", q: "Queueable vs Future vs Batch", expect: ["Queueable, Future, and Batch"] },
  { cls: "exact", q: "Too many DML statements: 151", expect: ["Governor Limit"] },
  { cls: "exact", q: "callout:My_Named_Credential/path", expect: ["REST Callouts with Named Credentials"] },
  { cls: "exact", q: "sf org login jwt --jwt-key-file", expect: ["JWT Connected-App Auth"] },
  { cls: "exact", q: "SyntaxError: Invalid regular expression flags", expect: ["JWT Connected-App Auth"] },
  { cls: "exact", q: "sfdx-git-delta", expect: ["Delta Deployments"] },
  { cls: "exact", q: "RunLocalTests check-only deploy", expect: ["Two-Pipeline"] },
  { cls: "exact", q: "storageState auth.json", expect: ["End-to-End Browser Testing"] },
  { cls: "exact", q: "Calc_In_Progress__c flag", expect: ["Gating Downstream Automation"] },
];

// Clearly out-of-scope queries: weather, gossip, medical, other people, and
// coding in stacks not in the corpus. Retrieval should reject these — every
// returned chunk beyond retrievalMaxDistance (only the minKeep survivors, all
// with distance > threshold) → the app escalates instead of forcing an answer.
const NEGATIVES = [
  "What's the weather in Tokyo tomorrow?",
  "Who won the latest season of The Bachelor?",
  "What are the symptoms of the flu and should I see a doctor?",
  "Write me a Rust program that parses a CSV file.",
  "Who is Taylor Swift currently dating?",
  "What's a good recipe for spaghetti carbonara?",
  "How do I train a PyTorch neural network from scratch?",
  "What is the capital of France?",
  "Explain the plot of the movie Oppenheimer.",
  "How do I fix a leaking kitchen faucet?",
  "Summarise Barack Obama's presidency.",
  "How do I bake sourdough bread at home?",
];

const CLASSES = ["direct", "paraphrase", "colloquial", "ambiguous", "exact"];

const norm = (s) => s.toLowerCase();
/** 1-based rank of the first chunk whose title matches an expected substring, else 0. */
function firstHitRank(chunks, expect) {
  const wants = expect.map(norm);
  for (let i = 0; i < chunks.length; i++) {
    const title = norm(chunks[i].docTitle);
    if (wants.some((w) => title.includes(w))) return i + 1;
  }
  return 0;
}

/** Score every labeled case for one retrieval mode; bucket results by class. */
async function scoreMode(hybrid) {
  let hits = 0;
  let rrSum = 0;
  const misses = [];
  const perClass = Object.fromEntries(CLASSES.map((c) => [c, { hits: 0, rrSum: 0, n: 0 }]));
  for (const item of LABELED) {
    const chunks = await retrieve(item.q, K, undefined, { hybrid });
    const rank = firstHitRank(chunks, item.expect);
    const bucket = perClass[item.cls];
    bucket.n += 1;
    if (rank > 0) {
      hits += 1;
      rrSum += 1 / rank;
      bucket.hits += 1;
      bucket.rrSum += 1 / rank;
    } else {
      misses.push({
        q: item.q,
        cls: item.cls,
        expect: item.expect,
        got: chunks.slice(0, 3).map((c) => c.docTitle),
      });
    }
  }
  const n = LABELED.length;
  return { recall: hits / n, mrr: rrSum / n, hits, n, misses, perClass };
}

/**
 * Negative-rejection rate: fraction of out-of-scope queries where retrieve()
 * returns NO chunk within config.retrievalMaxDistance (i.e. only the minKeep
 * survivors, all past the threshold → the app escalates). Retrieval is mode-
 * independent here for the threshold check; we run it in the mode under test.
 */
async function negativeRejection(hybrid) {
  let rejected = 0;
  const leaks = [];
  for (const q of NEGATIVES) {
    const chunks = await retrieve(q, K, undefined, { hybrid });
    const within = chunks.filter((c) => c.distance <= config.retrievalMaxDistance);
    if (within.length === 0) {
      rejected += 1;
    } else {
      leaks.push({ q, within: within.map((c) => `${c.docTitle} (${c.distance.toFixed(3)})`) });
    }
  }
  return { rate: rejected / NEGATIVES.length, rejected, n: NEGATIVES.length, leaks };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  console.log(
    `\nRetrieval eval → recall@${K} / MRR@${K} over ${LABELED.length} labeled queries` +
      ` + ${NEGATIVES.length} negatives\n${"=".repeat(70)}`,
  );

  const dense = await scoreMode(false);
  const hybrid = await scoreMode(true);

  const row = (label, r) =>
    `${label.padEnd(10)} recall@${K}=${pct(r.recall).padStart(6)}   MRR@${K}=${r.mrr.toFixed(3)}   (${r.hits}/${r.n})`;
  console.log(row("dense", dense));
  console.log(row("hybrid", hybrid));
  const dR = hybrid.recall - dense.recall;
  const dM = hybrid.mrr - dense.mrr;
  console.log(`${"-".repeat(70)}`);
  console.log(`delta      recall ${dR >= 0 ? "+" : ""}${pct(dR)}   MRR ${dM >= 0 ? "+" : ""}${dM.toFixed(3)}`);

  // Per-class breakdown, dense vs hybrid side by side.
  console.log(`\nPer-class recall@${K} / MRR@${K}  (dense → hybrid)\n${"-".repeat(70)}`);
  const cell = (b) => `${pct(b.hits / b.n).padStart(6)} / ${(b.rrSum / b.n).toFixed(3)}`;
  for (const c of CLASSES) {
    const d = dense.perClass[c];
    const h = hybrid.perClass[c];
    if (d.n === 0) continue;
    console.log(`  ${c.padEnd(11)} (n=${String(d.n).padStart(2)})  ${cell(d)}   →   ${cell(h)}`);
  }

  // Negative-rejection rate (higher = fewer out-of-scope answers forced).
  const negDense = await negativeRejection(false);
  const negHybrid = await negativeRejection(true);
  console.log(`\nNegative-rejection rate  (out-of-scope queries yielding empty in-scope context)\n${"-".repeat(70)}`);
  console.log(`  dense   ${pct(negDense.rate).padStart(6)}   (${negDense.rejected}/${negDense.n})`);
  console.log(`  hybrid  ${pct(negHybrid.rate).padStart(6)}   (${negHybrid.rejected}/${negHybrid.n})`);
  for (const [label, neg] of [["dense", negDense], ["hybrid", negHybrid]]) {
    for (const leak of neg.leaks) {
      console.log(`    [${label}] LEAK: "${leak.q}"\n            within threshold: ${leak.within.join(" | ")}`);
    }
  }

  const report = (label, r) => {
    if (r.misses.length === 0) return;
    console.log(`\n${label} misses (${r.misses.length}):`);
    for (const m of r.misses) {
      console.log(
        `  [${m.cls}] ${m.q}\n     expected: ${m.expect.join(" / ")}\n     got: ${m.got.join(" | ") || "(none)"}`,
      );
    }
  };
  report("dense", dense);
  report("hybrid", hybrid);

  console.log("");
  await pool.end();
  // Fail CI if hybrid regresses overall recall vs dense.
  process.exit(hybrid.recall + 1e-9 >= dense.recall ? 0 : 1);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
