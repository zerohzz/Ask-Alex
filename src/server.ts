import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { config } from "./config.js";
import { ensureSchema, logConversation } from "./db.js";
import { runChat, runFit, type ChatTurn } from "./chat.js";
import { fetchUrlText, looksLikeUrl } from "./fetchJd.js";

const app = new Hono();

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const corsMw = cors({
  origin: (origin) => {
    if (config.allowedOrigins.includes(origin)) return origin;
    if (LOCALHOST.test(origin)) return origin; // any local dev port
    return null;
  },
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
});
app.use("/chat", corsMw);
app.use("/fit", corsMw);

app.get("/", (c) =>
  c.json({
    service: "ask-alex",
    description: "Ask Alex — a RAG agent over Alex Huang's personal knowledge base. POST /chat to use.",
    health: "/health",
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

// --- Minimal in-memory per-IP rate limit (fixed window) ---
const WINDOW_MS = 60_000;
const MAX_REQ = 15;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_REQ;
}

function validate(body: unknown): ChatTurn[] | { error: string } {
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    return { error: "Body must be { messages: [...] }" };
  }
  const messages = (body as { messages: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: "messages must be a non-empty array" };
  }
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const m of messages) {
    if (
      typeof m !== "object" || m === null ||
      !("role" in m) || !("text" in m) ||
      (m.role !== "user" && m.role !== "model") ||
      typeof m.text !== "string"
    ) {
      return { error: "Each message needs { role: 'user'|'model', text: string }" };
    }
    total += m.text.length;
    turns.push({ role: m.role, text: m.text });
  }
  if (turns[turns.length - 1]!.role !== "user") {
    return { error: "Last message must be from the user" };
  }
  if (total > config.maxInputChars) {
    return { error: `Input too long (max ${config.maxInputChars} chars)` };
  }
  return turns;
}

app.post("/chat", async (c) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return c.json({ error: "Rate limit exceeded. Try again shortly." }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = validate(body);
  if ("error" in result) return c.json(result, 400);

  const question = result[result.length - 1]!.text;

  return streamSSE(c, async (stream) => {
    let answer = "";
    let escalated = false;
    try {
      for await (const event of runChat(result)) {
        if (event.type === "delta") answer += event.text;
        else if (event.type === "escalation") escalated = true;
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    } finally {
      // Best-effort archive; never let a logging failure surface to the user.
      try {
        await logConversation(question, answer, escalated);
      } catch (err) {
        console.error("Failed to archive conversation:", err);
      }
    }
  });
});

// "Is Alex a good fit for this role?" — accepts a JD link or pasted JD text.
app.post("/fit", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return c.json({ error: "Rate limit exceeded. Try again shortly." }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null || typeof (body as { input?: unknown }).input !== "string") {
    return c.json({ error: "Body must be { input: string }" }, 400);
  }
  const raw = (body as { input: string }).input.trim();
  if (!raw) return c.json({ error: "Provide a job description link or text." }, 400);
  if (raw.length > config.fitMaxInputChars) {
    return c.json({ error: `Input too long (max ${config.fitMaxInputChars} chars)` }, 400);
  }

  return streamSSE(c, async (stream) => {
    // Resolve the JD text: fetch the link, or use the pasted text directly.
    let jdText = raw;
    let label = "pasted job description";
    if (looksLikeUrl(raw)) {
      label = raw;
      try {
        jdText = await fetchUrlText(raw);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Could not read that link.";
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: `${reason} Paste the job description text instead and I'll assess the fit.`,
          }),
        });
        return;
      }
    }
    if (jdText.length < 80) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          message: "That didn't look like a job description — paste the role's text and I'll assess the fit.",
        }),
      });
      return;
    }

    let answer = "";
    try {
      for await (const event of runFit(jdText)) {
        if (event.type === "delta") answer += event.text;
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    } finally {
      try {
        await logConversation(`[FIT] ${label.slice(0, 300)}`, answer, false);
      } catch (err) {
        console.error("Failed to archive fit request:", err);
      }
    }
  });
});

async function main() {
  // SKIP_SCHEMA_INIT=1 lets local test runs against the shared prod DB stay
  // strictly read-only (no CREATE EXTENSION/TABLE/INDEX DDL). Prod boots without it.
  if (process.env.SKIP_SCHEMA_INIT !== "1") await ensureSchema();
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`kb-agent listening on :${info.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
