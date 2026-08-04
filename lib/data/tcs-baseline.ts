/**
 * TCS baseline dataset.
 *
 * Every figure below was extracted from the primary filing, not typed from
 * memory or a secondary aggregator:
 *
 *   Q1 FY 2026-27 Fact Sheet, published 9 Jul 2026
 *   https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/
 *     2026-27/q1/Presentations/Q1%202026-27%20Fact%20Sheet.pdf
 *
 * This file is the fallback tier, not the display tier. The Filings Harvester
 * agent re-fetches and re-parses the live fact sheet on demand; when that
 * succeeds the dashboard renders parsed values tagged "filing". When the
 * source is unreachable it renders these values tagged "baseline" so the
 * provenance is never ambiguous to the reader.
 *
 * Rule: nothing in this file is estimated, interpolated or modelled. If a
 * figure was not in the filing it is null, and the UI prints "Not set".
 */

export const BASELINE_SOURCE = {
  company: "Tata Consultancy Services",
  ticker: "TCS.NS",
  document: "Q1 FY 2026-27 Fact Sheet",
  publishedOn: "2026-07-09",
  url: "https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/2026-27/q1/Presentations/Q1%202026-27%20Fact%20Sheet.pdf",
  extractedOn: "2026-08-04",
  reportingStandard: "IFRS, consolidated",
} as const;

export type QuarterKey =
  | "Q1 FY26"
  | "Q2 FY26"
  | "Q3 FY26"
  | "Q4 FY26"
  | "Q1 FY27";

export const QUARTERS: QuarterKey[] = [
  "Q1 FY26",
  "Q2 FY26",
  "Q3 FY26",
  "Q4 FY26",
  "Q1 FY27",
];

/* ------------------------------------------------------------------ *
 * Growth summary. INR figures are ₹ Million, USD figures are $ Million.
 * Both are as-reported by the company. The USD column is the company's
 * own translation, so it is NOT recomputed from the live FX rate.
 * ------------------------------------------------------------------ */

export interface GrowthRow {
  quarter: QuarterKey;
  revenueInrMn: number;
  revenueUsdMn: number;
  operatingIncomeInrMn: number;
  operatingIncomeUsdMn: number;
  netIncomeInrMn: number;
  netIncomeUsdMn: number;
  operatingMarginPct: number;
  netMarginPct: number;
  qoqInrPct: number;
  qoqUsdPct: number;
  qoqCcPct: number;
}

export const GROWTH: GrowthRow[] = [
  {
    quarter: "Q1 FY26",
    revenueInrMn: 634370,
    revenueUsdMn: 7421,
    operatingIncomeInrMn: 155140,
    operatingIncomeUsdMn: 1815,
    netIncomeInrMn: 127600,
    netIncomeUsdMn: 1493,
    operatingMarginPct: 24.5,
    netMarginPct: 20.1,
    qoqInrPct: -1.6,
    qoqUsdPct: -0.6,
    qoqCcPct: -3.3,
  },
  {
    quarter: "Q2 FY26",
    revenueInrMn: 657990,
    revenueUsdMn: 7466,
    operatingIncomeInrMn: 165650,
    operatingIncomeUsdMn: 1879,
    netIncomeInrMn: 129040,
    netIncomeUsdMn: 1464,
    operatingMarginPct: 25.2,
    netMarginPct: 19.6,
    qoqInrPct: 3.7,
    qoqUsdPct: 0.6,
    qoqCcPct: 0.8,
  },
  {
    quarter: "Q3 FY26",
    revenueInrMn: 670870,
    revenueUsdMn: 7509,
    operatingIncomeInrMn: 168890,
    operatingIncomeUsdMn: 1889,
    netIncomeInrMn: 134380,
    netIncomeUsdMn: 1503,
    operatingMarginPct: 25.2,
    netMarginPct: 20.0,
    qoqInrPct: 2.0,
    qoqUsdPct: 0.6,
    qoqCcPct: 0.8,
  },
  {
    quarter: "Q4 FY26",
    revenueInrMn: 706980,
    revenueUsdMn: 7621,
    operatingIncomeInrMn: 178700,
    operatingIncomeUsdMn: 1927,
    netIncomeInrMn: 137180,
    netIncomeUsdMn: 1479,
    operatingMarginPct: 25.3,
    netMarginPct: 19.4,
    qoqInrPct: 5.4,
    qoqUsdPct: 1.5,
    qoqCcPct: 1.2,
  },
  {
    quarter: "Q1 FY27",
    revenueInrMn: 722750,
    revenueUsdMn: 7624,
    operatingIncomeInrMn: 173170,
    operatingIncomeUsdMn: 1826,
    netIncomeInrMn: 138490,
    netIncomeUsdMn: 1460,
    operatingMarginPct: 24.0,
    netMarginPct: 19.2,
    qoqInrPct: 2.2,
    qoqUsdPct: 0.0,
    qoqCcPct: 0.4,
  },
];

