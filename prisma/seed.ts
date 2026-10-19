import { PrismaClient } from "@prisma/client";

import { AGENT_DEFINITIONS } from "../src/lib/agents/types";
import { DEFAULT_PROMPTS } from "../src/lib/prompts/defaults";
import { getBusinessProfile } from "../src/lib/business/profile";

const prisma = new PrismaClient();

async function main() {
  for (const agent of AGENT_DEFINITIONS) {
    await prisma.agent.upsert({
      where: { slug: agent.slug },
      update: { name: agent.name, description: agent.description },
      create: {
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
      },
    });
    const prompt = DEFAULT_PROMPTS[agent.slug];
    if (prompt) {
      await prisma.prompt.upsert({
        where: { agentSlug: agent.slug },
        update: {},
        create: {
          agentSlug: agent.slug,
          name: prompt.name,
          content: prompt.content,
        },
      });
    }
  }

  await prisma.setting.upsert({
    where: { key: "product" },
    update: {},
    create: {
      key: "product",
      value: { name: "Leads Marketing Tool", phase: 1 },
    },
  });

  // Business Profile: seeded from business-profile.json if present, else generic defaults.
  // Edit it at Settings → Business Profile. Existing saved profiles are never overwritten.
  await prisma.businessProfile.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", data: getBusinessProfile() },
  });

  await prisma.scraperDefinition.deleteMany({ where: { slug: "crawl4ai-import" } });

  for (const scraper of [
    { slug: "website-http", name: "Website HTTP", provider: "crawlee", source: "website", capabilities: ["scrape", "crawl", "extract"] },
    { slug: "website-browser", name: "Website Browser", provider: "playwright", source: "website", capabilities: ["scrape", "crawl", "extract"] },
    { slug: "website-crawl4ai", name: "Website Crawl4AI", provider: "crawl4ai", source: "website", capabilities: ["scrape", "crawl", "extract"] },
    { slug: "firecrawl", name: "Firecrawl", provider: "firecrawl", source: "website", capabilities: ["scrape", "crawl", "extract", "search"] },
    { slug: "apify-fallback", name: "Apify fallback", provider: "apify", source: "configured_actor", capabilities: ["scrape"] },
    { slug: "scrapy-import", name: "Scrapy import", provider: "scrapy", source: "public_web", capabilities: ["import"] },
  ]) {
    await prisma.scraperDefinition.upsert({
      where: { slug: scraper.slug },
      update: { name: scraper.name, provider: scraper.provider, source: scraper.source, capabilities: scraper.capabilities },
      create: {
        ...scraper,
        inputSchema: { type: "object", required: ["urls"] },
        outputSchema: { type: "object", properties: { sourceUrl: { type: "string" }, text: { type: "string" } } },
        rateLimits: { maxConcurrency: 2, requestDelayMs: 1000, maxRequests: 20, timeoutMs: 30000, retryLimit: 2 },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
