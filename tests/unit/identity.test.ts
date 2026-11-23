import { describe, expect, it } from "vitest";
import { postalAddressComplete, senderIdentityComplete } from "@/server/compliance/identity";

describe("sender identity", () => {
  it("requires a postcode and a place in the address", () => {
    for (const ok of ["Kamille 2a, 5248 AB Rosmalen", "Straat 1, 3511AA Utrecht", "Oudegracht 12 3511 AB Utrecht", "Rue Neuve 1, 1000 Brussel"]) expect(postalAddressComplete(ok)).toBe(true);
    for (const bad of ["Kamille 2a", "Straat 1, Utrecht", "3511 AB", "", null]) expect(postalAddressComplete(bad)).toBe(false);
  });
  it("needs a legal name and a complete address, no KVK number", () => {
    expect(senderIdentityComplete({ legal_name: "Nard Leeuwesteijn", postal_address: "Kamille 2a, 5248 AB Rosmalen" })).toBe(true);
    expect(senderIdentityComplete({ legal_name: "Nard Leeuwesteijn", postal_address: "Kamille 2a" })).toBe(false);
    expect(senderIdentityComplete({ legal_name: " ", postal_address: "Kamille 2a, 5248 AB Rosmalen" })).toBe(false);
  });
});