/* ------------------------------------------------------------------ *
 * IFRS income statement. ₹ Million. The filing carries three columns
 * only: current quarter, prior quarter, year-ago quarter.
 * ------------------------------------------------------------------ */

export interface PnlLine {
  label: string;
  /** Indent level for the statement hierarchy. */
  depth: 0 | 1;
  /** Subtotal lines are ruled and weighted differently. */
  subtotal?: boolean;
  q1fy26: number;
  q4fy26: number;
  q1fy27: number;
  pctQ1fy26: number;
  pctQ4fy26: number;
  pctQ1fy27: number;
}

export const PNL: PnlLine[] = [
  {
    label: "Revenue",
    depth: 0,
    subtotal: true,
    q1fy26: 634370,
    q4fy26: 706980,
    q1fy27: 722750,
    pctQ1fy26: 100.0,
    pctQ4fy26: 100.0,
    pctQ1fy27: 100.0,
  },
  {
    label: "Cost of revenue",
    depth: 1,
    q1fy26: 386120,
    q4fy26: 419150,
    q1fy27: 436510,
    pctQ1fy26: 60.8,
    pctQ4fy26: 59.3,
    pctQ1fy27: 60.4,
  },
  {
    label: "Gross margin",
    depth: 0,
    subtotal: true,
    q1fy26: 248250,
    q4fy26: 287830,
    q1fy27: 286240,
    pctQ1fy26: 39.2,
    pctQ4fy26: 40.7,
    pctQ1fy27: 39.6,
  },
  {
    label: "SG&A expenses",
    depth: 1,
    q1fy26: 93110,
    q4fy26: 109130,
    q1fy27: 113070,
    pctQ1fy26: 14.7,
    pctQ4fy26: 15.4,
    pctQ1fy27: 15.6,
  },
  {
    label: "Operating income",
    depth: 0,
    subtotal: true,
    q1fy26: 155140,
    q4fy26: 178700,
    q1fy27: 173170,
    pctQ1fy26: 24.5,
    pctQ4fy26: 25.3,
    pctQ1fy27: 24.0,
  },
  {
    label: "Other income, net",
    depth: 1,
    q1fy26: 14650,
    q4fy26: 4920,
    q1fy27: 12950,
    pctQ1fy26: 2.3,
    pctQ4fy26: 0.7,
    pctQ1fy27: 1.8,
  },
  {
    label: "Income before income taxes",
    depth: 0,
    subtotal: true,
    q1fy26: 169790,
    q4fy26: 183620,
    q1fy27: 186120,
    pctQ1fy26: 26.8,
    pctQ4fy26: 26.0,
    pctQ1fy27: 25.8,
  },
  {
    label: "Income taxes",
    depth: 1,
    q1fy26: 41600,
    q4fy26: 45780,
    q1fy27: 46920,
    pctQ1fy26: 6.6,
    pctQ4fy26: 6.5,
    pctQ1fy27: 6.5,
  },
  {
    label: "Income after income taxes",
    depth: 0,
    subtotal: true,
    q1fy26: 128190,
    q4fy26: 137840,
    q1fy27: 139200,
    pctQ1fy26: 20.2,
    pctQ4fy26: 19.5,
    pctQ1fy27: 19.3,
  },
  {
    label: "Non-controlling interests",
    depth: 1,
    q1fy26: 590,
    q4fy26: 660,
    q1fy27: 710,
    pctQ1fy26: 0.1,
    pctQ4fy26: 0.1,
    pctQ1fy27: 0.1,
  },
  {
    label: "Net income",
    depth: 0,
    subtotal: true,
    q1fy26: 127600,
    q4fy26: 137180,
    q1fy27: 138490,
    pctQ1fy26: 20.1,
    pctQ4fy26: 19.4,
    pctQ1fy27: 19.2,
  },
];

