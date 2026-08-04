/**
 * Retrieval corpus: product documentation, per-row data passages, and live
 * news and filing extracts. Live passages carry untrusted = true and are
 * fenced before reaching a prompt.
 *
 * Passages are complete statements with figures inline, so an extractive
 * answer can quote rather than reconstruct.
 */

import type { RagDoc } from "@/lib/rag/bm25";
import type { NewsItem, Quote } from "@/lib/core/types";
import {
  BASELINE_SOURCE,
  CASH_FLOW,
  CLIENT_BANDS,
  EPS_INR,
  EXPENSES,
  EXPENSE_TOTAL,
  GEOGRAPHY,
  GROWTH,
  HEADCOUNT,
  ORDER_BOOK,
  PNL,
  QUARTERS,
  VERTICALS,
  WORKFORCE,
} from "@/lib/data/tcs-baseline";
import { neutraliseUntrusted } from "@/lib/security/sanitize";

const FILING = `${BASELINE_SOURCE.document}, published ${BASELINE_SOURCE.publishedOn}`;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/* ------------------------------------------------------------------ *
 * 1. Product passages
 * ------------------------------------------------------------------ */

const PRODUCT_DOCS: RagDoc[] = [
  {
    id: "product:overview",
    title: "What this console is",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "The EY IT Services Intelligence Console is an agentic dashboard covering the large IT services companies. " +
      "It has three dashboards. Dashboard one, Industry Signal, covers key news on overall industry calls by the large IT companies, " +
      "merger and acquisition activity, market prices and headline KPIs including revenue growth. " +
      "Dashboard two, Quarterly P&L, is the quarterly profit and loss statement with expense analysis and cash flow. " +
      "Dashboard three, KPI Detail, covers revenue distribution by geography and vertical, client concentration, headcount and attrition. " +
      "A separate agents console runs due diligence agents. Every figure carries a provenance marker showing whether it is live, cached, parsed from a filing, or from the checked-in baseline.",
  },
  {
    id: "product:tab1",
    title: "Dashboard one, Industry Signal",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Dashboard one is Industry Signal. It shows a live news feed filtered into categories covering earnings and guidance, deal wins and order book, " +
      "mergers and acquisitions, hiring and attrition, and the demand environment including AI adoption. " +
      "It shows live market prices for the Indian IT majors and the global peers, a rebased relative performance chart so companies priced in different currencies share one axis, " +
      "and the Nifty IT index. News is retrieved from Google News RSS and Yahoo Finance RSS. Prices come from the Yahoo Finance chart endpoint. " +
      "Category labels on news items are assigned by keyword rules, not by a model, and are marked heuristic.",
  },
  {
    id: "product:tab2",
    title: "Dashboard two, Quarterly P&L",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Dashboard two is the quarterly profit and loss statement. It shows the consolidated IFRS income statement from revenue through cost of revenue, " +
      "gross margin, SG&A expenses, operating income, other income, taxes and net income, each as an absolute figure and as a percent of revenue. " +
      "It shows the five-quarter revenue and margin trend, expense by nature across thirteen categories, and the cash flow summary including free cash flow and dividends. " +
      "Amounts can be switched between Indian rupees and US dollars. Company-reported USD figures are shown as the company translated them; " +
      "derived conversions use the live USD to INR rate and are labelled as derived.",
  },
  {
    id: "product:tab3",
    title: "Dashboard three, KPI Detail",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Dashboard three is KPI Detail. It shows revenue distribution by geography covering North America, Latin America, the United Kingdom, " +
      "Continental Europe, Asia Pacific, India and the Middle East and Africa, each with quarter on quarter and year on year growth in both constant currency and rupees. " +
      "It shows revenue distribution by vertical covering BFSI, consumer business, life sciences and healthcare, manufacturing, technology and services, " +
      "communication and media, energy resources and utilities, and regional markets. " +
      "It also shows client concentration by revenue band, closing headcount by quarter, voluntary attrition, and workforce diversity.",
  },
  {
    id: "product:agents",
    title: "The due diligence agents",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "The agents console runs seven agents, each with named skills. The Filings Harvester downloads and parses the latest quarterly fact sheet directly from the company investor relations site. " +
      "The Market Pulse agent pulls live quotes and computes relative performance. The Transaction Scanner reads the news feed for merger and acquisition signals. " +
      "The Margin Analyst decomposes the operating margin bridge. The Workforce Analyst assesses headcount and attrition. " +
      "The Currency Normaliser applies the live foreign exchange rate to derived figures. The Diligence Lead composes the other agents' findings into a single review. " +
      "Each run produces a step-by-step trace, findings with severity, and downloadable artifacts as CSV or JSON.",
  },
  {
    id: "product:provenance",
    title: "How provenance labelling works",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Every figure carries one of five provenance markers. Live means fetched from the upstream source on this request. " +
      "Cached means served from the local cache because upstream was not re-contacted or was unreachable. " +
      "Filing means parsed from a company filing document. Baseline means upstream failed and the checked-in verified dataset was substituted. " +
      "Unavailable means there is nothing to show and the field reads Not set. " +
      "Nothing on this console is estimated, modelled or interpolated. If a figure was not in the source, it is not displayed.",
  },
  {
    id: "product:security",
    title: "How the console is protected",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "The console refuses automated clients, rate limits every class of request, and rejects cross-origin calls to its JSON endpoints. " +
      "A strict content security policy permits no external origin for scripts, styles, fonts or frames, so there is no channel to send rendered data to a third party host. " +
      "Robots directives refuse all crawlers including the named AI ingestion agents. " +
      "There is no SQL database in this application, which removes SQL injection structurally. " +
      "Text arriving from third parties, such as news headlines and filing lines, is stripped of markup and control characters, " +
      "and instruction-shaped phrasing is defanged before it can reach a model prompt.",
  },
];

