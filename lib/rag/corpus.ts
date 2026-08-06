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

const PRODUCT_DOCS: RagDoc[] = [
  {
    id: "product:overview",
    title: "What this console is",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "EY TMT Intelligence is a technology, media and telecom console with a due diligence operating system. " +
      "Dashboard one, Sector signal, covers fifty six listed names, five reference indices, theme exposure across AI compute, agentic AI and physical AI, and verified press coverage. " +
      "Dashboard two, Quarterly P&L, rebuilds the income statement for any company in the universe from its own regulatory tagging. " +
      "Dashboard three, KPI detail, computes quality measures and benchmarks them against the company's subsector cohort. " +
      "Dashboard four, Company research, assembles a dossier on any company in the SEC register and accepts private documents. " +
      "Dashboard five is the diligence operating system: forty seven agents across ten workstreams from screening to committee paper, plus portfolio monitoring. " +
      "Every figure carries a provenance marker and nothing is estimated.",
  },
  {
    id: "product:tab1",
    title: "Dashboard one, Sector signal",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Sector signal covers the technology, media and telecom universe. Live prices for every constituent and five reference indices, " +
      "a rebased relative performance chart so names priced in different currencies share one axis, " +
      "theme exposure showing the average day move across the AI compute, agentic AI, physical AI, cloud, connectivity and streaming cohorts, " +
      "and coverage across nine standing queries restricted to a verified publisher allowlist. " +
      "Publisher tiers run primary and wire, financial press, and trade press. Unlisted outlets are discarded at ingestion.",
  },
  {
    id: "product:tab2",
    title: "Dashboard two, Quarterly P&L",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Quarterly P&L rebuilds the income statement for any company in the coverage universe from SEC XBRL company facts, " +
      "reading both the US GAAP and IFRS taxonomies so foreign private issuers resolve. " +
      "Concepts are merged across every tag a filer has used, restated periods take the most recently filed value, " +
      "and the fourth quarter is derived as full year less three reported quarters and flagged as derived. " +
      "Companies outside the SEC register, such as the Indian IT majors, are covered by parsing their own published quarterly fact sheets.",
  },
  {
    id: "product:tab3",
    title: "Dashboard three, KPI detail",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "KPI detail computes nine quality measures for any company in the universe: gross, operating and net margin, research intensity, " +
      "cash conversion, free cash margin, receivable days, return on equity and share-based compensation, each with a plain reading of what it indicates. " +
      "Ratios are computed only where the numerator and denominator cover the same reporting period, and a ratio whose base is too close to zero is suppressed. " +
      "The benchmark panel compares the subject against its own subsector cohort on the same source and the same rules.",
  },
  {
    id: "product:agents",
    title: "The diligence operating system",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "The operating system runs forty seven agents across ten workstreams: context and intake, screening and thesis, commercial, financial, " +
      "operational, legal regulatory and tax, people and culture, ESG and sustainability, synthesis and decision, and portfolio monitoring. " +
      "Each agent holds a defined role, declares the evidence it needs, and hands to the agent after it. " +
      "An agent with evidence returns a finding backed by sources. An agent without it returns the document request that would close the gap, " +
      "with who holds that document. A full review runs screening through to the committee paper carrying findings forward, " +
      "so the Consistency agent cross-checks every figure and the Adversary agent argues against the assembled case. " +
      "Human gates mark the agents whose output requires sign-off before a workstream closes.",
  },
  {
    id: "product:provenance",
    title: "How provenance labelling works",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "Every figure carries one of five provenance markers. Live means fetched from the upstream source on this request. " +
      "Cached means served from the local cache with its retrieval time shown. " +
      "Filing means parsed from a regulatory filing or a company's own published document. " +
      "Baseline means the source refuses this host's network, so a dated snapshot taken where the fetch succeeds was used, and the date is shown. " +
      "Unavailable means there is nothing to show and the field reads Not set. " +
      "Nothing on this console is estimated, modelled or interpolated.",
  },
  {
    id: "product:security",
    title: "How the console is protected",
    section: "Product",
    source: "Console documentation",
    untrusted: false,
    body:
      "The console refuses automated clients, rate limits every class of request, and rejects cross-origin calls to its endpoints. " +
      "A strict content security policy permits no external origin, so there is no channel to send rendered data to a third party host. " +
      "There is no database and no server-side storage: uploaded documents are parsed in the request that carries them and returned to the browser, which holds them for the tab session only. " +
      "Text arriving from third parties is stripped of markup and control characters, and instruction-shaped phrasing is defanged before it can reach a model prompt.",
  },
];

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

export function newsDocs(items: NewsItem[]): RagDoc[] {
  return items.slice(0, 60).map((item) => {
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