/** Earnings per share, ₹. Kept out of PNL because it is not a ₹ Million line. */
export const EPS_INR = { q1fy26: 35.27, q4fy26: 37.92, q1fy27: 38.28 };

/* ------------------------------------------------------------------ *
 * Expense by nature. ₹ Crore as reported (1 Crore = 10 Million).
 * Q2, Q3 and Q1 FY27 exclude exceptional items per the filing footnote.
 * ------------------------------------------------------------------ */

export interface ExpenseLine {
  label: string;
  crore: [number, number, number, number, number];
  pctOfRevenue: [number, number, number, number, number];
}

export const EXPENSES: ExpenseLine[] = [
  {
    label: "Employee cost",
    crore: [37715, 38606, 38530, 40143, 42137],
    pctOfRevenue: [59.5, 58.7, 57.4, 56.8, 58.3],
  },
  {
    label: "Fees to external consultants",
    crore: [2999, 3248, 3491, 3971, 4293],
    pctOfRevenue: [4.7, 4.9, 5.2, 5.6, 5.9],
  },
  {
    label: "Equipment and software licences",
    crore: [726, 967, 1262, 1443, 1354],
    pctOfRevenue: [1.1, 1.5, 1.9, 2.0, 1.9],
  },
  {
    label: "Project expenses and delivery software",
    crore: [2169, 2126, 2399, 2467, 2409],
    pctOfRevenue: [3.4, 3.2, 3.6, 3.5, 3.3],
  },
  {
    label: "Depreciation and amortisation",
    crore: [1154, 1206, 1182, 1219, 1206],
    pctOfRevenue: [1.8, 1.8, 1.8, 1.7, 1.7],
  },
  {
    label: "Facility expenses",
    crore: [916, 886, 941, 944, 975],
    pctOfRevenue: [1.4, 1.3, 1.4, 1.3, 1.3],
  },
  {
    label: "Communication",
    crore: [278, 270, 270, 285, 296],
    pctOfRevenue: [0.4, 0.4, 0.4, 0.4, 0.4],
  },
  {
    label: "Travel expenses",
    crore: [839, 787, 816, 868, 910],
    pctOfRevenue: [1.3, 1.2, 1.2, 1.2, 1.3],
  },
  {
    label: "Branding and marketing",
    crore: [347, 309, 422, 384, 393],
    pctOfRevenue: [0.5, 0.5, 0.6, 0.5, 0.5],
  },
  {
    label: "Recruitment and training",
    crore: [163, 159, 143, 206, 245],
    pctOfRevenue: [0.3, 0.2, 0.2, 0.3, 0.3],
  },
  {
    label: "Legal and professional",
    crore: [197, 185, 201, 221, 210],
    pctOfRevenue: [0.3, 0.3, 0.3, 0.3, 0.3],
  },
  {
    label: "Provision for doubtful debts",
    crore: [25, 38, 37, 84, 84],
    pctOfRevenue: [0.0, 0.1, 0.1, 0.1, 0.1],
  },
  {
    label: "Other expenses",
    crore: [395, 447, 504, 593, 446],
    pctOfRevenue: [0.6, 0.7, 0.8, 0.8, 0.6],
  },
];

