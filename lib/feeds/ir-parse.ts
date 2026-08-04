/**
 * Investor relations document paths and parsing.
 *
 * Deliberately free of application imports so the same code runs inside the app
 * and inside scripts/harvest-ir.mts, which executes under bare Node. Duplicating
 * the parser for the generator would guarantee the two drift apart.
 */

export interface IrDocRef {
  label: string;
  fiscalYear: string;
  quarter: 1 | 2 | 3 | 4;
  url: string;
}

export interface IrQuarter {
  label: string;
  url: string;
  revenueInrMn: number | null;
  revenueUsdMn: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  headcount: number | null;
  attritionLtmPct: number | null;
  orderBookUsdBn: number | null;
  ccGrowthYoyPct: number | null;
  inrGrowthYoyPct: number | null;
  /** Fraction of expected fields recovered. */
  confidence: number;
}

/* ---------------------------------------------------------------- *
 * Document paths
 * ---------------------------------------------------------------- */

/**
 * Indian fiscal years run April to March. A quarter's fact sheet lands roughly
 * three to four weeks after the quarter closes.
 */
function indianQuarters(now: Date, count: number): Array<{ fy: string; q: 1 | 2 | 3 | 4; label: string }> {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  let fyStart = month >= 3 ? year : year - 1;
  let q: 1 | 2 | 3 | 4;
  if (month >= 6 && month <= 8) q = 1;
  else if (month >= 9 && month <= 11) q = 2;
  else if (month >= 0 && month <= 2) q = 3;
  else q = 4;

  if (q === 4) fyStart -= 1;

  const out: Array<{ fy: string; q: 1 | 2 | 3 | 4; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    out.push({ fy, q, label: `Q${q} FY${String((fyStart + 1) % 100).padStart(2, "0")}` });
    if (q === 1) {
      q = 4;
      fyStart -= 1;
    } else {
      q = (q - 1) as 1 | 2 | 3;
    }
  }
  return out;
}

interface IrSource {
  symbol: string;
  name: string;
  irUrl: string;
  build(now: Date, count: number): IrDocRef[];
}

export const IR_SOURCES: IrSource[] = [
  {
    symbol: "TCS.NS",
    name: "Tata Consultancy Services",
    irUrl: "https://www.tcs.com/investor-relations/financial-statements",
    build: (now, count) =>
      indianQuarters(now, count).map(({ fy, q, label }) => ({
        label,
        fiscalYear: fy,
        quarter: q,
        url:
          "https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/" +
          `${fy}/q${q}/Presentations/${encodeURIComponent(`Q${q} ${fy} Fact Sheet.pdf`)}`,
      })),
  },
];

export function irSourceFor(symbol: string): IrSource | null {
  return IR_SOURCES.find((s) => s.symbol === symbol) ?? null;
}

/* ---------------------------------------------------------------- *
 * Parsing
 * ---------------------------------------------------------------- */

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

function firstMatch(lines: string[], re: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m;
  }
  return null;
}

/**
 * Reads the headline block of a quarterly fact sheet.
 *
 * The currency glyph does not survive the subset-font mapping in these decks,
 * so the prefixes ("INR Revenue of", "USD Revenue of") are the anchors rather
 * than the symbol.
 */
export function parseIrQuarter(lines: string[], ref: IrDocRef): IrQuarter {
  const inr = firstMatch(
    lines,
    /INR Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn[^|]*?(?:up|down)\s*(-?[\d.]+)%\s*YoY/i,
  );
  const usd = firstMatch(lines, /USD Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn/i);
  const cc = firstMatch(
    lines,
    /Constant currency revenue[^|]*?(?:up|down)\s*(-?[\d.]+)%\s*YoY/i,
  );
  const op = firstMatch(lines, /Operating Margin at\s*(-?[\d.]+)\s*%/i);
  const net = firstMatch(lines, /Net Margin at\s*(-?[\d.]+)\s*%/i);
  const head = firstMatch(lines, /Closing headcount\s*:?\s*([\d,]+)/i);
  const attr = firstMatch(lines, /LTM attrition at\s*([\d.]+)\s*%/i);
  const tcv = firstMatch(lines, /Order book TCV at\s*\$?\s*([\d.]+)\s*Bn/i);

  const q: IrQuarter = {
    label: ref.label,
    url: ref.url,
    revenueInrMn: num(inr?.[1]),
    revenueUsdMn: num(usd?.[1]),
    inrGrowthYoyPct: num(inr?.[2]),
    ccGrowthYoyPct: num(cc?.[1]),
    operatingMarginPct: num(op?.[1]),
    netMarginPct: num(net?.[1]),
    headcount: num(head?.[1]),
    attritionLtmPct: num(attr?.[1]),
    orderBookUsdBn: num(tcv?.[1]),
    confidence: 0,
  };

  const fields = [
    q.revenueInrMn,
    q.revenueUsdMn,
    q.operatingMarginPct,
    q.netMarginPct,
    q.headcount,
    q.attritionLtmPct,
    q.orderBookUsdBn,
  ];
  q.confidence = fields.filter((f) => f !== null).length / fields.length;

  return q;
}