/* ------------------------------------------------------------------ *
 * 2. Data passages
 * ------------------------------------------------------------------ */

function growthDocs(): RagDoc[] {
  const docs: RagDoc[] = [];

  for (const row of GROWTH) {
    docs.push({
      id: `growth:${row.quarter}`,
      title: `${row.quarter} revenue and margins`,
      section: "Financials",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `In ${row.quarter}, TCS reported revenue of ${fmt(row.revenueInrMn)} million rupees, ` +
        `equivalent to ${fmt(row.revenueUsdMn)} million US dollars as translated by the company. ` +
        `Revenue moved ${pct(row.qoqInrPct)} quarter on quarter in rupees, ${pct(row.qoqUsdPct)} in US dollars, ` +
        `and ${pct(row.qoqCcPct)} in constant currency. ` +
        `Operating income was ${fmt(row.operatingIncomeInrMn)} million rupees giving an operating margin of ${row.operatingMarginPct.toFixed(1)} percent. ` +
        `Net income was ${fmt(row.netIncomeInrMn)} million rupees giving a net margin of ${row.netMarginPct.toFixed(1)} percent.`,
    });
  }

  const first = GROWTH[0];
  const last = GROWTH[GROWTH.length - 1];
  docs.push({
    id: "growth:trend",
    title: "Five quarter revenue and margin trend",
    section: "Financials",
    source: FILING,
    url: BASELINE_SOURCE.url,
    untrusted: false,
    body:
      `Across the five quarters from ${first.quarter} to ${last.quarter}, TCS revenue rose from ` +
      `${fmt(first.revenueInrMn)} to ${fmt(last.revenueInrMn)} million rupees, a gain of ` +
      `${(((last.revenueInrMn - first.revenueInrMn) / first.revenueInrMn) * 100).toFixed(1)} percent. ` +
      `In US dollars the same period moved from ${fmt(first.revenueUsdMn)} to ${fmt(last.revenueUsdMn)} million, a gain of ` +
      `${(((last.revenueUsdMn - first.revenueUsdMn) / first.revenueUsdMn) * 100).toFixed(1)} percent, ` +
      `which is the currency effect: rupee revenue grew far faster than dollar revenue over the period. ` +
      `The operating margin moved from ${first.operatingMarginPct.toFixed(1)} percent to ${last.operatingMarginPct.toFixed(1)} percent, ` +
      `peaking at ${Math.max(...GROWTH.map((g) => g.operatingMarginPct)).toFixed(1)} percent. ` +
      `The net margin moved from ${first.netMarginPct.toFixed(1)} to ${last.netMarginPct.toFixed(1)} percent.`,
  });

  return docs;
}

