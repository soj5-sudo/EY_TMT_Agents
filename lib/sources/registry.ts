export type SourceTier = 1 | 2 | 3;

export interface Publisher {
  domain: string;
  name: string;
  tier: SourceTier;
  region: "Global" | "US" | "India" | "Europe" | "Asia";
}

export const PUBLISHERS: Publisher[] = [
  { domain: "sec.gov", name: "US Securities and Exchange Commission", tier: 1, region: "US" },
  { domain: "nseindia.com", name: "National Stock Exchange of India", tier: 1, region: "India" },
  { domain: "bseindia.com", name: "BSE India", tier: 1, region: "India" },
  { domain: "londonstockexchange.com", name: "London Stock Exchange", tier: 1, region: "Europe" },
  { domain: "reuters.com", name: "Reuters", tier: 1, region: "Global" },
  { domain: "bloomberg.com", name: "Bloomberg", tier: 1, region: "Global" },
  { domain: "apnews.com", name: "Associated Press", tier: 1, region: "Global" },
  { domain: "afp.com", name: "Agence France-Presse", tier: 1, region: "Global" },
  { domain: "prnewswire.com", name: "PR Newswire", tier: 1, region: "Global" },
  { domain: "businesswire.com", name: "Business Wire", tier: 1, region: "Global" },
  { domain: "globenewswire.com", name: "GlobeNewswire", tier: 1, region: "Global" },

  { domain: "ft.com", name: "Financial Times", tier: 2, region: "Global" },
  { domain: "wsj.com", name: "The Wall Street Journal", tier: 2, region: "US" },
  { domain: "cnbc.com", name: "CNBC", tier: 2, region: "US" },
  { domain: "cnbctv18.com", name: "CNBC TV18", tier: 2, region: "India" },
  { domain: "economist.com", name: "The Economist", tier: 2, region: "Global" },
  { domain: "barrons.com", name: "Barron's", tier: 2, region: "US" },
  { domain: "forbes.com", name: "Forbes", tier: 2, region: "Global" },
  { domain: "fortune.com", name: "Fortune", tier: 2, region: "Global" },
  { domain: "marketwatch.com", name: "MarketWatch", tier: 2, region: "US" },
  { domain: "nytimes.com", name: "The New York Times", tier: 2, region: "US" },
  { domain: "washingtonpost.com", name: "The Washington Post", tier: 2, region: "US" },
  { domain: "theguardian.com", name: "The Guardian", tier: 2, region: "Europe" },
  { domain: "bbc.com", name: "BBC News", tier: 2, region: "Global" },
  { domain: "bbc.co.uk", name: "BBC News", tier: 2, region: "Global" },
  { domain: "economictimes.indiatimes.com", name: "The Economic Times", tier: 2, region: "India" },
  { domain: "livemint.com", name: "Mint", tier: 2, region: "India" },
  { domain: "business-standard.com", name: "Business Standard", tier: 2, region: "India" },
  { domain: "thehindubusinessline.com", name: "The Hindu BusinessLine", tier: 2, region: "India" },
  { domain: "moneycontrol.com", name: "Moneycontrol", tier: 2, region: "India" },
  { domain: "financialexpress.com", name: "The Financial Express", tier: 2, region: "India" },
  { domain: "nikkei.com", name: "Nikkei", tier: 2, region: "Asia" },
  { domain: "scmp.com", name: "South China Morning Post", tier: 2, region: "Asia" },
  { domain: "handelsblatt.com", name: "Handelsblatt", tier: 2, region: "Europe" },
  { domain: "lesechos.fr", name: "Les Echos", tier: 2, region: "Europe" },

  { domain: "techcrunch.com", name: "TechCrunch", tier: 3, region: "Global" },
  { domain: "theregister.com", name: "The Register", tier: 3, region: "Global" },
  { domain: "arstechnica.com", name: "Ars Technica", tier: 3, region: "Global" },
  { domain: "theverge.com", name: "The Verge", tier: 3, region: "Global" },
  { domain: "wired.com", name: "Wired", tier: 3, region: "Global" },
  { domain: "zdnet.com", name: "ZDNET", tier: 3, region: "Global" },
  { domain: "computerweekly.com", name: "Computer Weekly", tier: 3, region: "Europe" },
  { domain: "lightreading.com", name: "Light Reading", tier: 3, region: "Global" },
  { domain: "fiercewireless.com", name: "Fierce Wireless", tier: 3, region: "US" },
  { domain: "telecoms.com", name: "Telecoms.com", tier: 3, region: "Global" },
  { domain: "datacenterdynamics.com", name: "Data Center Dynamics", tier: 3, region: "Global" },
  { domain: "semianalysis.com", name: "SemiAnalysis", tier: 3, region: "Global" },
  { domain: "tomshardware.com", name: "Tom's Hardware", tier: 3, region: "Global" },
  { domain: "anandtech.com", name: "AnandTech", tier: 3, region: "Global" },
  { domain: "hollywoodreporter.com", name: "The Hollywood Reporter", tier: 3, region: "US" },
  { domain: "variety.com", name: "Variety", tier: 3, region: "US" },
  { domain: "deadline.com", name: "Deadline", tier: 3, region: "US" },
  { domain: "protocol.com", name: "Protocol", tier: 3, region: "US" },
  { domain: "theinformation.com", name: "The Information", tier: 3, region: "US" },
  { domain: "crn.com", name: "CRN", tier: 3, region: "US" },
  { domain: "informationweek.com", name: "InformationWeek", tier: 3, region: "US" },
  { domain: "siliconangle.com", name: "SiliconANGLE", tier: 3, region: "Global" },
  { domain: "channelfutures.com", name: "Channel Futures", tier: 3, region: "US" },
];

const INDEX = new Map<string, Publisher>(PUBLISHERS.map((p) => [p.domain, p]));

export function identifyPublisher(url: string): Publisher | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  const direct = INDEX.get(host);
  if (direct) return direct;

  for (const p of PUBLISHERS) {
    if (host === p.domain || host.endsWith(`.${p.domain}`)) return p;
  }
  return null;
}

export function isVerified(url: string, maxTier: SourceTier = 3): boolean {
  const p = identifyPublisher(url);
  return p !== null && p.tier <= maxTier;
}

export const TIER_LABEL: Record<SourceTier, string> = {
  1: "Primary and wire",
  2: "Financial press",
  3: "Trade press",
};
