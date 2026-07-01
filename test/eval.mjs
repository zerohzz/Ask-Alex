// Retrieval eval harness — scores retrieval quality with a labeled question set
// so retrieval changes become numbers, not vibes. Calls retrieve() in-process
// (read-only SELECTs) and reports recall@k and MRR@k, A/B'ing dense-only vs
// hybrid (dense + full-text RRF) side by side.
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

const K = Number(process.env.K ?? 5);

// Labeled set: natural-language question → substring(s) of the expected doc
// title. A retrieval "hits" if any expected substring appears in a returned
// chunk's title. `exact` cases are exact-token queries (error codes, limits)
// where dense embeddings blur the term and full-text should recover it.
const LABELED = [
  // --- natural-language questions ---
  { q: "How do I fix UNABLE_TO_LOCK_ROW errors?", expect: ["UNABLE_TO_LOCK_ROW"] },
  { q: "How do I avoid hitting Salesforce governor limits?", expect: ["Governor Limit"] },
  { q: "How do I bulkify an Apex trigger?", expect: ["Bulkifying Apex Triggers"] },
  { q: "When should I use Queueable versus Batch Apex?", expect: ["Queueable, Future, and Batch"] },
  { q: "How do I stop a trigger from firing twice?", expect: ["Trigger Recursion"] },
  { q: "How do I write selective SOQL queries?", expect: ["SOQL Best Practices"] },
  { q: "How do I make recalculation logic idempotent?", expect: ["Idempotent"] },
  { q: "How should I sync child records without deleting them?", expect: ["Reconcile Instead of Delete"] },
  { q: "How do I authenticate a CI pipeline to Salesforce with JWT?", expect: ["JWT Connected-App Auth"] },
  { q: "How do I do delta deployments in CI?", expect: ["Delta Deployments"] },
  { q: "What does your Salesforce CI/CD pipeline architecture look like?", expect: ["Two-Pipeline"] },
  { q: "How do I seed a sandbox with masked data?", expect: ["Seeding Sandboxes"] },
  { q: "How do I call an external REST API from Apex safely?", expect: ["REST Callouts with Named Credentials"] },
  { q: "How do I integrate an external tax engine across states?", expect: ["External Tax Engine"] },
  { q: "How do I handle 3DS async payment confirmation?", expect: ["Async Payment Confirmation"] },
  { q: "How do I audit connected apps for OAuth compliance?", expect: ["Connected Apps for OAuth"] },
  { q: "How do I build a multi-step wizard in LWC?", expect: ["Multi-Step LWC Wizard"] },
  { q: "How do I preserve a user's manual overrides across re-saves?", expect: ["Preserving Manual Overrides"] },
  { q: "How do I gate downstream automation on async completion?", expect: ["Gating Downstream Automation"] },
  { q: "What is the Ralph loop for AI development?", expect: ["Ralph Loop"] },
  { q: "How do you orchestrate multiple AI agents with clear roles?", expect: ["Multi-Agent Orchestration"] },
  { q: "How should an agent context file be treated?", expect: ["Agent Context File as a Contract"] },
  { q: "How do you route edits through validator hooks?", expect: ["Validator Hooks"] },
  { q: "Should I reuse record types or rebuild them?", expect: ["Reusing Record Types"] },
  { q: "How do you run end-to-end browser tests for Salesforce UIs?", expect: ["End-to-End Browser Testing"] },
  { q: "Who is Alex Huang?", expect: ["About Alex"] },
  { q: "What are Alex's core engineering principles?", expect: ["Engineering Principles"] },
  // --- exact-token queries (dense-blur cases; full-text should recover) ---
  { q: "UNABLE_TO_LOCK_ROW", expect: ["UNABLE_TO_LOCK_ROW"], exact: true },
  { q: "Too many SOQL queries: 101", expect: ["Governor Limit"], exact: true },
  { q: "CPU time limit 10000 ms", expect: ["Governor Limit"], exact: true },
  { q: "Queueable vs Future vs Batch", expect: ["Queueable, Future, and Batch"], exact: true },
];

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

async function scoreMode(hybrid) {
  let hits = 0;
  let rrSum = 0;
  const misses = [];
  for (const item of LABELED) {
    const chunks = await retrieve(item.q, K, undefined, { hybrid });
    const rank = firstHitRank(chunks, item.expect);
    if (rank > 0) {
      hits += 1;
      rrSum += 1 / rank;
    } else {
      misses.push({ q: item.q, exact: !!item.exact, got: chunks.slice(0, 3).map((c) => c.docTitle) });
    }
  }
  const n = LABELED.length;
  return { recall: hits / n, mrr: rrSum / n, hits, n, misses };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  console.log(`\nRetrieval eval → recall@${K} / MRR@${K} over ${LABELED.length} labeled queries\n${"=".repeat(70)}`);

  const dense = await scoreMode(false);
  const hybrid = await scoreMode(true);

  const row = (label, r) => `${label.padEnd(10)} recall@${K}=${pct(r.recall).padStart(6)}   MRR@${K}=${r.mrr.toFixed(3)}   (${r.hits}/${r.n})`;
  console.log(row("dense", dense));
  console.log(row("hybrid", hybrid));
  const dR = hybrid.recall - dense.recall;
  const dM = hybrid.mrr - dense.mrr;
  console.log(`${"-".repeat(70)}`);
  console.log(`delta      recall ${dR >= 0 ? "+" : ""}${pct(dR)}   MRR ${dM >= 0 ? "+" : ""}${dM.toFixed(3)}`);

  const report = (label, r) => {
    if (r.misses.length === 0) return;
    console.log(`\n${label} misses (${r.misses.length}):`);
    for (const m of r.misses) console.log(`  ${m.exact ? "[exact] " : ""}${m.q}\n     got: ${m.got.join(" | ") || "(none)"}`);
  };
  report("dense", dense);
  report("hybrid", hybrid);

  console.log("");
  await pool.end();
  // Fail CI if hybrid regresses recall vs dense.
  process.exit(hybrid.recall + 1e-9 >= dense.recall ? 0 : 1);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
