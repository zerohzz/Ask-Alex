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
  location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
  // Used automatically if the primary model 404s (e.g. a preview model gets
  // deprecated). Must be available in the same `location` as the primary.
  geminiModelFallback: process.env.GEMINI_MODEL_FALLBACK ?? "gemini-2.5-flash",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-005",
  embeddingDim: 768,
  pgConnectionString: required("PG_CONNECTION_STRING"),
  port: Number(process.env.PORT ?? 8080),
  // Comma-separated list of allowed browser origins.
  allowedOrigins: (process.env.ALLOWED_ORIGIN ?? "https://zerohzz.github.io,https://alex-huang.dev")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  retrievalTopK: 5,
  maxInputChars: 2000,
  maxOutputTokens: 1024,
  // "Is Alex a good fit?" flow: wider retrieval + a longer cap for the
  // verdict/evidence/gaps structure, and a larger input ceiling for pasted JDs.
  fitTopK: 8,
  fitMaxInputChars: 20000,
  fitMaxOutputTokens: 1536,
};
