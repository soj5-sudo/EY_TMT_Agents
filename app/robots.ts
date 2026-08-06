import type { MetadataRoute } from "next";

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