export const EXPENSE_TOTAL: ExpenseLine = {
  label: "Total expenses",
  crore: [47923, 49234, 50198, 52828, 54958],
  pctOfRevenue: [75.5, 74.8, 74.8, 74.7, 76.0],
};

/* ------------------------------------------------------------------ *
 * Revenue distribution by market. Percent of total revenue.
 * ------------------------------------------------------------------ */

export interface SegmentRow {
  label: string;
  group?: string;
  q1fy26: number;
  q4fy26: number;
  q1fy27: number;
  qoqCcPct: number;
  yoyCcPct: number;
  qoqInrPct: number;
  yoyInrPct: number;
}

export const GEOGRAPHY: SegmentRow[] = [
  {
    label: "North America",
    group: "Americas",
    q1fy26: 48.7,
    q4fy26: 48.5,
    q1fy27: 48.3,
    qoqCcPct: -0.4,
    yoyCcPct: 2.0,
    qoqInrPct: 1.7,
    yoyInrPct: 13.0,
  },
  {
    label: "Latin America",
    group: "Americas",
    q1fy26: 1.9,
    q4fy26: 1.9,
    q1fy27: 2.0,
    qoqCcPct: 0.6,
    yoyCcPct: -2.1,
    qoqInrPct: 5.7,
    yoyInrPct: 18.6,
  },
  {
    label: "United Kingdom",
    group: "Europe",
    q1fy26: 18.0,
    q4fy26: 17.2,
    q1fy27: 17.2,
    qoqCcPct: 0.3,
    yoyCcPct: -0.6,
    qoqInrPct: 1.9,
    yoyInrPct: 8.9,
  },
  {
    label: "Continental Europe",
    group: "Europe",
    q1fy26: 15.0,
    q4fy26: 15.6,
    q1fy27: 15.4,
    qoqCcPct: -0.2,
    yoyCcPct: 4.3,
    qoqInrPct: 1.1,
    yoyInrPct: 16.8,
  },
  {
    label: "Asia Pacific",
    q1fy26: 8.4,
    q4fy26: 8.3,
    q1fy27: 8.4,
    qoqCcPct: 1.4,
    yoyCcPct: 2.5,
    qoqInrPct: 4.0,
    yoyInrPct: 15.0,
  },
  {
    label: "India",
    q1fy26: 5.8,
    q4fy26: 6.0,
    q1fy27: 6.2,
    qoqCcPct: 7.6,
    yoyCcPct: 22.9,
    qoqInrPct: 7.7,
    yoyInrPct: 23.3,
  },
  {
    label: "Middle East and Africa",
    q1fy26: 2.2,
    q4fy26: 2.5,
    q1fy27: 2.5,
    qoqCcPct: -1.8,
    yoyCcPct: 7.6,
    qoqInrPct: 0.6,
    yoyInrPct: 22.2,
  },
];

