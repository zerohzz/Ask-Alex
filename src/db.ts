import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// PG_OVER_WEBSOCKET=1 routes queries through Neon's WebSocket proxy on 443 —
// a local/dev escape hatch for networks that block outbound 5432 (same SQL,
// same pool interface). Default transport (direct TCP) unchanged in prod.
async function createPool(): Promise<pg.Pool> {
  if (process.env.PG_OVER_WEBSOCKET === "1") {
    const { Pool: NeonPool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = WebSocket;
    return new NeonPool({ connectionString: config.pgConnectionString, max: 5 }) as unknown as pg.Pool;
  }
  return new Pool({
    connectionString: config.pgConnectionString,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
    max: 5,
  });
}

export const pool = await createPool();

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
      CREATE TABLE IF NOT EXISTS ${config.kbTable} (
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
      CREATE INDEX IF NOT EXISTS ${config.kbTable}_embedding_idx
      ON ${config.kbTable} USING hnsw (embedding vector_cosine_ops)
    `);
    // Full-text search vector for the sparse side of hybrid retrieval. GENERATED
    // STORED => derived from doc_title + content automatically (no re-embed, no
    // re-ingest; backfills existing rows on add). Title is weighted 'A' so exact
    // topic-title matches rank above body mentions. Additive + reversible:
    //   ALTER TABLE <kb table> DROP COLUMN content_tsv;   -- rollback
    await client.query(`
      ALTER TABLE ${config.kbTable}
      ADD COLUMN IF NOT EXISTS content_tsv tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(doc_title, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
      ) STORED
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ${config.kbTable}_tsv_idx
      ON ${config.kbTable} USING GIN (content_tsv)
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
  if (config.disableConversationLog) return;
  await pool.query(
    `INSERT INTO conversations (question, answer, escalated) VALUES ($1, $2, $3)`,
    [question, answer, escalated],
  );
}
