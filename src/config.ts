// Central config. Loads .env locally; on Cloud Run the env vars are injected
// directly (and Secret Manager mounts PG_CONNECTION_STRING), so a missing
// .env file is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file — rely on the real environment (Cloud Run)
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  project: process.env.GOOGLE_CLOUD_PROJECT ?? "genai-kb-agent",
  location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  // Used automatically if the primary model 404s (e.g. a preview model gets
  // deprecated). Must be available in the same `location` as the primary.
  // Verified available in us-central1: 2.5-flash / 2.5-pro / 2.5-flash-lite.
  // (gemini-2.0-flash and gemini-3-* are NOT accessible to this project there.)
  geminiModelFallback: process.env.GEMINI_MODEL_FALLBACK ?? "gemini-2.5-flash-lite",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-005",
  embeddingDim: 768,
  pgConnectionString: required("PG_CONNECTION_STRING"),
  // Chunk-table override so a candidate re-ingest (e.g. EMBED_TASK_TYPES=1) can
  // be built and eval'd in a shadow table on the live DB without touching the
  // serving table — and later promoted by just flipping this env var.
  kbTable: (() => {
    const t = process.env.KB_TABLE ?? "kb_chunks";
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`Invalid KB_TABLE: ${t}`);
    return t;
  })(),
  port: Number(process.env.PORT ?? 8080),
  // Comma-separated list of allowed browser origins.
  allowedOrigins: (process.env.ALLOWED_ORIGIN ?? "https://zerohzz.github.io,https://alex-huang.dev")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  // Set DISABLE_CONVERSATION_LOG=1 to skip archiving turns to the DB — used by
  // local test runs against the shared prod DB so they never write rows.
  disableConversationLog: process.env.DISABLE_CONVERSATION_LOG === "1",
  retrievalTopK: 5,
  // Fetch a wider candidate set, then drop chunks beyond maxDistance so
  // irrelevant context can't pollute the answer (or trigger a false escalation).
  // Threshold tuned on observed cosine distances: relevant matches sit < ~0.47,
  // out-of-scope queries land > ~0.60. Re-validate after switching embedding
  // task types (see EMBED_TASK_TYPES), which shifts the distance distribution.
  retrievalCandidateK: 12,
  // Hybrid retrieval: fuse dense (pgvector cosine) with sparse (Postgres
  // full-text) via Reciprocal Rank Fusion. Dense alone smears exact technical
  // tokens (error codes, `UNABLE_TO_LOCK_ROW`, `101 SOQL`); FTS nails them.
  // Set HYBRID_SEARCH=0 to fall back to dense-only. Degrades to dense-only
  // automatically if the content_tsv column is absent (pre-migration).
  hybridSearch: process.env.HYBRID_SEARCH !== "0",
  // RRF smoothing constant. Standard default (60): larger => flatter fusion
  // (rank position matters less), smaller => top ranks dominate.
  rrfK: Number(process.env.RRF_K ?? 60),
  // 0.52 (was 0.55): eval-v2 negatives showed out-of-scope chunks landing at
  // 0.54 (PyTorch/video-games leaks) while in-scope nearest distances peak
  // ~0.40 — 0.52 splits the observed distributions. Re-validate after any
  // re-embed (task types shift the distance distribution).
  retrievalMaxDistance: Number(process.env.RETRIEVAL_MAX_DISTANCE ?? 0.52),
  // Always retain at least this many top chunks even if they're past the distance
  // threshold, so the model can judge relevance (and escalate if truly off-topic)
  // rather than being starved into a hard rule-based escalation.
  retrievalMinKeep: 3,
  // RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY task types improve asymmetric retrieval,
  // but require re-ingesting the corpus so docs and queries match. Off by default
  // (preserves current embeddings); the deploy step flips this on with a re-ingest.
  embedTaskTypes: process.env.EMBED_TASK_TYPES === "1",
  // Total chars across ALL messages in the request. The frontend re-sends the
  // full conversation each turn, so this must accommodate accumulated history
  // (prior answers included), not just one question — 2000 rejected normal
  // multi-turn follow-ups with a 400. ~16k chars ≈ a healthy multi-turn budget
  // while still bounding abuse.
  maxInputChars: Number(process.env.MAX_INPUT_CHARS ?? 16000),
  maxOutputTokens: 1024,
  // "Is Alex a good fit?" flow: wider retrieval + a longer cap for the
  // verdict/evidence/gaps structure, and a larger input ceiling for pasted JDs.
  fitTopK: 8,
  fitMaxInputChars: 20000,
  fitMaxOutputTokens: 1536,
};
