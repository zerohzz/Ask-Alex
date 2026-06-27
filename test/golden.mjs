// Golden-question runner — drives the debug loop and checks acceptance criteria
// against a locally-running backend. Posts the AC scenarios to /chat and /fit,
// parses the SSE stream, and asserts per-scenario. Prints a PASS/FAIL table and
// exits non-zero if any AC fails.
//
//   BASE=http://localhost:8787 node test/golden.mjs
//
// Pair with the backend running read-only against the shared DB:
//   SKIP_SCHEMA_INIT=1 DISABLE_CONVERSATION_LOG=1 PORT=8787 npm start
// and tail its stdout for the structured per-turn logs (model, distances, latency).

const BASE = process.env.BASE ?? "http://localhost:8787";

/** POST a body and collect parsed SSE events. */
async function stream(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const events = [];
  if (!res.body) return { status: res.status, events };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  return { status: res.status, events };
}

const answerText = (evs) => evs.filter((e) => e.type === "delta").map((e) => e.text).join("");
const sources = (evs) => evs.find((e) => e.type === "sources")?.sources ?? [];
const escalated = (evs) => evs.some((e) => e.type === "escalation");
const errorEvent = (evs) => evs.find((e) => e.type === "error");
const citationNums = (txt) => [...txt.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
const cited = (txt) => citationNums(txt).length > 0;
/** AC7: every [n] maps to a listed source. */
const citationsValid = (txt, srcs) => {
  const nums = citationNums(txt);
  return nums.length === 0 || nums.every((n) => n >= 1 && n <= srcs.length);
};

const SAMPLE_JD = `Forward Deployed Engineer — Applied AI

We deploy LLMs into enterprise customer environments. You will build RAG pipelines,
integrate with customer APIs, and work directly with customers to scope and ship.

Requirements: 5+ years software engineering; Python or TypeScript; cloud (GCP/AWS);
vector databases; strong written and verbal communication; customer-facing / consulting
background a plus. Salesforce experience welcome.`;

const scenarios = [
  {
    id: "AC2-identity",
    desc: "Who is Alex? → grounded, cited, no escalation",
    run: () => stream("/chat", { messages: [{ role: "user", text: "Who is Alex?" }] }),
    check: (r) => {
      const a = answerText(r.events);
      const ok = a.length > 40 && cited(a) && !escalated(r.events) && citationsValid(a, sources(r.events));
      return { ok, note: `len=${a.length} cited=${cited(a)} esc=${escalated(r.events)} src=${sources(r.events).length}` };
    },
  },
  {
    id: "AC2-deep",
    desc: "Governor limits (single-shot) → grounded, cited, no escalation",
    run: () => stream("/chat", { messages: [{ role: "user", text: "How do I avoid hitting Salesforce governor limits?" }] }),
    check: (r) => {
      const a = answerText(r.events);
      const ok = /bulk|soql|limit|collection|loop/i.test(a) && cited(a) && !escalated(r.events) && citationsValid(a, sources(r.events));
      return { ok, note: `cited=${cited(a)} esc=${escalated(r.events)}` };
    },
  },
  {
    id: "AC3-multiturn",
    desc: "Follow-up 'how do I avoid that?' → retrieves governor-limit doc, NO false escalation",
    run: () =>
      stream("/chat", {
        messages: [
          { role: "user", text: "Tell me about Salesforce governor limits." },
          { role: "model", text: "Governor limits cap per-transaction resource use in Apex (SOQL queries, DML, CPU)." },
          { role: "user", text: "How do I avoid that?" },
        ],
      }),
    check: (r) => {
      const a = answerText(r.events);
      // Gate retrieval, not just generation: the TOP retrieved source must be a
      // governor-limit/bulkification doc (proves the follow-up was understood in
      // context), and no false escalation.
      const top = sources(r.events)[0]?.title ?? "";
      const retrievedRight = /govern|bulk|soql|limit/i.test(top);
      const ok = !escalated(r.events) && retrievedRight && /bulk|soql|limit|collection|loop|query/i.test(a) && a.length > 40;
      return { ok, note: `esc=${escalated(r.events)} retrievedRight=${retrievedRight} top="${top}"` };
    },
  },
  {
    id: "AC4-outofscope",
    desc: "Out-of-scope question → clean escalation, no invented facts",
    run: () => stream("/chat", { messages: [{ role: "user", text: "What's the weather in Tokyo tomorrow?" }] }),
    check: (r) => {
      const a = answerText(r.events);
      const ok = escalated(r.events) || (/can't|cannot|don't|outside|reach Alex|not.*cover/i.test(a) && !cited(a));
      return { ok, note: `esc=${escalated(r.events)} len=${a.length}` };
    },
  },
  {
    id: "AC5-fit-text",
    desc: "Fit (pasted JD text) → verdict + where-fits + cited evidence",
    run: () => stream("/fit", { input: SAMPLE_JD }),
    check: (r) => {
      const a = answerText(r.events);
      const ok = /fit/i.test(a) && cited(a) && a.length > 120 && citationsValid(a, sources(r.events));
      return { ok, note: `len=${a.length} cited=${cited(a)} src=${sources(r.events).length}` };
    },
  },
  {
    id: "AC6-fit-url-blocked",
    desc: "Fit (bot-blocked job URL) → immediate, actionable error (no dead-end)",
    run: () => stream("/fit", { input: "https://www.linkedin.com/jobs/view/4000000000" }),
    check: (r) => {
      const e = errorEvent(r.events);
      const ok = !!e && /paste/i.test(e.message);
      return { ok, note: e ? `msg="${e.message.slice(0, 60)}…"` : "no error event" };
    },
  },
];

const run = async () => {
  console.log(`\nGolden runner → ${BASE}\n${"=".repeat(64)}`);
  let failures = 0;
  for (const s of scenarios) {
    let res;
    try {
      res = await s.check(await s.run());
    } catch (err) {
      res = { ok: false, note: `threw: ${err.message}` };
    }
    if (!res.ok) failures++;
    console.log(`${res.ok ? "PASS" : "FAIL"}  ${s.id.padEnd(20)} ${s.desc}`);
    console.log(`      ↳ ${res.note}`);
  }
  console.log(`${"=".repeat(64)}\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run();
