# Ask Alex

A RAG conversational agent over Alex Huang's personal engineering knowledge base —
engineering principles, Salesforce, AI & agentic engineering, DevOps & release, solution design, and more.
**Stack:** Node + TypeScript · Hono · Vertex AI Gemini (`@google/genai`) · Postgres + pgvector (Neon) · Cloud Run · static frontend on GitHub Pages.

It exercises a production RAG pipeline (vector DB + retrieval), a Vertex-native generation path with inline
citations, and an agentic handoff tool that reaches the real Alex when a question falls outside the knowledge base.

The frontend lives in [`docs/`](docs/) (served via GitHub Pages); the backend is this Node service on Cloud Run.

## Architecture

```
Ask Alex chat UI (GitHub Pages, static)  →  POST /chat (SSE)  →  Cloud Run (this service)
                                          ├─ embed query        Vertex embedding model
                                          ├─ similarity search  Postgres / pgvector
                                          ├─ generate           Vertex Gemini (Flash)
                                          └─ escalate_to_human  Gemini function calling
ingest.ts (offline): corpus/*.md → chunk → embed → upsert into pgvector
```

## Local setup

```bash
npm install
cp .env.example .env          # fill in PG_CONNECTION_STRING (Neon) — never commit
gcloud auth application-default login   # ADC for Vertex AI
npm run ingest                # populate pgvector from corpus/
npm run dev                   # http://localhost:8080
```

Test:

```bash
curl localhost:8080/health
curl -N -X POST localhost:8080/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","text":"How do I fix UNABLE_TO_LOCK_ROW?"}]}'
```

## Deploy to Cloud Run (no Docker needed — buildpacks)

```bash
gcloud config set project genai-kb-agent
gcloud services enable aiplatform.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

# Store the Neon connection string as a secret
printf '%s' "$PG_CONNECTION_STRING" | gcloud secrets create pg-conn --data-file=-

gcloud run deploy kb-agent --source . --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=genai-kb-agent,GOOGLE_CLOUD_LOCATION=us-central1,ALLOWED_ORIGIN=https://alex-huang.dev \
  --set-secrets PG_CONNECTION_STRING=pg-conn:latest

# Grant the Cloud Run service account Vertex access
# gcloud projects add-iam-policy-binding genai-kb-agent \
#   --member=serviceAccount:<run-sa> --role=roles/aiplatform.user
```

## Security notes

- `PG_CONNECTION_STRING` is a secret: local `.env` (gitignored) + Secret Manager in prod. Never commit it.
- CORS is locked to `ALLOWED_ORIGIN`. Per-IP rate limit + input/output caps guard the public endpoint.
- The corpus contains only generalized, publicly-shareable engineering knowledge — no employer/client identifiers.
