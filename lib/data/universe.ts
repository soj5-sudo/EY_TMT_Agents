/**
 * TMT coverage universe.
 *
 * Symbols are Yahoo Finance tickers. CIKs are resolved at runtime from the SEC
 * ticker map rather than hardcoded here, so they cannot drift.
 */

export type Sector = "Technology" | "Media" | "Telecom";

export type Subsector =
  | "IT services"
  | "Software and platforms"
  | "Semiconductors"
  | "Internet and cloud"
  | "Hardware and infrastructure"
  | "Media and entertainment"
  | "Telecom operators";

/** Innovation themes a name is exposed to. Used by the AI innovation panel. */
export type Theme =
  | "ai-compute"
  | "ai-software"
  | "ai-agents"
  | "physical-ai"
  | "cloud"
  | "digital-transformation"
  | "connectivity"
  | "streaming";

export interface Company {
  symbol: string;
  name: string;
  short: string;
  sector: Sector;
  subsector: Subsector;
  region: "US" | "India" | "Europe" | "Canada" | "Asia";
  currency: "USD" | "INR" | "EUR" | "GBP";
  themes: Theme[];
  /** Set when the company files with the SEC, which enables the filings agent. */
  secFiler: boolean;
  /**
   * Why this name carries no reported figures, when it carries none. Set only
   * where the limit is real and known, so the interface can say what is missing
   * and why rather than leaving a blank cell for the reader to interpret.
   */
  coverageNote?: string;
}

