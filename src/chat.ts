import type { Content } from "@google/genai";
import { ai } from "./genai.js";
import { config } from "./config.js";
import { retrieve, formatContext, type RetrievedChunk, type RetrievalTiming } from "./rag.js";
import { tools } from "./tools.js";
import { logTurn } from "./observe.js";

/** Generation telemetry filled by streamAnswer for the per-turn log. */
interface GenMeta {
  model?: string;
  fellBack?: boolean;
  firstTokenMs?: number;
  generateMs?: number;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

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
    "Voice: speak as Alex would — a senior engineer explaining something to a sharp colleague. Lead with the",
    "direct answer, then give the reasoning and enough practical detail to be genuinely useful: the why, the",
    "trade-off, a concrete example or steps when the context supports them. Be substantive, not a one-liner, but",
    "don't pad. Recommend, don't dictate ('I'd recommend X, because…'). Australian English. No emoji, no",
    "exclamation marks, no fluff openers ('great question', 'in summary').",
    "",
    "Grounding: base every factual claim on the knowledge-base context below, and cite the blocks you draw on",
    "inline with bracketed numbers like [1], [2]. You may add brief connective explanation to make the answer",
    "clear and well-structured, but never invent specific facts, numbers, or experience that aren't in the",
    "context. If the context only partially covers the question, answer what it supports and say plainly what",
    "you can't speak to.",
    "",
    "Soft questions (culture fit, working style, collaboration, 'is he a good fit', what's he like to work with):",
    "don't deflect them as subjective. Answer from what the context DOES say about how Alex works — his",
    "engineering principles, customer-facing approach, end-to-end ownership, how he communicates trade-offs —",
    "and let the reader draw the fit conclusion. Then briefly note what the knowledge base doesn't cover (e.g.,",
    "personal/team dynamics) and that they can reach Alex directly for that.",
    "",
    "Escalation: call the escalate_to_human tool ONLY when the context below is empty or genuinely does not",
    "address the question, or when the user explicitly asks to reach the real Alex. If the context does address",
    "the question — even partially — answer it; do NOT escalate.",
    "",
    "=== KNOWLEDGE BASE CONTEXT ===",
    context,
    "=== END CONTEXT ===",
  ].join("\n");
}

