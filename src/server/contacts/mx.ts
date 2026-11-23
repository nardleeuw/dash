import "server-only";
import { promises as dns } from "node:dns";

const DEFINITE_MISS = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/**
 * Whether a domain can receive email (MX record, or an A record as implicit
 * MX). Transient DNS failures count as "yes" so a flaky resolver never drops
 * a good address; only a definite "no such domain / no records" says no.
 */
export async function domainAcceptsMail(domain: string, timeoutMs = 4_000): Promise<boolean> {
  const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), timeoutMs))]);
  try {
    if ((await withTimeout(dns.resolveMx(domain))).some((r) => r.exchange && r.exchange !== ".")) return true;
  } catch (err) {
    if (!DEFINITE_MISS.has((err as NodeJS.ErrnoException).code ?? "")) return true;
  }
  try {
    return (await withTimeout(dns.resolve4(domain))).length > 0;
  } catch (err) {
    return !DEFINITE_MISS.has((err as NodeJS.ErrnoException).code ?? "");
  }
}
