import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

// Single Vertex-backed client. Auth comes from Application Default Credentials:
// `gcloud auth application-default login` locally, or the Cloud Run service
// account in production — no API key in code.
export const ai = new GoogleGenAI({
  vertexai: true,
  project: config.project,
  location: config.location,
});

/** Embedding task type — asymmetric retrieval pairs RETRIEVAL_QUERY (queries)
 *  with RETRIEVAL_DOCUMENT (corpus). Only sent when EMBED_TASK_TYPES is enabled
 *  (requires a matching re-ingest, so it's off by default). */
export type EmbedTask = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

function embedConfig(task?: EmbedTask) {
  return config.embedTaskTypes && task ? { config: { taskType: task } } : {};
}

/** Embed a single piece of text into a 768-dim vector. */
export async function embed(text: string, task?: EmbedTask): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: config.embeddingModel,
    contents: text,
    ...embedConfig(task),
  });
  const values = res.embeddings?.[0]?.values;
  if (!values) throw new Error("Embedding returned no values");
  return values;
}

/** Embed many texts; returns one vector per input, order preserved. */
export async function embedBatch(texts: string[], task?: EmbedTask): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: config.embeddingModel,
    contents: texts,
    ...embedConfig(task),
  });
  const out = res.embeddings?.map((e) => e.values);
  if (!out || out.some((v) => !v)) throw new Error("Batch embedding incomplete");
  return out as number[][];
}
