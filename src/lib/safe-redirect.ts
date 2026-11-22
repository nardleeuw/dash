/** Only allow same-origin relative redirects ("/path"), never "//evil.com". */
export function safeNext(next: string | null | undefined, fallback = "/overview"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
