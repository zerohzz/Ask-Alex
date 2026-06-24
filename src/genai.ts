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

/** Embed a single piece of text into a 768-dim vector. */
export async function embed(text: string): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: config.embeddingModel,
    contents: text,
  });
  const values = res.embeddings?.[0]?.values;
  if (!values) throw new Error("Embedding returned no values");
  return values;
}

/** Embed many texts; returns one vector per input, order preserved. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: config.embeddingModel,
    contents: texts,
  });
  const out = res.embeddings?.map((e) => e.values);
  if (!out || out.some((v) => !v)) throw new Error("Batch embedding incomplete");
  return out as number[][];
}
