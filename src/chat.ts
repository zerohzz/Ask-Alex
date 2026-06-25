import type { Content } from "@google/genai";
import { ai } from "./genai.js";
import { config } from "./config.js";
import { retrieve, formatContext, type RetrievedChunk } from "./rag.js";
import { tools } from "./tools.js";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export type ChatEvent =
  | { type: "sources"; sources: SourceRef[] }
  | { type: "delta"; text: string }
  | {
      type: "escalation";
      reason: string;
      summary: string;
      priority: string;
    }
  | { type: "done" }
  | { type: "error"; message: string };

export interface SourceRef {
  n: number;
  title: string;
  category: string | null;
  url: string | null;
}

function systemInstruction(context: string): string {
  return [
    "You are Ask Alex — the knowledge agent of Alex Huang, a Melbourne-based senior Salesforce + AI engineer.",
    "You answer questions about Alex's expertise and how he works: engineering principles, Salesforce",
    "(Apex, SOQL, LWC, integrations), AI & agentic engineering, DevOps & release management, solution design",
    "& delivery, and about Alex himself.",
    "",
    "Voice: speak as Alex would. Technical and concise; front-load the answer, then the reasoning. Recommend,",
    "don't dictate ('Recommend X'). Verify before asserting — if the context does not support a claim, say so.",
    "Australian English. No emoji, no exclamation marks, no fluff openers ('great question', 'in summary').",
    "",
    "Answer ONLY from the knowledge-base context below. Cite the sources you use inline with bracketed numbers",
    "like [1], [2] matching the context blocks. If the context does not cover the question, or the user wants to",
    "reach the real Alex, call the escalate_to_human tool instead of guessing.",
    "",
    "=== KNOWLEDGE BASE CONTEXT ===",
    context,
    "=== END CONTEXT ===",
  ].join("\n");
}

function toContents(history: ChatTurn[]): Content[] {
  return history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/** A 404 / "not found" means the model name is unavailable (e.g. a preview
 *  model was deprecated), so retrying with the fallback model is worthwhile. */
function isModelUnavailable(err: unknown): boolean {
  if ((err as { status?: number })?.status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|NOT_FOUND|does not have access/i.test(msg);
}

/** Start a grounded generation stream for the given model. */
function startStream(
  history: ChatTurn[],
  sysInstruction: string,
  model: string,
  includeTools: boolean,
  maxOutputTokens: number,
) {
  return ai.models.generateContentStream({
    model,
    contents: toContents(history),
    config: {
      systemInstruction: sysInstruction,
      ...(includeTools ? { tools } : {}),
      maxOutputTokens,
      temperature: 0.2,
    },
  });
}

/**
 * Stream a grounded answer as ChatEvents. Tries the primary model; on a 404
 * (e.g. a preview model deprecated) it falls back once — before any token is
 * yielded, so the user never sees a partial answer switch models mid-stream.
 */
async function* streamAnswer(
  history: ChatTurn[],
  sysInstruction: string,
  includeTools: boolean,
  maxOutputTokens: number,
): AsyncGenerator<ChatEvent> {
  let stream;
  try {
    stream = await startStream(history, sysInstruction, config.geminiModel, includeTools, maxOutputTokens);
  } catch (err) {
    if (!isModelUnavailable(err)) throw err;
    console.error(
      `Primary model "${config.geminiModel}" unavailable; falling back to "${config.geminiModelFallback}".`,
      err,
    );
    stream = await startStream(history, sysInstruction, config.geminiModelFallback, includeTools, maxOutputTokens);
  }

  for await (const chunk of stream) {
    const calls = chunk.functionCalls;
    if (calls && calls.length > 0) {
      for (const call of calls) {
        if (call.name === "escalate_to_human") {
          const args = (call.args ?? {}) as Record<string, unknown>;
          yield {
            type: "escalation",
            reason: String(args.reason ?? "not covered by KB"),
            summary: String(args.summary ?? ""),
            priority: String(args.priority ?? "normal"),
          };
        }
      }
    }
    const text = chunk.text;
    if (text) yield { type: "delta", text };
  }

  yield { type: "done" };
}

function sourceRefs(chunks: RetrievedChunk[]): SourceRef[] {
  return chunks.map((c, i) => ({
    n: i + 1,
    title: c.docTitle,
    category: c.category,
    url: c.sourceUrl,
  }));
}

/**
 * Run one assistant turn as an async stream of events:
 * sources first, then text deltas, then optionally an escalation, then done.
 */
export async function* runChat(history: ChatTurn[]): AsyncGenerator<ChatEvent> {
  const last = history[history.length - 1];
  if (!last || last.role !== "user") {
    yield { type: "error", message: "Last turn must be a user message." };
    return;
  }

  const chunks = await retrieve(last.text);
  yield { type: "sources", sources: sourceRefs(chunks) };

  yield* streamAnswer(history, systemInstruction(formatContext(chunks)), true, config.maxOutputTokens);
}

function fitInstruction(context: string): string {
  return [
    "You are Ask Alex — assessing how well Alex Huang fits a given job description,",
    "using ONLY the knowledge-base context about Alex below.",
    "",
    "Structure the answer in three parts, in this order:",
    "1. Verdict — one line: Strong fit / Good fit / Partial fit, with a half-sentence why.",
    "2. **Where Alex fits** — bullet points mapping the role's key requirements to Alex's",
    "   concrete evidence. Cite each with an inline [n] matching the context blocks.",
    "3. **Lighter areas** — briefly and honestly, any role requirements the context does not",
    "   support. If the context covers the role well, say so in one line.",
    "",
    "Rules:",
    "- Be balanced but favourable: lead with genuine strengths, but never invent experience.",
    "- Every evidence claim MUST cite [n]. If the context does not support a requirement, it goes",
    "  under Lighter areas — do not guess or pad.",
    "- Australian English. Concise. No emoji, no exclamation marks, no fluff openers.",
    "- If the provided text is not actually a job description, say so and ask for one instead.",
    "",
    "=== KNOWLEDGE BASE CONTEXT (about Alex) ===",
    context,
    "=== END CONTEXT ===",
  ].join("\n");
}

/** Embed at most this many JD chars for retrieval (keeps under the embedding
 *  model's token limit; JDs front-load the important requirements anyway). */
const FIT_EMBED_CHARS = 6000;

/**
 * Assess Alex's fit against a job description. Retrieves the KB chunks most
 * relevant to the JD, then streams a balanced, cited verdict. No escalation
 * tool here — this is an analysis, not a Q&A handoff.
 */
export async function* runFit(jdText: string): AsyncGenerator<ChatEvent> {
  const chunks = await retrieve(jdText.slice(0, FIT_EMBED_CHARS), config.fitTopK);
  yield { type: "sources", sources: sourceRefs(chunks) };

  const history: ChatTurn[] = [
    { role: "user", text: `Here is the job description. Assess Alex's fit.\n\n${jdText}` },
  ];
  yield* streamAnswer(history, fitInstruction(formatContext(chunks)), false, config.fitMaxOutputTokens);
}
