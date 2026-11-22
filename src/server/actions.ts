import "server-only";
import { z } from "zod";
import { ForbiddenError } from "@/server/auth";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/**
 * Wraps a server action: maps validation/authorization errors to safe,
 * user-facing messages and never leaks internal error details.
 */
export async function safeAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return fail("validation", fieldErrors);
    }
    if (err instanceof ForbiddenError) return fail("forbidden");
    if (err instanceof Error && err.name === "RateLimitedError") return fail("rate_limited");
    // Next.js redirect()/notFound() must propagate.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string" &&
        ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") || (err as { digest: string }).digest.startsWith("NEXT_HTTP_ERROR"))) {
      throw err;
    }
    console.error("[action]", err);
    return fail("unexpected");
  }
}
