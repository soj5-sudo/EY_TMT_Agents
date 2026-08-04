import type { MetadataRoute } from "next";

/**
 * Full crawl refusal.
 *
 * This console displays licensed market data and unreleased analysis. It is
 * not intended to be indexed, archived, or ingested into a training corpus.
 * The named agents are listed explicitly as well as covered by the wildcard,
 * because several of them honour a specific-agent rule while treating a
 * wildcard as advisory.
 */
export default function robots(): MetadataRoute.Robots {
  const namedAgents = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
    "Bytespider",
    "Amazonbot",
    "FacebookBot",
    "Diffbot",
    "Omgilibot",
    "ImagesiftBot",
    "SemrushBot",
    "AhrefsBot",
    "DataForSeoBot",
  ];

  return {
    rules: [
      { userAgent: "*", disallow: "/" },
      ...namedAgents.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
  };
}
