import type { NextConfig } from "next";

/** VAT tabs moved under /vat when the app gained the Registers and TIEP modules; old links still work. */
const VAT_PATHS = ["summary", "invoices", "schedule", "exports", "imports", "returns", "filing", "ird-status", "submissions"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return VAT_PATHS.map((p) => ({ source: `/${p}`, destination: `/vat/${p}`, permanent: false }));
  },
};

export default nextConfig;
