import type { NextConfig } from "next";

// Cache Components is intentionally disabled: every application page is
// per-user, RLS-scoped data, so pages render dynamically per request.
// See docs/ARCHITECTURE.md (ADR-003).
const nextConfig: NextConfig = {
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
