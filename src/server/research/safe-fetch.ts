import "server-only";
import dns from "node:dns/promises";
import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * SSRF-safe fetching of third-party websites.
 *  - only http/https on ports 80/443
 *  - hostnames must resolve exclusively to public unicast addresses, checked
 *    both before the request and at connect time (defeats DNS rebinding)
 *  - redirects are followed manually (max 4) and every hop is re-validated
 *  - response size and time are capped
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function isPublicAddress(ip: string): boolean {
  try {
    let addr = ipaddr.parse(ip);
    if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
    return addr.range() === "unicast";
  } catch {
    return false;
  }
}

export function validateUrlShape(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("protocol not allowed");
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url");
  if (allowPrivate) return url;
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("port not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new UnsafeUrlError("private address");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UnsafeUrlError("internal hostname");
  return url;
}

async function assertPublicHost(hostname: string, allowPrivate: boolean) {
  if (allowPrivate) return;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError("private address");
    return;
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) throw new UnsafeUrlError("dns lookup failed");
  if (records.some((r) => !isPublicAddress(r.address))) throw new UnsafeUrlError("resolves to private address");
}

let directAgent: Agent | null = null;
let proxyAgent: EnvHttpProxyAgent | null = null;

function dispatcher(allowPrivate: boolean): Dispatcher {
  if (allowPrivate) return new Agent(); // local test servers only
  // Behind an outbound proxy (corporate / sandbox) DNS happens at the proxy;
  // the pre-request check above still applies.
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return (proxyAgent ??= new EnvHttpProxyAgent());
  }
  return (directAgent ??= new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, "", 4);
          const list = (addresses as unknown as LookupAddress[]) ?? [];
          const bad = list.find((a) => !isPublicAddress(a.address));
          if (bad || list.length === 0) return callback(new UnsafeUrlError("connect to private address blocked"), "", 4);
          if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
          callback(null, list[0].address, list[0].family);
        });
      },
    },
  }));
}

export type SafeResponse = { url: string; status: number; contentType: string; body: string; bytes: number; ms: number; https: boolean };

export async function safeFetch(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; allowPrivate?: boolean; userAgent?: string; accept?: string } = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const started = Date.now();
  let url = validateUrlShape(rawUrl, !!opts.allowPrivate);
  for (let hop = 0; hop <= 4; hop++) {
    await assertPublicHost(url.hostname, !!opts.allowPrivate);
    const res = await undiciFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        "User-Agent": opts.userAgent ?? "Mozilla/5.0 (compatible; LeadwerkBot/0.1; +https://leadwerk.app/bot)",
        Accept: opts.accept ?? "text/html,application/xhtml+xml",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.6",
      },
      dispatcher: dispatcher(!!opts.allowPrivate),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = validateUrlShape(new URL(res.headers.get("location")!, url).toString(), !!opts.allowPrivate);
      await res.body?.cancel();
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return { url: url.toString(), status: res.status, contentType, body, bytes, ms: Date.now() - started, https: url.protocol === "https:" };
  }
  throw new UnsafeUrlError("too many redirects");
}
