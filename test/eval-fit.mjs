// Fit-retrieval eval — A/Bs single-vector JD retrieval against decomposed
// retrieval (extractFitQueries → per-requirement retrieve → RRF fusion) on
// sample JDs with labeled expected docs. Coverage = fraction of expected doc
// titles present in the retrieved set (k = config.fitTopK).
//
//   PG_OVER_WEBSOCKET=1 npx tsx test/eval-fit.mjs
//
// Read-only; costs one extraction LLM call per JD plus query embeddings.
import { retrieve, fuseRankedLists } from "../src/rag.js";
import { extractFitQueries } from "../src/chat.js";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";

const FIT_EMBED_CHARS = 6000;

// Expected titles are substrings, chosen from corpus docs that genuinely map
// to the JD's requirements (same convention as eval.mjs).
const JDS = [
  {
    id: "fde-applied-ai",
    expect: ["About Alex", "AI & Agentic Engineering", "Engineering Principles", "Solution Design"],
    text: `Forward Deployed Engineer — Applied AI
We deploy LLMs into enterprise customer environments. You will build RAG pipelines,
integrate with customer APIs, and work directly with customers to scope and ship.
Requirements: 5+ years software engineering; Python or TypeScript; cloud (GCP/AWS);
vector databases; strong written and verbal communication; customer-facing / consulting
background a plus. Salesforce experience welcome.`,
  },
  {
    id: "senior-sf-engineer",
    expect: ["Bulkifying Apex Triggers", "Governor Limit", "Multi-Step LWC Wizard", "SOQL Best Practices", "REST Callouts"],
    text: `Senior Salesforce Engineer
Own complex Apex development on a high-volume org: trigger frameworks, asynchronous
processing, governor-limit optimisation and bulkification. Build Lightning Web
Components for customer-facing flows. Write selective SOQL against large objects.
Integrate external REST APIs securely. 6+ years Salesforce platform experience.`,
  },
  {
    id: "devops-release-manager",
    expect: ["Delta Deployments", "Two-Pipeline", "JWT Connected-App Auth", "Seeding Sandboxes", "DevOps & Release"],
    text: `Salesforce DevOps / Release Manager
Run the release train for a multi-org Salesforce estate: CI/CD pipeline design,
delta deployments, automated validation, sandbox management and seeding with
production-like data, secure pipeline authentication, rollback planning. Sustained
release cadence across dev, QA, UAT and production.`,
  },
  {
    id: "solutions-engineer",
    expect: ["About Alex", "Solution Design", "Engineering Principles"],
    text: `Solutions Engineer (Pre-Sales)
Partner with account executives to run discovery workshops with enterprise customers,
translate ambiguous business requirements into technical solution designs, deliver
live demos and proofs of concept, and communicate trade-offs to non-technical
stakeholders. Strong written communication and end-to-end ownership required.`,
  },
];

const titles = (chunks) => [...new Set(chunks.map((c) => c.docTitle))];
const coverage = (chunks, expect) => {
  const got = titles(chunks).map((t) => t.toLowerCase());
  const hit = expect.filter((e) => got.some((t) => t.includes(e.toLowerCase())));
  return { frac: hit.length / expect.length, missed: expect.filter((e) => !hit.includes(e)) };
};

async function main() {
  console.log(`\nFit-retrieval eval → coverage@fitTopK=${config.fitTopK} over ${JDS.length} JDs\n${"=".repeat(72)}`);
  let baseSum = 0;
  let decompSum = 0;
  for (const jd of JDS) {
    const jdQuery = jd.text.slice(0, FIT_EMBED_CHARS);

    const t0 = Date.now();
    const single = await retrieve(jdQuery, config.fitTopK);
    const singleMs = Date.now() - t0;

    const t1 = Date.now();
    const queries = await extractFitQueries(jdQuery);
    const lists = queries
      ? await Promise.all([retrieve(jdQuery, config.fitTopK), ...queries.map((q) => retrieve(q, config.fitTopK))])
      : null;
    const fused = lists ? fuseRankedLists(lists, config.fitTopK) : single;
    const decompMs = Date.now() - t1;

    const b = coverage(single, jd.expect);
    const d = coverage(fused, jd.expect);
    baseSum += b.frac;
    decompSum += d.frac;

    console.log(`\n${jd.id}  (queries extracted: ${queries ? queries.length : "FALLBACK"})`);
    console.log(`  single    coverage=${(b.frac * 100).toFixed(0)}%  ${singleMs}ms  missed: ${b.missed.join(", ") || "—"}`);
    console.log(`  decomposed coverage=${(d.frac * 100).toFixed(0)}%  ${decompMs}ms  missed: ${d.missed.join(", ") || "—"}`);
    console.log(`  docs (decomposed): ${titles(fused).join(" | ")}`);
  }
  const n = JDS.length;
  console.log(`\n${"-".repeat(72)}`);
  console.log(`mean coverage  single=${((baseSum / n) * 100).toFixed(1)}%   decomposed=${((decompSum / n) * 100).toFixed(1)}%`);
  await pool.end();
  process.exit(decompSum + 1e-9 >= baseSum ? 0 : 1);
}

main().catch((err) => {
  console.error("Fit eval failed:", err);
  process.exit(1);
});