export const UNIVERSE: Company[] = [
  // --- IT services and consulting -------------------------------------
  { symbol: "ACN", name: "Accenture plc", short: "Accenture", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation", "ai-software"], secFiler: true },
  { symbol: "IBM", name: "International Business Machines", short: "IBM", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["ai-software", "cloud", "digital-transformation"], secFiler: true },
  { symbol: "CTSH", name: "Cognizant Technology Solutions", short: "Cognizant", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "INFY", name: "Infosys Limited", short: "Infosys", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation", "ai-software"], secFiler: true },
  { symbol: "WIT", name: "Wipro Limited", short: "Wipro", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "EPAM", name: "EPAM Systems", short: "EPAM", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "DXC", name: "DXC Technology", short: "DXC", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "TCS.NS", name: "Tata Consultancy Services", short: "TCS", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "ai-software"], secFiler: false },
  { symbol: "HCLTECH.NS", name: "HCL Technologies", short: "HCLTech", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "TECHM.NS", name: "Tech Mahindra", short: "Tech M", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "connectivity"], secFiler: false, coverageNote: "Publishes results only through a JavaScript-rendered investor relations site, which serves no file link to a plain request. Not an SEC registrant, so there is no filed record either." },
  { symbol: "LTIM.NS", name: "LTIMindtree", short: "LTIMindtree", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false, coverageNote: "Publishes results only through a JavaScript-rendered investor relations site, which serves no file link to a plain request. Not an SEC registrant, so there is no filed record either." },
  { symbol: "MPHASIS.NS", name: "Mphasis Limited", short: "Mphasis", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "COFORGE.NS", name: "Coforge Limited", short: "Coforge", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false, coverageNote: "Publishes results only through a JavaScript-rendered investor relations site, which serves no file link to a plain request. Not an SEC registrant, so there is no filed record either." },
  { symbol: "PERSISTENT.NS", name: "Persistent Systems", short: "Persistent", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "ai-software"], secFiler: false, coverageNote: "Publishes results only through a JavaScript-rendered investor relations site, which serves no file link to a plain request. Not an SEC registrant, so there is no filed record either." },
  { symbol: "CAP.PA", name: "Capgemini SE", short: "Capgemini", sector: "Technology", subsector: "IT services", region: "Europe", currency: "EUR", themes: ["digital-transformation"], secFiler: false, coverageNote: "Publishes results only through a JavaScript-rendered investor relations site, which serves no file link to a plain request. Not an SEC registrant, so there is no filed record either." },

  // --- IT services, added from the wider peer set ----------------------
  // Comparable names outside the original coverage list. Each was added only
  // after its reported figures were located and read: the ones that file are
  // read from the register, the rest from the results file their own site
  // publishes. Where a company reports in a currency other than dollars, the
  // currency recorded here is what its own statements are stated in.
  { symbol: "ADP", name: "Automatic Data Processing", short: "ADP", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["digital-transformation", "cloud"], secFiler: true },
  { symbol: "IQV", name: "IQVIA Holdings", short: "IQVIA", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation", "ai-software"], secFiler: true },
  { symbol: "GIB", name: "CGI Inc", short: "CGI", sector: "Technology", subsector: "IT services", region: "Canada", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "GLOB", name: "Globant SA", short: "Globant", sector: "Technology", subsector: "IT services", region: "Europe", currency: "USD", themes: ["digital-transformation", "ai-software"], secFiler: true },
  { symbol: "DAVA", name: "Endava plc", short: "Endava", sector: "Technology", subsector: "IT services", region: "Europe", currency: "USD", themes: ["digital-transformation"], secFiler: true },
  { symbol: "EXPN.L", name: "Experian plc", short: "Experian", sector: "Technology", subsector: "IT services", region: "Europe", currency: "USD", themes: ["digital-transformation", "ai-software"], secFiler: false },
  { symbol: "ATE.PA", name: "Alten SA", short: "Alten", sector: "Technology", subsector: "IT services", region: "Europe", currency: "EUR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "TWKS", name: "Thoughtworks Holding", short: "Thoughtworks", sector: "Technology", subsector: "IT services", region: "US", currency: "USD", themes: ["digital-transformation"], secFiler: false, coverageNote: "Taken private in 2024, so it no longer files periodic reports and publishes no investor site. The last public figures are its final filed quarter." },
  { symbol: "ZENSARTECH.NS", name: "Zensar Technologies", short: "Zensar", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "BSOFT.NS", name: "Birlasoft Limited", short: "Birlasoft", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "MASTEK.NS", name: "Mastek Limited", short: "Mastek", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "cloud"], secFiler: false },
  { symbol: "DATAMATICS.NS", name: "Datamatics Global Services", short: "Datamatics", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "RSYSTEMS.NS", name: "R Systems International", short: "R Systems", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "ai-software"], secFiler: false },
  { symbol: "HAPPSTMNDS.NS", name: "Happiest Minds Technologies", short: "Happiest Minds", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation", "ai-software"], secFiler: false },
  { symbol: "SAKSOFT.NS", name: "Saksoft Limited", short: "Saksoft", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },
  { symbol: "KELLTONTEC.NS", name: "Kellton Tech Solutions", short: "Kellton", sector: "Technology", subsector: "IT services", region: "India", currency: "INR", themes: ["digital-transformation"], secFiler: false },

  // --- Software and platforms -----------------------------------------
  { symbol: "MSFT", name: "Microsoft Corporation", short: "Microsoft", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["ai-software", "ai-agents", "cloud"], secFiler: true },
  { symbol: "ORCL", name: "Oracle Corporation", short: "Oracle", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["cloud", "ai-compute"], secFiler: true },
  { symbol: "CRM", name: "Salesforce Inc", short: "Salesforce", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["ai-agents", "ai-software", "cloud"], secFiler: true },
  { symbol: "NOW", name: "ServiceNow Inc", short: "ServiceNow", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["ai-agents", "ai-software"], secFiler: true },
  { symbol: "SAP", name: "SAP SE", short: "SAP", sector: "Technology", subsector: "Software and platforms", region: "Europe", currency: "USD", themes: ["ai-software", "cloud"], secFiler: true },
  { symbol: "ADBE", name: "Adobe Inc", short: "Adobe", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["ai-software"], secFiler: true },
  { symbol: "PLTR", name: "Palantir Technologies", short: "Palantir", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["ai-agents", "ai-software"], secFiler: true },
  { symbol: "SNOW", name: "Snowflake Inc", short: "Snowflake", sector: "Technology", subsector: "Software and platforms", region: "US", currency: "USD", themes: ["cloud", "ai-software"], secFiler: true },

  // --- Semiconductors ---------------------------------------------------
  { symbol: "NVDA", name: "NVIDIA Corporation", short: "NVIDIA", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute", "physical-ai"], secFiler: true },
  { symbol: "AMD", name: "Advanced Micro Devices", short: "AMD", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "AVGO", name: "Broadcom Inc", short: "Broadcom", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute", "connectivity"], secFiler: true },
  { symbol: "INTC", name: "Intel Corporation", short: "Intel", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", short: "TSMC", sector: "Technology", subsector: "Semiconductors", region: "Asia", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "MU", name: "Micron Technology", short: "Micron", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "QCOM", name: "Qualcomm Inc", short: "Qualcomm", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute", "connectivity", "physical-ai"], secFiler: true },
  { symbol: "ARM", name: "Arm Holdings plc", short: "Arm", sector: "Technology", subsector: "Semiconductors", region: "US", currency: "USD", themes: ["ai-compute", "physical-ai"], secFiler: true },
  { symbol: "ASML", name: "ASML Holding NV", short: "ASML", sector: "Technology", subsector: "Semiconductors", region: "Europe", currency: "USD", themes: ["ai-compute"], secFiler: true },

  // --- Internet and cloud ------------------------------------------------
  { symbol: "GOOGL", name: "Alphabet Inc", short: "Alphabet", sector: "Technology", subsector: "Internet and cloud", region: "US", currency: "USD", themes: ["ai-software", "ai-agents", "cloud", "ai-compute"], secFiler: true },
  { symbol: "AMZN", name: "Amazon.com Inc", short: "Amazon", sector: "Technology", subsector: "Internet and cloud", region: "US", currency: "USD", themes: ["cloud", "ai-software", "physical-ai"], secFiler: true },
  { symbol: "META", name: "Meta Platforms Inc", short: "Meta", sector: "Technology", subsector: "Internet and cloud", region: "US", currency: "USD", themes: ["ai-software", "ai-compute"], secFiler: true },
  { symbol: "AAPL", name: "Apple Inc", short: "Apple", sector: "Technology", subsector: "Internet and cloud", region: "US", currency: "USD", themes: ["ai-software", "physical-ai"], secFiler: true },

  // --- Hardware and AI infrastructure ------------------------------------
  { symbol: "SMCI", name: "Super Micro Computer", short: "Supermicro", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "VRT", name: "Vertiv Holdings", short: "Vertiv", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["ai-compute"], secFiler: true },
  { symbol: "DELL", name: "Dell Technologies", short: "Dell", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["ai-compute", "cloud"], secFiler: true },

  // --- Physical AI and robotics ------------------------------------------
  { symbol: "TSLA", name: "Tesla Inc", short: "Tesla", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["physical-ai", "ai-compute"], secFiler: true },
  { symbol: "SYM", name: "Symbotic Inc", short: "Symbotic", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["physical-ai"], secFiler: true },
  { symbol: "ISRG", name: "Intuitive Surgical", short: "Intuitive", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["physical-ai"], secFiler: true },
  { symbol: "ROK", name: "Rockwell Automation", short: "Rockwell", sector: "Technology", subsector: "Hardware and infrastructure", region: "US", currency: "USD", themes: ["physical-ai"], secFiler: true },

  // --- Media and entertainment -------------------------------------------
  { symbol: "DIS", name: "The Walt Disney Company", short: "Disney", sector: "Media", subsector: "Media and entertainment", region: "US", currency: "USD", themes: ["streaming"], secFiler: true },
  { symbol: "NFLX", name: "Netflix Inc", short: "Netflix", sector: "Media", subsector: "Media and entertainment", region: "US", currency: "USD", themes: ["streaming", "ai-software"], secFiler: true },
  { symbol: "CMCSA", name: "Comcast Corporation", short: "Comcast", sector: "Media", subsector: "Media and entertainment", region: "US", currency: "USD", themes: ["streaming", "connectivity"], secFiler: true },
  { symbol: "WBD", name: "Warner Bros Discovery", short: "Warner Bros", sector: "Media", subsector: "Media and entertainment", region: "US", currency: "USD", themes: ["streaming"], secFiler: true },
  { symbol: "SPOT", name: "Spotify Technology", short: "Spotify", sector: "Media", subsector: "Media and entertainment", region: "Europe", currency: "USD", themes: ["streaming", "ai-software"], secFiler: true },

  // --- Telecom operators ---------------------------------------------------
  { symbol: "T", name: "AT&T Inc", short: "AT&T", sector: "Telecom", subsector: "Telecom operators", region: "US", currency: "USD", themes: ["connectivity"], secFiler: true },
  { symbol: "VZ", name: "Verizon Communications", short: "Verizon", sector: "Telecom", subsector: "Telecom operators", region: "US", currency: "USD", themes: ["connectivity"], secFiler: true },
  { symbol: "TMUS", name: "T-Mobile US Inc", short: "T-Mobile", sector: "Telecom", subsector: "Telecom operators", region: "US", currency: "USD", themes: ["connectivity"], secFiler: true },
  { symbol: "VOD", name: "Vodafone Group plc", short: "Vodafone", sector: "Telecom", subsector: "Telecom operators", region: "Europe", currency: "USD", themes: ["connectivity"], secFiler: true },
  { symbol: "BHARTIARTL.NS", name: "Bharti Airtel Limited", short: "Bharti Airtel", sector: "Telecom", subsector: "Telecom operators", region: "India", currency: "INR", themes: ["connectivity"], secFiler: false },
  { symbol: "RELIANCE.NS", name: "Reliance Industries", short: "Reliance", sector: "Telecom", subsector: "Telecom operators", region: "India", currency: "INR", themes: ["connectivity"], secFiler: false, coverageNote: "Publishes results as a media release laid out as prose. Its tables state figures without naming units on the row, so no absolute figure can be read without assuming a scale." },
];

export const INDICES = [
  { symbol: "^CNXIT", name: "Nifty IT", scope: "India technology" },
  { symbol: "^NSEI", name: "Nifty 50", scope: "India broad market" },
  { symbol: "^NDX", name: "Nasdaq 100", scope: "US technology" },
  { symbol: "^GSPC", name: "S&P 500", scope: "US broad market" },
  { symbol: "^SOX", name: "PHLX Semiconductor", scope: "Global semiconductors" },
];

export const THEME_LABELS: Record<Theme, string> = {
  "ai-compute": "AI compute and infrastructure",
  "ai-software": "AI software",
  "ai-agents": "Agentic AI",
  "physical-ai": "Physical AI and robotics",
  cloud: "Cloud",
  "digital-transformation": "Digital transformation",
  connectivity: "Connectivity and 5G",
  streaming: "Streaming",
};

export const SECTORS: Sector[] = ["Technology", "Media", "Telecom"];

/**
 * Listing regions, in the order the dashboards offer them. India carries the
 * cohort this console is built around, so it sits with the two western blocs
 * rather than behind them in an alphabetical list nobody reads to the end of.
 */
export const REGIONS: Company["region"][] = ["US", "Europe", "India", "Canada", "Asia"];

export function bySector(sector: Sector): Company[] {
  return UNIVERSE.filter((c) => c.sector === sector);
}

export function byTheme(theme: Theme): Company[] {
  return UNIVERSE.filter((c) => c.themes.includes(theme));
}

export function findCompany(query: string): Company | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    UNIVERSE.find((c) => c.symbol.toLowerCase() === q) ??
    UNIVERSE.find((c) => c.short.toLowerCase() === q) ??
    UNIVERSE.find((c) => c.name.toLowerCase() === q) ??
    UNIVERSE.find((c) => c.name.toLowerCase().includes(q)) ??
    UNIVERSE.find((c) => c.short.toLowerCase().includes(q)) ??
    null
  );
}

/** Symbols charted by default on the sector dashboard. */
export const DEFAULT_WATCH = [
  "ACN",
  "IBM",
  "TCS.NS",
  "NVDA",
  "MSFT",
  "GOOGL",
  "AVGO",
  "TSM",
  "NFLX",
  "TMUS",
  "^CNXIT",
  "^NDX",
  "^SOX",
];
