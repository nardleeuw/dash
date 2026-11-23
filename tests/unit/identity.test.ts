import { describe, expect, it } from "vitest";
import { senderIdentityComplete } from "@/server/compliance/identity";

describe("sender identity", () => {
  it("only needs a name — no address, no KVK number", () => {
    expect(senderIdentityComplete({ legal_name: "Nard Leeuwesteijn" })).toBe(true);
    expect(senderIdentityComplete({ legal_name: " " })).toBe(false);
    expect(senderIdentityComplete(null)).toBe(false);
  });
});
