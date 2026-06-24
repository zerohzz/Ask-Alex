import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { config } from "./config.js";
import { ensureSchema } from "./db.js";
import { runChat, type ChatTurn } from "./chat.js";

const app = new Hono();

app.use(
  "/chat",
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

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

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of runChat(result)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    }
  });
});

async function main() {
  await ensureSchema();
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`kb-agent listening on :${info.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
