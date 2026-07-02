// Structured per-request logging. One JSON line per turn to stdout — Cloud Run
// captures stdout as structured logs, and locally we tee it to a file for the
// debug loop. This is the observability the README/blog promised (model used,
// retrieval distances, latency, token usage, escalation) and the lens used to
// diagnose answer quality from logs.

export interface SourceTrace {
  title: string;
  distance: number;
}

export interface TurnLog {
  endpoint: "chat" | "fit";
  /** The model that actually produced the answer (primary, or fallback if the primary 404'd). */
  model: string;
  /** True when the primary model was unavailable and we fell back. */
  fellBack: boolean;
  /** Original last user message (chat) or JD label (fit). */
  query: string;
  /** Conversation-condensed search query, when retrieval used a rewrite (multi-turn chat). */
  rewrittenQuery?: string;
  /** Retrieved chunks with cosine distances, in rank order — the retrieval audit trail. */
  sources: SourceTrace[];
  embedMs?: number;
  searchMs?: number;
  /** True when the sparse (full-text) side fused into retrieval this turn. */
  hybrid?: boolean;
  /** Time from generation start to the first streamed token — the perceived-latency signal. */
  firstTokenMs?: number;
  generateMs?: number;
  totalMs: number;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  escalated: boolean;
  /** Present only when the turn errored. */
  error?: string;
}

/** Emit one structured turn record. Never throws — logging must not break a response. */
export function logTurn(t: TurnLog): void {
  try {
    const nearest = t.sources[0]?.distance;
    console.log(
      JSON.stringify({
        kind: "turn",
        ts: new Date().toISOString(),
        ...t,
        // Convenience: nearest-chunk distance, the single best signal for "did
        // retrieval find anything relevant" when scanning logs.
        nearestDistance: nearest ?? null,
      }),
    );
  } catch {
    // Best-effort only.
  }
}

/** Monotonic-ish millisecond timer for latency segments. */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
