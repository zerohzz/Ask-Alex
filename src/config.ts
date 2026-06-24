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
};