function pnlDocs(): RagDoc[] {
  const docs: RagDoc[] = PNL.map((line) => ({
    id: `pnl:${line.label}`,
    title: `${line.label}, quarterly income statement`,
    section: "Financials",
    source: FILING,
    url: BASELINE_SOURCE.url,
    untrusted: false,
    body:
      `On the consolidated IFRS income statement, ${line.label.toLowerCase()} was ` +
      `${fmt(line.q1fy27)} million rupees in Q1 FY27, ${fmt(line.q4fy26)} million in Q4 FY26 and ` +
      `${fmt(line.q1fy26)} million in Q1 FY26. As a percent of revenue that is ` +
      `${line.pctQ1fy27.toFixed(1)} percent, ${line.pctQ4fy26.toFixed(1)} percent and ${line.pctQ1fy26.toFixed(1)} percent respectively. ` +
      `Year on year the line moved ${pct(((line.q1fy27 - line.q1fy26) / line.q1fy26) * 100)}.`,
  }));

  docs.push({
    id: "pnl:eps",
    title: "Earnings per share",
    section: "Financials",
    source: FILING,
    url: BASELINE_SOURCE.url,
    untrusted: false,
    body:
      `Earnings per share was ${EPS_INR.q1fy27} rupees in Q1 FY27, against ${EPS_INR.q4fy26} rupees in Q4 FY26 and ` +
      `${EPS_INR.q1fy26} rupees in Q1 FY26, a year on year increase of ` +
      `${(((EPS_INR.q1fy27 - EPS_INR.q1fy26) / EPS_INR.q1fy26) * 100).toFixed(1)} percent.`,
  });

  return docs;
}

function expenseDocs(): RagDoc[] {
  const docs = EXPENSES.map((line) => ({
    id: `expense:${line.label}`,
    title: `${line.label}, expense by nature`,
    section: "Financials",
    source: FILING,
    url: BASELINE_SOURCE.url,
    untrusted: false,
    body:
      `${line.label} was ${fmt(line.crore[4])} crore in Q1 FY27, which is ${line.pctOfRevenue[4].toFixed(1)} percent of revenue. ` +
      `Across the five quarters from Q1 FY26 the series ran ${line.crore.map(fmt).join(", ")} crore, ` +
      `and as a percent of revenue ${line.pctOfRevenue.map((p) => p.toFixed(1)).join(", ")} percent. ` +
      `Year on year the line moved ${pct(((line.crore[4] - line.crore[0]) / line.crore[0]) * 100)}, ` +
      `and its share of revenue moved ${(line.pctOfRevenue[4] - line.pctOfRevenue[0]).toFixed(1)} percentage points.`,
  }));

  docs.push({
    id: "expense:total",
    title: "Total expenses",
    section: "Financials",
    source: FILING,
    url: BASELINE_SOURCE.url,
    untrusted: false,
    body:
      `Total expenses were ${fmt(EXPENSE_TOTAL.crore[4])} crore in Q1 FY27, ${EXPENSE_TOTAL.pctOfRevenue[4].toFixed(1)} percent of revenue, ` +
      `up from ${fmt(EXPENSE_TOTAL.crore[0])} crore and ${EXPENSE_TOTAL.pctOfRevenue[0].toFixed(1)} percent of revenue in Q1 FY26. ` +
      `The largest single line is employee cost at ${EXPENSES[0].pctOfRevenue[4].toFixed(1)} percent of revenue. ` +
      `The fastest growing line year on year is fees to external consultants.`,
  });

  return docs;
}

