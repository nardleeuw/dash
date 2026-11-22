import "server-only";
import robotsParser from "robots-parser";
import { safeFetch, UnsafeUrlError } from "./safe-fetch";
import { extractPage, pickInternalPages, type PageExtract } from "./extract";

export const BOT_UA = "LeadwerkBot";

export type CrawledPage = PageExtract & { https: boolean; ms: number; bytes: number; status: number };
export type CrawlResult =
  | { status: "ok"; pages: CrawledPage[]; finalUrl: string }
  | { status: "blocked"; reason: "robots" | "unsafe" ; detail: string }
  | { status: "failed"; reason: string };

/** Crawl the homepage plus a few high-value internal pages, politely. */
export async function crawlWebsite(startUrl: string, opts: { maxPages?: number; allowPrivate?: boolean } = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 5;
  // Local test servers only — never honoured in production.
  if (process.env.RESEARCH_ALLOW_PRIVATE_HOSTS === "1" && process.env.APP_ENV !== "production") opts = { ...opts, allowPrivate: true };
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return { status: "failed", reason: "invalid_url" };
  }

  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { maxBytes: 200_000, timeoutMs: 6_000, allowPrivate: opts.allowPrivate, accept: "text/plain,*/*" });
    if (r.status === 200) robots = robotsParser(`${origin}/robots.txt`, r.body);
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { status: "blocked", reason: "unsafe", detail: err.message };
  }
  const allowed = (u: string) => !robots || robots.isAllowed(u, BOT_UA) !== false;
  if (!allowed(startUrl)) return { status: "blocked", reason: "robots", detail: "robots.txt disallows crawling" };

  const pages: CrawledPage[] = [];
  let home;
  try {
    home = await safeFetch(startUrl, { allowPrivate: opts.allowPrivate });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { status: "blocked", reason: "unsafe", detail: err.message };
    return { status: "failed", reason: (err as Error).message?.slice(0, 120) ?? "fetch_failed" };
  }
  if (home.status >= 400 || !/html/i.test(home.contentType)) return { status: "failed", reason: `http_${home.status}` };
  const homeExtract = extractPage(home.body, home.url);
  pages.push({ ...homeExtract, https: home.https, ms: home.ms, bytes: home.bytes, status: home.status });

  const finalOrigin = new URL(home.url).origin;
  for (const next of pickInternalPages(homeExtract, finalOrigin, maxPages - 1)) {
    if (!allowed(next)) continue;
    try {
      await new Promise((r) => setTimeout(r, 300)); // be polite
      const res = await safeFetch(next, { allowPrivate: opts.allowPrivate });
      if (res.status >= 400 || !/html/i.test(res.contentType)) continue;
      pages.push({ ...extractPage(res.body, res.url), https: res.https, ms: res.ms, bytes: res.bytes, status: res.status });
    } catch {
      /* skip individual page failures */
    }
  }
  return { status: "ok", pages, finalUrl: home.url };
}
