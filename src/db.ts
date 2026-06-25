import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.pgConnectionString,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
  max: 5,
});

// Note: we never read `vector` columns back into JS (queries select distance +
// text only, and writes use pgvector.toSql to format the param), so no pgvector
// type registration is needed — avoiding a connect-time query race.

/**
 * Create the pgvector extension, table, and ANN index if they don't exist.
 * Safe to call repeatedly (used by ingest and on server boot).
 */
export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id          BIGSERIAL PRIMARY KEY,
        doc_title   TEXT NOT NULL,
        category    TEXT,
        source_url  TEXT,
        content     TEXT NOT NULL,
        embedding   vector(${config.embeddingDim}) NOT NULL
      )
    `);
    // Cosine distance index (matches the <=> operator used in retrieval).
    await client.query(`
      CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
      ON kb_chunks USING hnsw (embedding vector_cosine_ops)
    `);
    // Conversation archive. Internal/testing use — no PII layer yet (no IP).
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        question    TEXT NOT NULL,
        answer      TEXT,
        escalated   BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
  } finally {
    client.release();
  }
}

/**
 * Archive one completed turn. Best-effort: a logging failure must never break
 * the user's response, so callers should not await this in the hot path or
 * should swallow rejections after logging them.
 */
export async function logConversation(
  question: string,
  answer: string,
  escalated: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO conversations (question, answer, escalated) VALUES ($1, $2, $3)`,
    [question, answer, escalated],
  );
}
