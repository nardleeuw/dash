import type { HunterApi, HunterDomainSearch, HunterVerification } from "./client";

/** Demo data for development without a Hunter key. Never returns real people. */
export class MockHunter implements HunterApi {
  async domainSearch(domain: string): Promise<HunterDomainSearch> {
    const src = [{ domain, uri: `https://${domain}/contact`, extracted_on: "2026-01-01", last_seen_on: "2026-11-01", still_on_page: true }];
    return {
      domain, organization: null, pattern: "{first}", accept_all: false, webmail: false, disposable: false,
      emails: [
        { value: `info@${domain}`, type: "generic", confidence: 90, first_name: null, last_name: null, position: null, department: null, sources: src },
        { value: `demo.eigenaar@${domain}`, type: "personal", confidence: 70, first_name: "Demo", last_name: "Eigenaar", position: "Eigenaar", department: "executive", sources: src },
      ],
    };
  }

  async verify(email: string): Promise<HunterVerification> {
    return { email, status: email.startsWith("info@") ? "accept_all" : "valid", score: 80 };
  }
}
