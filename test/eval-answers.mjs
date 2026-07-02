// Answer-faithfulness + escalation eval — the layer eval.mjs (retrieval) and
// golden.mjs (regex ACs) don't cover: does the GENERATED answer stay grounded
// in what was retrieved, cite honestly, and escalate on the right questions?
//
// Runs runChat() in-process (like eval.mjs imports retrieve), captures each
// answer + its sources, then:
//   • MECHANICAL (hard gates, set the exit code): every inline [n] maps to a
//     listed source; answerable questions must NOT escalate; out-of-scope
//     questions must escalate OR refuse without citing.
//   • JUDGE (dashboard only, never gates until calibrated): a cheap LLM judge
//     (gemini-2.5-flash-lite, temp 0, strict JSON) scores groundedness (fraction
//     of the answer's factual claims supported by the retrieved chunk texts),
//     citation precision (does source [n] actually support its sentence), and
//     whether the answer is substantive rather than a hedge.
//
//   PG_OVER_WEBSOCKET=1 DISABLE_CONVERSATION_LOG=1 SKIP_SCHEMA_INIT=1 \
//     npx tsx test/eval-answers.mjs
//
// Read-only against the shared DB (runChat only SELECTs; conversation logging is
// disabled). Judge chunk texts come from a one-time read of kb_chunks by title.
import { Type } from "@google/genai";
import { runChat } from "../src/chat.js";
import { ai } from "../src/genai.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gemini-2.5-flash-lite";

// ---------------------------------------------------------------------------
// Question sets. Answerable questions span the Task-1 retrieval classes and
// include two multi-turn histories (exercise the condense path) and two
// soft/fit-style questions. Every answerable question is genuinely covered by
// the corpus; every out-of-scope one genuinely is not.
// ---------------------------------------------------------------------------

/** history is a full ChatTurn[] (multi-turn); q is shorthand for a single user turn. */
const ANSWERABLE = [
  { cls: "direct", q: "How do I avoid hitting Salesforce governor limits?" },
  { cls: "paraphrase", q: "My trigger works on one record but dies when Data Loader sends a batch of 200." },
  { cls: "ambiguous", q: "Audit which connected apps have PKCE and refresh-token rotation enabled." },
  { cls: "colloquial", q: "Has Alex actually shipped real AI work, or just demos?" },
  { cls: "exact", q: "How do I resolve UNABLE_TO_LOCK_ROW errors?" },
  { cls: "direct", q: "Who is Alex Huang?" },
  { cls: "direct", q: "How do I do delta deployments in CI?" },
  { cls: "paraphrase", q: "Customers get a paid-confirmation email before the bank finishes authenticating them." },
  { cls: "direct", q: "How do I make recalculation logic idempotent?" },
  { cls: "direct", q: "What are Alex's core engineering principles?" },
  // soft / fit-style
  { cls: "soft", q: "Is Alex a good culture fit for a small, fast-moving startup team?" },
  { cls: "soft", q: "Would Alex be a good fit for a Forward Deployed Engineer role landing LLMs in enterprise systems?" },
  // multi-turn (condense path)
  {
    cls: "multiturn",
    label: "governor-followup",
    history: [
      { role: "user", text: "Tell me about Salesforce governor limits." },
      { role: "model", text: "Governor limits cap per-transaction resource use in Apex — SOQL queries, DML statements, CPU time." },
      { role: "user", text: "How do I avoid hitting that?" },
    ],
  },
  {
    cls: "multiturn",
    label: "lwc-followup",
    history: [
      { role: "user", text: "I'm building a multi-step checkout in LWC." },
      { role: "model", text: "A multi-step checkout is a good fit for a parent-orchestrated wizard with one child component per step." },
      { role: "user", text: "How should I structure the components?" },
    ],
  },
];

