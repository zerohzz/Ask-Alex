// Offline one-off: read corpus/*.md → chunk → Vertex embed → upsert into pgvector.
// Idempotent: truncates kb_chunks and reloads. Run with `npm run ingest`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pgvector from "pgvector/pg";
import { pool, ensureSchema } from "./src/db.js";
import { embedBatch } from "./src/genai.js";

const CORPUS_DIR = join(import.meta.dirname, "corpus");
const MAX_CHARS = 1500; // ~ one embedding chunk

interface Article {
  title: string;
  category: string | null;
  sourceUrl: string | null;
  body: string;
}

function parseFrontmatter(raw: string): Article {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { title: "Untitled", category: null, sourceUrl: null, body: raw.trim() };
  const [, fm, body] = match;
  const meta: Record<string, string> = {};
  for (const line of fm!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = val;
  }
  return {
    title: meta.title ?? "Untitled",
    category: meta.category ?? null,
    sourceUrl: meta.source_url ?? null,
    body: (body ?? "").trim(),
  };
}

/** Greedily pack paragraphs into <= MAX_CHARS chunks. */
function chunk(body: string): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > MAX_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function main() {
  await ensureSchema();

  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) throw new Error(`No .md files in ${CORPUS_DIR}`);

  type Row = { title: string; category: string | null; url: string | null; content: string };
  const rows: Row[] = [];
  for (const file of files) {
    const art = parseFrontmatter(readFileSync(join(CORPUS_DIR, file), "utf8"));
    for (const content of chunk(art.body)) {
      rows.push({ title: art.title, category: art.category, url: art.sourceUrl, content });
    }
  }
  console.log(`Parsed ${files.length} articles → ${rows.length} chunks. Embedding...`);

  const embeddings = await embedBatch(rows.map((r) => r.content));

  const client = await pool.connect();
  try {
    await client.query("TRUNCATE kb_chunks RESTART IDENTITY");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      await client.query(
        `INSERT INTO kb_chunks (doc_title, category, source_url, content, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.title, r.category, r.url, r.content, pgvector.toSql(embeddings[i]!)],
      );
    }
  } finally {
    client.release();
  }

  console.log(`Ingested ${rows.length} chunks into kb_chunks.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
