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

  const stream = await ai.models.generateContentStream({
    model: config.geminiModel,
    contents: toContents(history),
    config: {
      systemInstruction: systemInstruction(formatContext(chunks)),
      tools,
      maxOutputTokens: config.maxOutputTokens,
      temperature: 0.2,
    },
  });

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