export const VERTICALS: SegmentRow[] = [
  {
    label: "BFSI",
    q1fy26: 32.0,
    q4fy26: 31.6,
    q1fy27: 32.1,
    qoqCcPct: 1.6,
    yoyCcPct: 2.4,
    qoqInrPct: 3.6,
    yoyInrPct: 14.1,
  },
  {
    label: "Consumer business",
    q1fy26: 15.6,
    q4fy26: 15.7,
    q1fy27: 15.0,
    qoqCcPct: -4.0,
    yoyCcPct: -1.2,
    qoqInrPct: -2.2,
    yoyInrPct: 10.1,
  },
  {
    label: "Life sciences and healthcare",
    q1fy26: 10.2,
    q4fy26: 10.4,
    q1fy27: 10.3,
    qoqCcPct: -1.0,
    yoyCcPct: 3.5,
    qoqInrPct: 1.0,
    yoyInrPct: 15.1,
  },
  {
    label: "Manufacturing",
    q1fy26: 8.7,
    q4fy26: 8.8,
    q1fy27: 8.7,
    qoqCcPct: -0.5,
    yoyCcPct: 2.9,
    qoqInrPct: 1.4,
    yoyInrPct: 14.0,
  },
  {
    label: "Technology and services",
    q1fy26: 8.4,
    q4fy26: 8.4,
    q1fy27: 8.5,
    qoqCcPct: 1.7,
    yoyCcPct: 3.5,
    qoqInrPct: 3.6,
    yoyInrPct: 14.7,
  },
  {
    label: "Communication and media",
    q1fy26: 5.8,
    q4fy26: 5.8,
    q1fy27: 5.8,
    qoqCcPct: 0.3,
    yoyCcPct: 1.4,
    qoqInrPct: 2.0,
    yoyInrPct: 12.8,
  },
  {
    label: "Energy, resources and utilities",
    q1fy26: 5.9,
    q4fy26: 6.3,
    q1fy27: 6.3,
    qoqCcPct: -0.7,
    yoyCcPct: 6.9,
    qoqInrPct: 1.7,
    yoyInrPct: 20.5,
  },
  {
    label: "Regional markets and others",
    q1fy26: 13.4,
    q4fy26: 13.0,
    q1fy27: 13.3,
    qoqCcPct: 4.0,
    yoyCcPct: 9.0,
    qoqInrPct: 5.2,
    yoyInrPct: 14.3,
  },
];

/* ------------------------------------------------------------------ *
 * Client concentration bands, count of clients by LTM revenue.
 * ------------------------------------------------------------------ */

export interface ClientBand {
  band: string;
  q1fy26: number;
  q4fy26: number;
  q1fy27: number;
}

export const CLIENT_BANDS: ClientBand[] = [
  { band: "US$ 1m+", q1fy26: 1336, q4fy26: 1397, q1fy27: 1401 },
  { band: "US$ 5m+", q1fy26: 714, q4fy26: 738, q1fy27: 746 },
  { band: "US$ 10m+", q1fy26: 495, q4fy26: 499, q1fy27: 504 },
  { band: "US$ 20m+", q1fy26: 300, q4fy26: 311, q1fy27: 307 },
  { band: "US$ 50m+", q1fy26: 131, q4fy26: 139, q1fy27: 139 },
  { band: "US$ 100m+", q1fy26: 62, q4fy26: 66, q1fy27: 66 },
];

/* ------------------------------------------------------------------ *
 * People. Headcount runs one quarter further back than the P&L series.
 * ------------------------------------------------------------------ */

export interface HeadcountPoint {
  quarter: string;
  closing: number;
}

export const HEADCOUNT: HeadcountPoint[] = [
  { quarter: "Q4 FY25", closing: 607979 },
  { quarter: "Q1 FY26", closing: 613069 },
  { quarter: "Q2 FY26", closing: 593314 },
  { quarter: "Q3 FY26", closing: 582163 },
  { quarter: "Q4 FY26", closing: 584519 },
  { quarter: "Q1 FY27", closing: 593798 },
];

export const WORKFORCE = {
  /** Last twelve months voluntary attrition, IT Services, excluding subsidiaries. */
  attritionLtmPct: 13.6,
  womenPct: 35.0,
  nationalities: 148,
  learningHoursMnFytd: 14.6,
  competenciesAcquiredMnFytd: 1.3,
  associatesAdvancedAiMl: 312000,
} as const;

/* ------------------------------------------------------------------ *
 * Cash flow. ₹ Million.
 * ------------------------------------------------------------------ */

export interface CashFlowLine {
  label: string;
  q1fy26: number | null;
  q4fy26: number | null;
  q1fy27: number | null;
  unit: "inrMn" | "pct";
}