function segmentDocs(): RagDoc[] {
  const docs: RagDoc[] = [];

  for (const row of GEOGRAPHY) {
    docs.push({
      id: `geo:${row.label}`,
      title: `${row.label} revenue share and growth`,
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `${row.label} accounted for ${row.q1fy27.toFixed(1)} percent of TCS revenue in Q1 FY27, ` +
        `against ${row.q4fy26.toFixed(1)} percent in Q4 FY26 and ${row.q1fy26.toFixed(1)} percent in Q1 FY26. ` +
        `Growth was ${pct(row.qoqCcPct)} quarter on quarter and ${pct(row.yoyCcPct)} year on year in constant currency, ` +
        `and ${pct(row.qoqInrPct)} quarter on quarter and ${pct(row.yoyInrPct)} year on year in rupees. ` +
        (row.group ? `It sits within the ${row.group} region. ` : "") +
        `This is a geography, or market, breakdown of revenue distribution.`,
    });
  }

  for (const row of VERTICALS) {
    docs.push({
      id: `vertical:${row.label}`,
      title: `${row.label} vertical revenue share and growth`,
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `The ${row.label} vertical accounted for ${row.q1fy27.toFixed(1)} percent of TCS revenue in Q1 FY27, ` +
        `against ${row.q4fy26.toFixed(1)} percent in Q4 FY26 and ${row.q1fy26.toFixed(1)} percent in Q1 FY26. ` +
        `Growth was ${pct(row.qoqCcPct)} quarter on quarter and ${pct(row.yoyCcPct)} year on year in constant currency, ` +
        `and ${pct(row.qoqInrPct)} quarter on quarter and ${pct(row.yoyInrPct)} year on year in rupees. ` +
        `This is a domain, or industry vertical, breakdown of revenue distribution.`,
    });
  }

  return docs;
}

function peopleDocs(): RagDoc[] {
  const latest = HEADCOUNT[HEADCOUNT.length - 1];
  const peak = HEADCOUNT.reduce((a, b) => (b.closing > a.closing ? b : a));
  const trough = HEADCOUNT.reduce((a, b) => (b.closing < a.closing ? b : a));

  return [
    {
      id: "people:headcount",
      title: "Closing headcount by quarter",
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `TCS closing headcount was ${fmt(latest.closing)} at the end of ${latest.quarter}. ` +
        `The six quarter series ran ${HEADCOUNT.map((h) => `${h.quarter} ${fmt(h.closing)}`).join(", ")}. ` +
        `The peak in this window was ${fmt(peak.closing)} in ${peak.quarter} and the trough was ${fmt(trough.closing)} in ${trough.quarter}, ` +
        `a peak to trough reduction of ${fmt(peak.closing - trough.closing)} employees or ` +
        `${(((peak.closing - trough.closing) / peak.closing) * 100).toFixed(1)} percent. ` +
        `Headcount has since recovered by ${fmt(latest.closing - trough.closing)} from the trough.`,
    },
    {
      id: "people:attrition",
      title: "Voluntary attrition and workforce mix",
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `Voluntary attrition on a last twelve months basis was ${WORKFORCE.attritionLtmPct} percent in IT Services, excluding subsidiaries. ` +
        `Women make up ${WORKFORCE.womenPct} percent of the workforce and the company employs ${WORKFORCE.nationalities} nationalities. ` +
        `Learning hours were ${WORKFORCE.learningHoursMnFytd} million in the fiscal year to date and ` +
        `${WORKFORCE.competenciesAcquiredMnFytd} million competencies were acquired. ` +
        `Over ${fmt(WORKFORCE.associatesAdvancedAiMl)} associates hold higher proficiency in artificial intelligence and machine learning. ` +
        `Attrition is a retention and workforce cost indicator: a rising rate raises recruitment and training expense and pressures delivery margin.`,
    },
    {
      id: "people:clients",
      title: "Client concentration by revenue band",
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `Client counts by last twelve months revenue band in Q1 FY27 were ` +
        CLIENT_BANDS.map((b) => `${b.band} ${fmt(b.q1fy27)} clients`).join(", ") +
        `. Against Q4 FY26 the movements were ` +
        CLIENT_BANDS.map(
          (b) => `${b.band} ${b.q1fy27 - b.q4fy26 >= 0 ? "+" : ""}${b.q1fy27 - b.q4fy26}`,
        ).join(", ") +
        `. Client concentration is a due diligence indicator: growth in the higher bands shows account mining is working, ` +
        `while a fall in a high band can signal a large account being lost or descoped.`,
    },
    {
      id: "people:orderbook",
      title: "Order book and total contract value",
      section: "KPI",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        `Order book total contract value in Q1 FY27 was ${ORDER_BOOK.totalTcvUsdBn} billion US dollars. ` +
        `North America contributed ${ORDER_BOOK.northAmericaTcvUsdBn} billion, BFSI ${ORDER_BOOK.bfsiTcvUsdBn} billion and ` +
        `consumer business ${ORDER_BOOK.consumerBusinessTcvUsdBn} billion. ` +
        `Total contract value is the headline forward demand indicator for an IT services company and is the closest thing to a bookings figure the sector discloses.`,
    },
  ];
}