const OUT_OF_SCOPE = [
  "What's the weather in Tokyo tomorrow?",
  "Can you recommend a good sushi restaurant in Melbourne?",
  "How do I train a PyTorch model from scratch?",
  "Who is the current president of France?",
  "Write me a short poem about my cat.",
  "What's the best programming language for building video games?",
];

// ---------------------------------------------------------------------------
// Judge rubric — a fixed constant so scores stay comparable across runs.
// ---------------------------------------------------------------------------
const JUDGE_RUBRIC = `You are a strict evaluator of a retrieval-augmented answer. You are given a QUESTION, an ANSWER (which may contain inline citations like [1], [2] referring to numbered SOURCES), and the SOURCES themselves — the knowledge-base passages retrieved for this answer.

Judge ONLY against the SOURCES. Do not use outside knowledge. Definitions:

1. CLAIMS / GROUNDEDNESS. Break the ANSWER into its distinct factual claims — statements asserting a fact, capability, technique, number, or a piece of Alex's experience. Ignore pure connective phrasing, opinions, and recommendations that assert no new fact. For each claim set supported=true ONLY if it is directly stated in, or clearly entailed by, the SOURCES; otherwise false. Groundedness is the fraction of claims supported.

2. CITATIONS / CITATION PRECISION. For each inline [n] in the ANSWER, set supported=true ONLY if SOURCE number n actually supports the specific sentence the [n] is attached to. If the [n] is attached to a sentence that source n does not support, set supported=false.

3. SUBSTANTIVE (no hedge/waffle). Set substantive=true if the answer concretely addresses the question with useful content. Set false only if it is a vague deflection, a non-answer, or empty hedging.

Return STRICT JSON matching the provided schema. Keep notes to one terse sentence naming the biggest issue (or "clean").`;

const JUDGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claim: { type: Type.STRING },
          supported: { type: Type.BOOLEAN },
        },
        required: ["claim", "supported"],
      },
    },
    citations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER },
          supported: { type: Type.BOOLEAN },
        },
        required: ["n", "supported"],
      },
    },
    substantive: { type: Type.BOOLEAN },
    notes: { type: Type.STRING },
  },
  required: ["claims", "citations", "substantive", "notes"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect a full runChat turn into a flat result. */
async function collectChat(history) {
  let answer = "";
  let sources = [];
  let escalated = false;
  let error;
  for await (const ev of runChat(history)) {
    if (ev.type === "sources") sources = ev.sources;
    else if (ev.type === "delta") answer += ev.text;
    else if (ev.type === "escalation") escalated = true;
    else if (ev.type === "error") error = ev.message;
  }
  return { answer, sources, escalated, error };
}

const citationNums = (txt) => [...txt.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
const cited = (txt) => citationNums(txt).length > 0;
/** Every [n] maps to a listed source (1..len). Empty citations are vacuously valid. */
const citationsValid = (txt, srcs) => {
  const nums = citationNums(txt);
  return nums.every((n) => n >= 1 && n <= srcs.length);
};
/** An escalation OR an uncited refusal — the acceptable out-of-scope behaviours. */
const REFUSAL = /can't|cannot|can not|don't|do not|isn't|not something|outside|reach Alex|not cover|no information|don't have/i;

/** Read every chunk once and index content by doc title (a doc may have >1 chunk). */
async function loadChunkTextByTitle() {
  const res = await pool.query("SELECT doc_title, content FROM kb_chunks ORDER BY id");
  const map = new Map();
  for (const r of res.rows) {
    const list = map.get(r.doc_title) ?? [];
    list.push(r.content);
    map.set(r.doc_title, list);
  }
  return map;
}

/** Build the numbered SOURCES block the judge sees, from the answer's sources. */
function renderSources(sources, chunkText) {
  return sources
    .map((s) => {
      const body = (chunkText.get(s.title) ?? ["(source text unavailable)"]).join("\n");
      return `[${s.n}] ${s.title}\n${body}`;
    })
    .join("\n\n---\n\n");
}

async function judge(question, answer, sources, chunkText) {
  const prompt =
    `${JUDGE_RUBRIC}\n\n=== QUESTION ===\n${question}\n\n` +
    `=== ANSWER ===\n${answer}\n\n=== SOURCES ===\n${renderSources(sources, chunkText)}`;
  const res = await ai.models.generateContent({
    model: JUDGE_MODEL,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: JUDGE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const parsed = JSON.parse(res.text);
  const claims = parsed.claims ?? [];
  const citations = parsed.citations ?? [];
  const supportedClaims = claims.filter((c) => c.supported).length;
  const supportedCites = citations.filter((c) => c.supported).length;
  return {
    groundedness: claims.length ? supportedClaims / claims.length : null,
    claimCount: claims.length,
    citationPrecision: citations.length ? supportedCites / citations.length : null,
    citationCount: citations.length,
    substantive: !!parsed.substantive,
    notes: parsed.notes ?? "",
    unsupportedClaims: claims.filter((c) => !c.supported).map((c) => c.claim),
  };
}

const pct = (x) => (x == null ? "  n/a" : `${(x * 100).toFixed(0)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nAnswer-faithfulness eval → judge=${JUDGE_MODEL}\n${"=".repeat(78)}`);
  const chunkText = await loadChunkTextByTitle();

  const rows = [];
  let hardFailures = 0;

  // -------- answerable --------
  for (const item of ANSWERABLE) {
    const history = item.history ?? [{ role: "user", text: item.q }];
    const label = item.label ?? item.q;
    let r;
    try {
      r = await collectChat(history);
    } catch (err) {
      console.log(`  ERROR running "${label}": ${err.message}`);
      hardFailures++;
      continue;
    }
    const validCites = citationsValid(r.answer, r.sources);
    // Hard gates: a valid answerable question must not escalate and must not
    // emit an out-of-range citation.
    const falseEscalation = r.escalated;
    if (!validCites || falseEscalation) hardFailures++;

    const j = await judge(label, r.answer, r.sources, chunkText);
    rows.push({
      kind: "answerable",
      cls: item.cls,
      label,
      answer: r.answer,
      sources: r.sources,
      escalated: r.escalated,
      validCites,
      falseEscalation,
      hardFail: !validCites || falseEscalation,
      ...j,
    });
  }

  // -------- out-of-scope --------
  for (const q of OUT_OF_SCOPE) {
    let r;
    try {
      r = await collectChat([{ role: "user", text: q }]);
    } catch (err) {
      console.log(`  ERROR running OOS "${q}": ${err.message}`);
      hardFailures++;
      continue;
    }
    // Correct = escalated, OR refused without citing (no confident cited answer).
    const refusedUncited = REFUSAL.test(r.answer) && !cited(r.answer);
    const correct = r.escalated || refusedUncited;
    if (!correct) hardFailures++;
    rows.push({
      kind: "oos",
      cls: "out-of-scope",
      label: q,
      answer: r.answer,
      sources: r.sources,
      escalated: r.escalated,
      refusedUncited,
      correct,
      hardFail: !correct,
    });
  }

  // -------- aggregate dashboard --------
  const ans = rows.filter((r) => r.kind === "answerable");
  const oos = rows.filter((r) => r.kind === "oos");
  const meanGround = mean(ans.map((r) => r.groundedness).filter((x) => x != null));
  const meanCitePrec = mean(ans.map((r) => r.citationPrecision).filter((x) => x != null));
  const substantiveRate = mean(ans.map((r) => (r.substantive ? 1 : 0)));
  const falseEscalations = ans.filter((r) => r.falseEscalation).length;
  const oosCorrect = oos.filter((r) => r.correct).length;

  console.log(`\nJUDGE DASHBOARD (not a gate — calibrate before trusting)\n${"-".repeat(78)}`);
  console.log(`  mean groundedness      ${pct(meanGround)}   (over ${ans.length} answerable)`);
  console.log(`  mean citation precision ${pct(meanCitePrec)}`);
  console.log(`  substantive rate       ${pct(substantiveRate)}`);
  console.log(`\nESCALATION CORRECTNESS (hard gates)\n${"-".repeat(78)}`);
  console.log(`  false escalations on answerable   ${falseEscalations}/${ans.length}   (want 0)`);
  console.log(`  correct handling of out-of-scope  ${oosCorrect}/${oos.length}   (want ${oos.length})`);

  // -------- per-question table --------
  console.log(`\nPER-QUESTION\n${"-".repeat(78)}`);
  console.log(
    `${"class".padEnd(11)} ${"grnd".padStart(4)} ${"cite".padStart(4)} ${"sub".padStart(3)} ${"esc".padStart(3)} ${"val".padStart(3)}  question`,
  );
  for (const r of ans) {
    console.log(
      `${r.cls.padEnd(11)} ${pct(r.groundedness).padStart(4)} ${pct(r.citationPrecision).padStart(4)}` +
        ` ${(r.substantive ? "Y" : "n").padStart(3)} ${(r.escalated ? "ESC" : "-").padStart(3)}` +
        ` ${(r.validCites ? "ok" : "BAD").padStart(3)}  ${r.label.slice(0, 46)}`,
    );
  }
  for (const r of oos) {
    console.log(
      `${r.cls.padEnd(11)} ${"".padStart(4)} ${"".padStart(4)} ${"".padStart(3)}` +
        ` ${(r.escalated ? "ESC" : "-").padStart(3)} ${(r.correct ? "ok" : "BAD").padStart(3)}  ${r.label.slice(0, 46)}`,
    );
  }

  // -------- worst offenders, printed in full for human spot-check --------
  const worst = [...ans]
    .filter((r) => r.groundedness != null)
    .sort((a, b) => a.groundedness - b.groundedness)
    .slice(0, 3);
  console.log(`\nWORST OFFENDERS (lowest groundedness — spot-check the judge here)\n${"=".repeat(78)}`);
  for (const r of worst) {
    console.log(`\n[${r.cls}] ${r.label}`);
    console.log(
      `  groundedness=${pct(r.groundedness)} (${r.claimCount} claims)  ` +
        `citation-precision=${pct(r.citationPrecision)} (${r.citationCount} cites)  substantive=${r.substantive}`,
    );
    console.log(`  judge notes: ${r.notes}`);
    if (r.unsupportedClaims.length) {
      console.log(`  unsupported claims:`);
      for (const c of r.unsupportedClaims) console.log(`    - ${c}`);
    }
    console.log(`  sources: ${r.sources.map((s) => `[${s.n}] ${s.title}`).join(", ")}`);
    console.log(`  --- answer ---\n${r.answer.split("\n").map((l) => "  " + l).join("\n")}`);
  }

  // -------- any hard mechanical failure prints in full too --------
  const failed = rows.filter((r) => r.hardFail);
  if (failed.length) {
    console.log(`\nHARD FAILURES (${failed.length}) — these set the non-zero exit code\n${"=".repeat(78)}`);
    for (const r of failed) {
      const why = r.kind === "answerable"
        ? `${r.falseEscalation ? "false escalation; " : ""}${r.validCites ? "" : "invalid citation; "}`
        : "out-of-scope not escalated/refused; ";
      console.log(`\n[${r.cls}] ${r.label}\n  why: ${why.trim()}`);
      console.log(`  escalated=${r.escalated} sources=${r.sources.length}`);
      console.log(`  --- answer ---\n${r.answer.split("\n").map((l) => "  " + l).join("\n")}`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(hardFailures === 0 ? "ALL MECHANICAL GATES PASS" : `${hardFailures} HARD FAILURE(S)`);
  console.log("");
  await pool.end();
  process.exit(hardFailures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Answer eval failed:", err);
  process.exit(1);
});
