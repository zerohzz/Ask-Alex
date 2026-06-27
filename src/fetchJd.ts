// Fetch a job-description URL server-side and reduce it to plain text.
// Best-effort: many job boards (LinkedIn, Seek, Indeed) block bots or render
// client-side, so callers should let the user paste the JD text as a fallback.

const FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 12000;

/** Whole trimmed input is a single http(s) URL → treat it as a link to fetch. */
export function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(s.trim());
}

// Major job boards that bot-block or render server-side-empty (JS-only). Fetching
// these always fails or returns a login/anti-bot wall, so we short-circuit with a
// clear "paste the text" message instead of waiting out an 8s doomed fetch.
const BLOCKED_BOARDS: { match: (host: string) => boolean; name: string }[] = [
  { match: (h) => h.endsWith("linkedin.com"), name: "LinkedIn" },
  { match: (h) => h.includes("seek.com"), name: "Seek" },
  { match: (h) => h.endsWith("indeed.com") || h.includes("indeed."), name: "Indeed" },
  { match: (h) => h.includes("glassdoor."), name: "Glassdoor" },
  { match: (h) => h.endsWith("ziprecruiter.com"), name: "ZipRecruiter" },
];

/** Friendly board name if the host is a known bot-blocking job board, else null. */
function blockedBoardName(host: string): string | null {
  const h = host.toLowerCase();
  return BLOCKED_BOARDS.find((b) => b.match(h))?.name ?? null;
}

/** Heuristic: did we get a login/anti-bot wall rather than a real posting? */
function looksLikeWall(text: string): boolean {
  if (text.length < 200) return true; // JS-only pages reduce to near-nothing
  const t = text.toLowerCase();
  const walls = [
    "sign in to continue",
    "log in to continue",
    "verify you are human",
    "are you a robot",
    "enable javascript",
    "please enable js",
    "access denied",
    "captcha",
  ];
  // A wall page is short AND dominated by these phrases.
  return text.length < 600 && walls.some((w) => t.includes(w));
}

/**
 * Reject non-public targets before fetching. Mitigates SSRF against cloud
 * metadata / internal services from this public endpoint. (Literal-host check;
 * does not defend against DNS rebinding, which is out of scope here.)
 */
function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) links are supported.");
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("That host is not allowed.");
  return u;
}

/** Strip HTML to readable text, preserving rough block structure. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Block-level tags → newlines so list items and paragraphs stay separated.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  s = s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return s.slice(0, MAX_TEXT_CHARS);
}

/** Fetch a URL and return its readable text. Throws a user-facing message on failure. */
export async function fetchUrlText(rawUrl: string): Promise<string> {
  const url = assertPublicUrl(rawUrl);

  // Short-circuit known bot-blocking boards before spending the fetch budget.
  const board = blockedBoardName(url.hostname);
  if (board) {
    throw new Error(`${board} blocks automated page reads, so I can't open that link.`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new Error("Could not reach that link.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Could not fetch the link (HTTP ${res.status}).`);
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("html") && !ctype.includes("text")) {
    throw new Error("That link is not a readable web page.");
  }
  const text = htmlToText(await res.text());
  if (looksLikeWall(text)) {
    throw new Error("That link came back as a login or anti-bot page, not a job description.");
  }
  return text;
}