function cashFlowDocs(): RagDoc[] {
  return [
    {
      id: "cash:summary",
      title: "Cash flow summary",
      section: "Financials",
      source: FILING,
      url: BASELINE_SOURCE.url,
      untrusted: false,
      body:
        CASH_FLOW.map((line) => {
          const v = line.q1fy27;
          if (v === null) return `${line.label} was not reported in Q1 FY27`;
          return line.unit === "pct"
            ? `${line.label} was ${v.toFixed(1)} percent in Q1 FY27`
            : `${line.label} was ${fmt(v)} million rupees in Q1 FY27`;
        }).join(", ") +
        `. Operating cash flow conversion against net profit fell to 93.0 percent from 106.7 percent in Q4 FY26, ` +
        `which is the cash quality signal a diligence review would test first.`,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 3. Live passages
 * ------------------------------------------------------------------ */

export function newsDocs(items: NewsItem[]): RagDoc[] {
  return items.slice(0, 60).map((item) => {
    // Third-party text. Defanged before it can enter a prompt.
    const safe = neutraliseUntrusted(item.title);
    return {
      id: `news:${item.id}`,
      title: safe.text,
      section: "Industry news",
      source: `${item.publisher}${item.publishedAt ? `, ${item.publishedAt.slice(0, 10)}` : ""}`,
      url: item.url,
      untrusted: true,
      body:
        `Headline reported by ${item.publisher}: ${safe.text}. ` +
        `Category ${item.category}. ` +
        (item.companies.length ? `Companies mentioned: ${item.companies.join(", ")}. ` : "") +
        (item.publishedAt ? `Published ${item.publishedAt.slice(0, 10)}.` : ""),
    };
  });
}

export function quoteDocs(quotes: Quote[]): RagDoc[] {
  return quotes.map((q) => ({
    id: `quote:${q.symbol}`,
    title: `${q.name} share price`,
    section: "Markets",
    source: "Yahoo Finance",
    untrusted: false,
    body:
      `${q.name}, ticker ${q.symbol}, last traded at ${q.price.toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })} ${q.currency}` +
      (q.changePct !== null ? `, a move of ${pct(q.changePct)} against the previous close` : "") +
      (q.fiftyTwoWeekLow !== null && q.fiftyTwoWeekHigh !== null
        ? `. The fifty two week range is ${q.fiftyTwoWeekLow.toLocaleString("en-US", {
            maximumFractionDigits: 2,
          })} to ${q.fiftyTwoWeekHigh.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : "") +
      (q.exchange ? `. Listed on ${q.exchange}` : "") +
      ".",
  }));
}

export function filingLineDocs(lines: string[], label: string, url: string): RagDoc[] {
  // Only lines with real content are worth indexing. Slide furniture and page
  // numbers add noise and dilute IDF.
  const useful = lines.filter(
    (l) => l.trim().length > 30 && /\d/.test(l) && !/^\s*\d+\s*$/.test(l),
  );

  return useful.slice(0, 160).map((line, i) => {
    const safe = neutraliseUntrusted(line);
    return {
      id: `filingline:${i}`,
      title: `${label} filing extract ${i + 1}`,
      section: "Filing extract",
      source: `${label} Fact Sheet, parsed from the source PDF`,
      url,
      untrusted: true,
      body: safe.text,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/** The passages that need no network access. Always available. */
export function staticCorpus(): RagDoc[] {
  return [
    ...PRODUCT_DOCS,
    ...DILIGENCE_DOCS,
    ...growthDocs(),
    ...pnlDocs(),
    ...expenseDocs(),
    ...segmentDocs(),
    ...peopleDocs(),
    ...cashFlowDocs(),
  ];
}

/* ------------------------------------------------------------------ *
 * Due diligence method passages
 * ------------------------------------------------------------------ */

const DILIGENCE_DOCS: RagDoc[] = [
  {
    id: "dd:revenue-quality",
    title: "Revenue quality tests in an IT services diligence",
    section: "Diligence method",
    source: "Console methodology notes",
    untrusted: false,
    body:
      "Revenue quality for an IT services business is tested on four axes. First, constant currency growth against reported growth: " +
      "a wide gap means the reported number is a currency effect rather than demand. " +
      "Second, order book total contract value against revenue: book to bill below one for consecutive quarters signals a shrinking pipeline. " +
      "Third, client concentration by band: growth concentrated in the top band raises dependency risk. " +
      "Fourth, geography and vertical mix: a single region above roughly half of revenue means the business is exposed to one macro cycle. " +
      "For TCS in Q1 FY27 the reported rupee growth of 13.9 percent year on year against constant currency growth of 3.2 percent " +
      "shows most of the headline growth is translation, not volume.",
  },
  {
    id: "dd:margin-bridge",
    title: "Reading the operating margin bridge",
    section: "Diligence method",
    source: "Console methodology notes",
    untrusted: false,
    body:
      "Operating margin in IT services moves on a small number of levers: employee cost as a percent of revenue, " +
      "subcontractor and external consultant fees, utilisation, offshore to onsite mix, and currency. " +
      "A margin fall accompanied by rising external consultant fees usually means demand was met with bought-in capacity rather than owned headcount, " +
      "which is faster but structurally lower margin. " +
      "For TCS the operating margin fell from 25.3 percent in Q4 FY26 to 24.0 percent in Q1 FY27 while fees to external consultants rose from " +
      "5.6 to 5.9 percent of revenue and employee cost rose from 56.8 to 58.3 percent of revenue, so both owned and bought-in capacity cost more.",
  },
  {
    id: "dd:attrition",
    title: "What attrition tells a diligence reviewer",
    section: "Diligence method",
    source: "Console methodology notes",
    untrusted: false,
    body:
      "Attrition is read alongside headcount, not on its own. Falling attrition with falling headcount indicates the company is not replacing leavers, " +
      "which flatters the attrition rate while capacity shrinks. Rising attrition with rising headcount indicates competitive pressure on talent " +
      "and forward margin risk through wage inflation and recruitment cost. " +
      "Industry attrition below roughly 12 percent is historically low for Indian IT services and above roughly 20 percent is stressed. " +
      "TCS reported 13.6 percent last twelve months voluntary attrition in IT Services alongside a headcount that fell from a peak of 613,069 " +
      "in Q1 FY26 to a trough of 582,163 in Q3 FY26 before recovering to 593,798 in Q1 FY27.",
  },
  {
    id: "dd:cash",
    title: "Cash conversion as a diligence signal",
    section: "Diligence method",
    source: "Console methodology notes",
    untrusted: false,
    body:
      "Operating cash flow to net profit is the fastest test of earnings quality. A services business with no inventory should convert " +
      "close to or above 100 percent over a full year. Persistent conversion below 90 percent points to receivables stretching, " +
      "which in this sector usually means either a large client delaying payment or revenue recognised ahead of billing on fixed-price contracts. " +
      "TCS converted 93.0 percent in Q1 FY27 against 106.7 percent in Q4 FY26 and 100.3 percent in Q1 FY26. " +
      "A single soft quarter is normal seasonality; two consecutive quarters would warrant a receivables ageing review.",
  },
  {
    id: "dd:manda",
    title: "Screening merger and acquisition activity",
    section: "Diligence method",
    source: "Console methodology notes",
    untrusted: false,
    body:
      "Merger and acquisition screening in IT services watches for three patterns. Capability acquisitions, typically small engineering or " +
      "data firms bought to fill a delivery gap. Scale acquisitions, where a mid-tier provider is absorbed for headcount and client base. " +
      "And carve-outs, where a client transfers a captive operation to the provider under a long-term contract, which shows up as both an acquisition and a large deal win. " +
      "The third pattern is the most informative because it converts one-off consideration into recurring revenue. " +
      "The Transaction Scanner agent categorises news items into these patterns using keyword rules and labels the classification as heuristic.",
  },
];
