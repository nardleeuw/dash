import "server-only";
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "leadwerk" });

/** Inngest is used when configured (cloud keys or a local dev server). */
export function inngestEnabled() {
  return Boolean(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV);
}
