import pgvector from "pgvector/pg";
import { pool } from "./db.js";
import { embed } from "./genai.js";
import { config } from "./config.js";

export interface RetrievedChunk {
  id: number;
  docTitle: string;
  category: string | null;
  sourceUrl: string | null;
  content: string;
  distance: number;
}

/** Embed the query and return the top-k nearest KB chunks by cosine distance. */
export async function retrieve(
  query: string,
  k: number = config.retrievalTopK,
): Promise<RetrievedChunk[]> {
  const queryVec = await embed(query);
  const res = await pool.query(
    `SELECT id, doc_title, category, source_url, content,
            embedding <=> $1 AS distance
       FROM kb_chunks
       ORDER BY embedding <=> $1
       LIMIT $2`,
    [pgvector.toSql(queryVec), k],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    docTitle: r.doc_title,
    category: r.category,
    sourceUrl: r.source_url,
    content: r.content,
    distance: Number(r.distance),
  }));
}

/** Render retrieved chunks as a numbered, citable context block for the prompt. */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(no relevant knowledge-base articles found)";
  return chunks
    .map((c, i) => `[${i + 1}] ${c.docTitle}\n${c.content}`)
    .join("\n\n---\n\n");
}