export const CASH_FLOW: CashFlowLine[] = [
  {
    label: "Net cash from operations",
    q1fy26: 128040,
    q4fy26: 146400,
    q1fy27: 124120,
    unit: "inrMn",
  },
  {
    label: "Capital expenditure",
    q1fy26: 14040,
    q4fy26: 11120,
    q1fy27: 7500,
    unit: "inrMn",
  },
  {
    label: "Acquisition of subsidiary",
    q1fy26: null,
    q4fy26: 62100,
    q1fy27: null,
    unit: "inrMn",
  },
  {
    label: "Free cash flow",
    q1fy26: 114000,
    q4fy26: 73180,
    q1fy27: 116620,
    unit: "inrMn",
  },
  {
    label: "Dividends paid",
    q1fy26: 109400,
    q4fy26: 206230,
    q1fy27: 115230,
    unit: "inrMn",
  },
  {
    label: "Operating cash flow to sales",
    q1fy26: 20.2,
    q4fy26: 20.7,
    q1fy27: 17.2,
    unit: "pct",
  },
  {
    label: "Operating cash flow to net profit",
    q1fy26: 100.3,
    q4fy26: 106.7,
    q1fy27: 93.0,
    unit: "pct",
  },
  {
    label: "Total cash and investments",
    q1fy26: 487040,
    q4fy26: 500200,
    q1fy27: 502320,
    unit: "inrMn",
  },
];

/* ------------------------------------------------------------------ *
 * Order book. Q1 FY27 total contract value.
 * ------------------------------------------------------------------ */

export const ORDER_BOOK = {
  totalTcvUsdBn: 9.5,
  northAmericaTcvUsdBn: 4.7,
  bfsiTcvUsdBn: 2.5,
  consumerBusinessTcvUsdBn: 1.4,
} as const;

/** Net client additions in the quarter, as stated in the highlights. */
export const CLIENT_ADDS_QOQ = {
  tenMillionPlus: 5,
  fiveMillionPlus: 8,
  oneMillionPlus: 4,
} as const;

/* ------------------------------------------------------------------ *
 * Peer set for the industry tab. Tickers are Yahoo Finance symbols and
 * were each verified to resolve before being listed here.
 * ------------------------------------------------------------------ */

export interface PeerDef {
  name: string;
  short: string;
  symbol: string;
  region: "India" | "Global";
  currency: "INR" | "USD";
}

export const PEERS: PeerDef[] = [
  { name: "Tata Consultancy Services", short: "TCS", symbol: "TCS.NS", region: "India", currency: "INR" },
  { name: "Infosys", short: "Infosys", symbol: "INFY.NS", region: "India", currency: "INR" },
  { name: "HCLTech", short: "HCLTech", symbol: "HCLTECH.NS", region: "India", currency: "INR" },
  { name: "Wipro", short: "Wipro", symbol: "WIPRO.NS", region: "India", currency: "INR" },
  { name: "Tech Mahindra", short: "Tech M", symbol: "TECHM.NS", region: "India", currency: "INR" },
  { name: "Mphasis", short: "Mphasis", symbol: "MPHASIS.NS", region: "India", currency: "INR" },
  { name: "Coforge", short: "Coforge", symbol: "COFORGE.NS", region: "India", currency: "INR" },
  { name: "Persistent Systems", short: "Persistent", symbol: "PERSISTENT.NS", region: "India", currency: "INR" },
  { name: "Accenture", short: "Accenture", symbol: "ACN", region: "Global", currency: "USD" },
  { name: "Cognizant", short: "Cognizant", symbol: "CTSH", region: "Global", currency: "USD" },
  { name: "IBM", short: "IBM", symbol: "IBM", region: "Global", currency: "USD" },
];

export const INDICES = [
  { name: "Nifty IT", symbol: "^CNXIT" },
  { name: "Nifty 50", symbol: "^NSEI" },
];
