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
  /** Dense cosine distance (computed for sparse-only FTS matches too). */
  distance: number;
  /** Reciprocal-rank-fusion score (higher = better). Present in hybrid mode. */
  score?: number;
}

/** Optional out-param: retrieve() fills it with per-segment latencies (ms). */
export interface RetrievalTiming {
  embedMs?: number;
  searchMs?: number;
  /** True when the sparse (FTS) side actually ran and fused into the result. */
  hybrid?: boolean;
}

export interface RetrieveOptions {
  /** Override config.hybridSearch (e.g. the eval harness A/Bs dense vs hybrid). */
  hybrid?: boolean;
}

interface CandidateRow {
  id: number;
  docTitle: string;
  category: string | null;
  sourceUrl: string | null;
  content: string;
  distance: number;
  score?: number;
}

/** Dense-only candidates, ranked by cosine distance. */
async function denseCandidates(queryVec: number[], candidateK: number): Promise<CandidateRow[]> {
  const res = await pool.query(
    `SELECT id, doc_title, category, source_url, content,
            embedding <=> $1 AS distance
       FROM ${config.kbTable}
       ORDER BY embedding <=> $1
       LIMIT $2`,
    [pgvector.toSql(queryVec), candidateK],
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

/**
 * Hybrid candidates: fuse the dense (cosine) and sparse (full-text) rankings
 * with Reciprocal Rank Fusion in a single query. `distance` is computed for
 * every fused row (sparse-only hits included), so the caller's distance-based
 * out-of-scope filter judges all candidates on the same scale instead of
 * dropping exact-token FTS hits past the minKeep window. Throws if content_tsv
 * is absent — the caller falls back to dense-only.
 */
async function hybridCandidates(
  queryVec: number[],
  query: string,
  candidateK: number,
): Promise<CandidateRow[]> {
  const res = await pool.query(
    `WITH dense AS (
       SELECT id, embedding <=> $1 AS distance,
              ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS rnk
         FROM ${config.kbTable}
         ORDER BY embedding <=> $1
         LIMIT $2
     ),
     sparse AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rnk
         FROM ${config.kbTable}, websearch_to_tsquery('english', $3) q
        WHERE content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT $2
     ),
     fused AS (
       SELECT COALESCE(d.id, s.id) AS id,
              COALESCE(1.0 / ($4 + d.rnk), 0.0) +
              COALESCE(1.0 / ($4 + s.rnk), 0.0) AS score
         FROM dense d
         FULL OUTER JOIN sparse s ON s.id = d.id
     )
     SELECT k.id, k.doc_title, k.category, k.source_url, k.content,
            k.embedding <=> $1 AS distance, f.score AS score
       FROM fused f
       JOIN ${config.kbTable} k ON k.id = f.id
       ORDER BY f.score DESC
       LIMIT $2`,
    [pgvector.toSql(queryVec), candidateK, query, config.rrfK],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    docTitle: r.doc_title,
    category: r.category,
    sourceUrl: r.source_url,
    content: r.content,
    distance: Number(r.distance),
    score: Number(r.score),
  }));
}

/**
 * Embed the query and return the most relevant KB chunks. Runs hybrid retrieval
 * (dense cosine + sparse full-text, fused by RRF) when enabled, then drops
 * anything beyond `retrievalMaxDistance` (so out-of-scope queries yield empty
 * context → a clean escalation rather than a forced, irrelevant answer) while
 * always keeping the top `retrievalMinKeep`, and returns the top `k`.
 */
export async function retrieve(
  query: string,
  k: number = config.retrievalTopK,
  timing?: RetrievalTiming,
  opts?: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const tEmbed = Date.now();
  const queryVec = await embed(query, "RETRIEVAL_QUERY");
  if (timing) timing.embedMs = Date.now() - tEmbed;

  const candidateK = Math.max(config.retrievalCandidateK, k);
  const useHybrid = opts?.hybrid ?? config.hybridSearch;
  const tSearch = Date.now();
  let ranked: CandidateRow[];
  let hybridRan = false;
  if (useHybrid) {
    try {
      ranked = await hybridCandidates(queryVec, query, candidateK);
      hybridRan = true;
    } catch (err) {
      // content_tsv missing (pre-migration) or FTS unavailable → dense-only.
      console.error("Hybrid retrieval failed; falling back to dense-only.", err);
      ranked = await denseCandidates(queryVec, candidateK);
    }
  } else {
    ranked = await denseCandidates(queryVec, candidateK);
  }
  if (timing) {
    timing.searchMs = Date.now() - tSearch;
    timing.hybrid = hybridRan;
  }

  // Always keep the top `retrievalMinKeep` (so the model has the best context to
  // judge from — a weakly-phrased but valid question like "is he a good culture
  // fit?" still gets the About/Principles docs), then add any others within the
  // distance threshold up to `k`. Trimming noise, not starving context: the model
  // + escalate_to_human tool make the final relevance call for true out-of-scope.
  const minKeep = Math.min(config.retrievalMinKeep, k);
  return ranked.filter((c, i) => i < minKeep || c.distance <= config.retrievalMaxDistance).slice(0, k);
}

/**
 * Fuse several ranked retrieval lists into one, coverage-first. Used by /fit:
 * a multi-requirement JD embedded as ONE vector blurs into an average, so each
 * extracted requirement retrieves separately and the lists interleave here
 * round-robin (rank 0 of every list, then rank 1, …). Unlike RRF-sum fusion —
 * which lets a doc appearing mid-list everywhere outscore a doc that is rank 1
 * for exactly one requirement — this guarantees each requirement's best
 * evidence a seat in the context. Dedups by chunk id; returns the top `k`.
 */
export function fuseRankedLists(lists: RetrievedChunk[][], k: number): RetrievedChunk[] {
  const seen = new Set<number>();
  const fused: RetrievedChunk[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < maxLen && fused.length < k; rank++) {
    for (const list of lists) {
      const chunk = list[rank];
      if (!chunk || seen.has(chunk.id)) continue;
      seen.add(chunk.id);
      fused.push(chunk);
      if (fused.length >= k) break;
    }
  }
  return fused;
}

/** Render retrieved chunks as a numbered, citable context block for the prompt. */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(no relevant knowledge-base articles found)";
  return chunks
    .map((c, i) => `[${i + 1}] ${c.docTitle}\n${c.content}`)
    .join("\n\n---\n\n");
}
