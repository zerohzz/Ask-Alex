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

/** Optional out-param: retrieve() fills it with per-segment latencies (ms). */
export interface RetrievalTiming {
  embedMs?: number;
  searchMs?: number;
}

/**
 * Embed the query and return the most relevant KB chunks. Fetches a wider
 * candidate set, drops anything beyond `retrievalMaxDistance` (so out-of-scope
 * queries yield empty context → a clean escalation rather than a forced,
 * irrelevant answer), then keeps the top `k`.
 */
export async function retrieve(
  query: string,
  k: number = config.retrievalTopK,
  timing?: RetrievalTiming,
): Promise<RetrievedChunk[]> {
  const tEmbed = Date.now();
  const queryVec = await embed(query, "RETRIEVAL_QUERY");
  if (timing) timing.embedMs = Date.now() - tEmbed;

  const candidateK = Math.max(config.retrievalCandidateK, k);
  const tSearch = Date.now();
  const res = await pool.query(
    `SELECT id, doc_title, category, source_url, content,
            embedding <=> $1 AS distance
       FROM kb_chunks
       ORDER BY embedding <=> $1
       LIMIT $2`,
    [pgvector.toSql(queryVec), candidateK],
  );
  if (timing) timing.searchMs = Date.now() - tSearch;

  const ranked = res.rows.map((r) => ({
    id: Number(r.id),
    docTitle: r.doc_title,
    category: r.category,
    sourceUrl: r.source_url,
    content: r.content,
    distance: Number(r.distance),
  }));

  // Always keep the top `retrievalMinKeep` (so the model has the best context to
  // judge from — a weakly-phrased but valid question like "is he a good culture
  // fit?" still gets the About/Principles docs), then add any others within the
  // distance threshold up to `k`. Trimming noise, not starving context: the model
  // + escalate_to_human tool make the final relevance call for true out-of-scope.
  const minKeep = Math.min(config.retrievalMinKeep, k);
  return ranked.filter((c, i) => i < minKeep || c.distance <= config.retrievalMaxDistance).slice(0, k);
}

/** Render retrieved chunks as a numbered, citable context block for the prompt. */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(no relevant knowledge-base articles found)";
  return chunks
    .map((c, i) => `[${i + 1}] ${c.docTitle}\n${c.content}`)
    .join("\n\n---\n\n");
}
