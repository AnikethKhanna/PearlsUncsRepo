import type { NextConfig } from "next";

// Cache Components is intentionally OFF. Every page in this app shows live,
// per-user Airtable data behind a sign-in, so the classic "dynamic by default"
// rendering model is simpler to reason about and maintain.
const nextConfig: NextConfig = {
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
