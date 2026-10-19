import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "playwright",
    "@crawlee/core",
    "@crawlee/cheerio",
    "@crawlee/playwright",
  ],
};

export default nextConfig;