function toContents(history: ChatTurn[]): Content[] {
  return history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/** Reject a promise if it doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * Conversation-aware query condensation. A follow-up like "how do I avoid that?"
 * is meaningless to a vector search on its own, so rewrite it — using recent
 * turns — into a standalone search query. Returns null on empty/garbage output;
 * callers fall back to embedding the raw last message.
 */
async function condenseQuery(history: ChatTurn[]): Promise<string | null> {
  const recent = history.slice(-6);
  const transcript = recent
    .map((t) => `${t.role === "user" ? "User" : "Alex"}: ${t.text}`)
    .join("\n");
  const prompt =
    "Rewrite the final user message into a single standalone search query for a " +
    "knowledge base, resolving any pronouns or references using the conversation. " +
    "Output only the query text — no preamble, no quotes.\n\n" +
    `${transcript}\n\nStandalone search query:`;
  const res = await ai.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    // No thinking — a query rewrite is mechanical, and thinking would consume the
    // small token budget and return an empty/truncated query.
    config: { temperature: 0, maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } },
  });
  const q = res.text?.trim().replace(/^["']|["']$/g, "");
  return q && q.length >= 3 && q.length <= 300 ? q : null;
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
      // Disable "thinking": for grounded RAG the context is already supplied, so
      // thinking tokens add latency and (worse) eat the maxOutputTokens budget,
      // truncating the visible answer. Off → full budget goes to the answer.
      thinkingConfig: { thinkingBudget: 0 },
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
  meta?: GenMeta,
): AsyncGenerator<ChatEvent> {
  const tGen = Date.now();
  let stream;
  try {
    stream = await startStream(history, sysInstruction, config.geminiModel, includeTools, maxOutputTokens);
    if (meta) {
      meta.model = config.geminiModel;
      meta.fellBack = false;
    }
  } catch (err) {
    if (!isModelUnavailable(err)) throw err;
    console.error(
      `Primary model "${config.geminiModel}" unavailable; falling back to "${config.geminiModelFallback}".`,
      err,
    );
    stream = await startStream(history, sysInstruction, config.geminiModelFallback, includeTools, maxOutputTokens);
    if (meta) {
      meta.model = config.geminiModelFallback;
      meta.fellBack = true;
    }
  }

  let firstToken = true;
  for await (const chunk of stream) {
    if (chunk.usageMetadata && meta) meta.usage = chunk.usageMetadata;
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
    if (text) {
      if (firstToken && meta) {
        meta.firstTokenMs = Date.now() - tGen;
        firstToken = false;
      }
      yield { type: "delta", text };
    }
  }
  if (meta) meta.generateMs = Date.now() - tGen;

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

  const t0 = Date.now();

  // Multi-turn: condense the latest message into a standalone search query so
  // follow-ups ("how do I avoid that?") retrieve the right docs. Single-turn
  // skips this (no added latency).
  let searchQuery = last.text;
  let rewrittenQuery: string | undefined;
  if (history.length > 1) {
    // Deterministic baseline: recent USER turns carry the topic, so even if the
    // LLM condense fails/times out we still retrieve on context (not the bare
    // "how do I avoid that?"). Condense, when it succeeds, refines this.
    searchQuery = history
      .filter((t) => t.role === "user")
      .slice(-3)
      .map((t) => t.text)
      .join(" ");
    try {
      const condensed = await withTimeout(condenseQuery(history), 5000);
      if (condensed) {
        searchQuery = condensed;
        rewrittenQuery = condensed;
      }
    } catch {
      // keep the concatenated recent-user-turns baseline as the search query
    }
  }

  const timing: RetrievalTiming = {};
  const chunks = await retrieve(searchQuery, config.retrievalTopK, timing);
  yield { type: "sources", sources: sourceRefs(chunks) };

  const meta: GenMeta = {};
  let escalated = false;
  let error: string | undefined;
  try {
    for await (const ev of streamAnswer(
      history,
      systemInstruction(formatContext(chunks)),
      true,
      config.maxOutputTokens,
      meta,
    )) {
      if (ev.type === "escalation") escalated = true;
      else if (ev.type === "error") error = ev.message;
      yield ev;
    }
  } finally {
    logTurn({
      endpoint: "chat",
      model: meta.model ?? config.geminiModel,
      fellBack: !!meta.fellBack,
      query: last.text,
      rewrittenQuery,
      sources: chunks.map((c) => ({ title: c.docTitle, distance: c.distance })),
      embedMs: timing.embedMs,
      searchMs: timing.searchMs,
      firstTokenMs: meta.firstTokenMs,
      generateMs: meta.generateMs,
      totalMs: Date.now() - t0,
      promptTokens: meta.usage?.promptTokenCount,
      outputTokens: meta.usage?.candidatesTokenCount,
      totalTokens: meta.usage?.totalTokenCount,
      escalated,
      error,
    });
  }
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
    "- Australian English. Substantive but tight — map each key requirement to evidence; don't pad.",
    "  No emoji, no exclamation marks, no fluff openers.",
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
  const t0 = Date.now();
  const timing: RetrievalTiming = {};
  const chunks = await retrieve(jdText.slice(0, FIT_EMBED_CHARS), config.fitTopK, timing);
  yield { type: "sources", sources: sourceRefs(chunks) };

  const history: ChatTurn[] = [
    { role: "user", text: `Here is the job description. Assess Alex's fit.\n\n${jdText}` },
  ];
  const meta: GenMeta = {};
  let error: string | undefined;
  try {
    for await (const ev of streamAnswer(
      history,
      fitInstruction(formatContext(chunks)),
      false,
      config.fitMaxOutputTokens,
      meta,
    )) {
      if (ev.type === "error") error = ev.message;
      yield ev;
    }
  } finally {
    logTurn({
      endpoint: "fit",
      model: meta.model ?? config.geminiModel,
      fellBack: !!meta.fellBack,
      query: `(fit) ${jdText.slice(0, 120)}`,
      sources: chunks.map((c) => ({ title: c.docTitle, distance: c.distance })),
      embedMs: timing.embedMs,
      searchMs: timing.searchMs,
      firstTokenMs: meta.firstTokenMs,
      generateMs: meta.generateMs,
      totalMs: Date.now() - t0,
      promptTokens: meta.usage?.promptTokenCount,
      outputTokens: meta.usage?.candidatesTokenCount,
      totalTokens: meta.usage?.totalTokenCount,
      escalated: false,
      error,
    });
  }
}
