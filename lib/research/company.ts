import type { AgentFinding, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";
import {
  CONCEPTS,
  annualSeries,
  getConcept,
  getProfile,
  resolveCik,
  searchCompanies,
  type FactPoint,
  type SecFiling,
} from "@/lib/feeds/sec";
import { getQuote } from "@/lib/feeds/markets";
import { getCompanyNews } from "@/lib/feeds/news";
import { findCompany, UNIVERSE, type Company } from "@/lib/data/universe";
import { getIrHistory } from "@/lib/feeds/ir";
import type { IrQuarter } from "@/lib/feeds/ir-parse";
import { getFactLedger, type FactKey, type FactLedger } from "@/lib/research/facts";
import { getFilingText, type FilingText } from "@/lib/research/filing-text";
import { scrapeIr, type IrScrapeResult } from "@/lib/research/ir-scrape";
import { buildLedgerFromIr } from "@/lib/research/ir-facts";
import { getFxTable } from "@/lib/feeds/fx";
import type { NewsItem, Quote } from "@/lib/core/types";

export interface FinancialSeries {
  metric: string;
  tag: string;
  unit: "USD";
  periodType: "annual" | "quarterly";
  points: Array<{ period: string; label: string; value: number; form: string; filed: string }>;
}

export interface CompanyDossier {
  query: string;
  resolved: {
    name: string;
    cik: string | null;
    tickers: string[];
    exchanges: string[];
    sicDescription: string | null;
    inUniverse: Company | null;
  };
  quote: Quote | null;
  filings: SecFiling[];
  financials: FinancialSeries[];
  derived: {
    revenueCagrPct: number | null;
    latestRevenueUsd: number | null;
    latestNetMarginPct: number | null;
    latestOperatingMarginPct: number | null;
    rndIntensityPct: number | null;
    years: number;
  };
  news: NewsItem[];
  irQuarters: IrQuarter[];
  irUrl: string | null;
  facts: FactLedger | null;
  filing: FilingText | null;
  ir: IrScrapeResult | null;
  peers: Company[];
  findings: AgentFinding[];
  documents: IngestedDocument[];
  sources: Provenance[];
  warnings: string[];
}

export interface IngestedDocument {
  id: string;
  name: string;
  bytes: number;
  pages: number | null;
  characters: number;
  extracted: Array<{ label: string; value: string; context: string }>;
  addedAt: string;
}

const METRIC_LABELS: Record<keyof typeof CONCEPTS, string> = {
  revenue: "Revenue",
  netIncome: "Net income",
  operatingIncome: "Operating income",
  grossProfit: "Gross profit",
  rnd: "Research and development",
  assets: "Total assets",
  cashFromOps: "Cash from operations",
  employees: "Employees",
};

function toSeries(
  metric: string,
  tag: string,
  points: FactPoint[],
): FinancialSeries {
  return {
    metric,
    tag,
    unit: "USD",
    periodType: "annual",
    points: points.map((p) => ({
      period: p.end,
      label: p.end.slice(0, 4),
      value: p.value,
      form: p.form,
      filed: p.filed,
    })),
  };
}

function findingId(seq: number): string {
  return `r${seq}`;
}

export async function resolveCompany(query: string): Promise<{
  name: string;
  cik: string | null;
  symbol: string | null;
  inUniverse: Company | null;
  candidates: Array<{ name: string; ticker: string; cik: string }>;
}> {
  const universeHit = findCompany(query);

  if (universeHit) {
    const sec = await resolveCik(universeHit.symbol).catch(() => null);
    return {
      name: universeHit.name,
      cik: sec?.cik ?? null,
      symbol: universeHit.symbol,
      inUniverse: universeHit,
      candidates: [],
    };
  }

  const matches = await searchCompanies(query, 6).catch(() => []);
  if (matches.length === 0) {
    return { name: query, cik: null, symbol: null, inUniverse: null, candidates: [] };
  }

  const best = matches[0];
  return {
    name: best.title,
    cik: best.cik,
    symbol: best.ticker,
    inUniverse: UNIVERSE.find((c) => c.symbol === best.ticker) ?? null,
    candidates: matches.slice(1).map((m) => ({
      name: m.title,
      ticker: m.ticker,
      cik: m.cik,
    })),
  };
}

export async function research(
  query: string,
  documents: IngestedDocument[] = [],
): Promise<CompanyDossier> {
  const warnings: string[] = [];
  const sources: Provenance[] = [];
  const findings: AgentFinding[] = [];
  let seq = 0;

  const resolved = await resolveCompany(query);

  if (!resolved.cik && !resolved.symbol) {
    warnings.push(
      `"${query}" did not match the coverage universe or the SEC register. It may be private, foreign-listed without a US registration, or spelled differently.`,
    );
  }

  let profile: Awaited<ReturnType<typeof getProfile>>["data"] | null = null;
  const financials: FinancialSeries[] = [];
  let facts: FactLedger | null = null;
  let filing: FilingText | null = null;
  let ir: IrScrapeResult | null = null;

  if (resolved.cik) {
    try {
      const p = await getProfile(resolved.cik);
      profile = p.data;
      sources.push(p.provenance);
    } catch (err) {
      warnings.push(
        `Filing history unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      facts = await getFactLedger(resolved.cik);
      sources.push(facts.provenance);
    } catch (err) {
      warnings.push(
        `Tagged financial concepts unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (facts) {
      const headline: Array<[FactKey, string]> = [
        ["revenue", "Revenue"],
        ["operatingIncome", "Operating income"],
        ["netIncome", "Net income"],
        ["rnd", "Research and development"],
        ["cashFromOps", "Cash from operations"],
        ["grossProfit", "Gross profit"],
        ["assets", "Total assets"],
      ];

      for (const [key, label] of headline) {
        const series = facts.series[key];
        if (!series || series.annual.length < 2) continue;
        financials.push({
          metric: label,
          tag: series.tag,
          unit: "USD",
          periodType: "annual",
          points: series.annual.slice(-10).map((p) => ({
            period: p.end,
            label: p.label,
            value: p.value,
            form: p.form,
            filed: p.filed,
          })),
        });
      }
    }

    try {
      filing = await getFilingText(resolved.cik);
      if (filing) sources.push(filing.provenance);
    } catch (err) {
      warnings.push(
        `Annual report narrative unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (financials.length > 0) {
      sources.push({
        kind: "filing",
        source: `SEC EDGAR XBRL company facts, ${profile?.name ?? resolved.name}`,
        url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${resolved.cik}.json`,
        retrievedAt: nowIso(),
      });
    } else {
      warnings.push(
        "No annual XBRL series were recovered. The filer may report under IFRS tags or file only on Form 20-F without tagged US-GAAP concepts.",
      );
    }
  }

  let irQuarters: IrQuarter[] = [];
  let irUrl: string | null = null;

  if (resolved.inUniverse && !resolved.inUniverse.secFiler) {
    try {
      ir = await scrapeIr(resolved.inUniverse.symbol, 3);
      if (ir && ir.metrics.length > 0) sources.push(ir.provenance);
      else if (ir) {
        warnings.push(
          `No metric rows could be read from ${ir.name} investor relations. ${ir.provenance.note ?? ""}`,
        );
      }
    } catch (err) {
      warnings.push(
        `Investor relations scrape failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (ir && ir.metrics.length > 0) {
      try {
        const fx = await getFxTable().catch(() => null);
        const bridged = buildLedgerFromIr(ir, fx, resolved.inUniverse.currency);
        if (bridged) {
          facts = bridged.ledger;
          sources.push(bridged.ledger.provenance);
          if (fx && bridged.sourceCurrency && bridged.sourceCurrency !== "USD") {
            sources.push(fx.provenance);
          }
          for (const [key, label] of [
            ["revenue", "Revenue"],
            ["operatingIncome", "Operating income"],
            ["netIncome", "Net income"],
            ["cashFromOps", "Cash from operations"],
          ] as Array<[FactKey, string]>) {
            const s = bridged.ledger.series[key];
            if (!s) continue;
            const points = s.annual.length >= 2 ? s.annual : s.quarterly;
            if (points.length < 2) continue;
            financials.push({
              metric: label,
              tag: s.tag,
              unit: "USD",
              periodType: s.annual.length >= 2 ? "annual" : "quarterly",
              points: points.slice(-10).map((p) => ({
                period: p.end,
                label: p.label,
                value: p.value,
                form: p.form,
                filed: p.filed,
              })),
            });
          }
        }
      } catch (err) {
        warnings.push(
          `Published metrics could not be mapped onto the concept set: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      const history = await getIrHistory(resolved.inUniverse.symbol, 8);
      if (history) {
        irQuarters = history.data.quarters;
        irUrl = history.data.irUrl;
        if (irQuarters.length > 0) sources.push(history.provenance);
        else
          warnings.push(
            `No quarterly fact sheet could be read from ${history.data.name} investor relations. ` +
              history.data.attempts
                .slice(0, 2)
                .map((a) => `${a.label}: ${a.reason}`)
                .join("; "),
          );
      }
    } catch (err) {
      warnings.push(
        `Investor relations documents unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let quote: Quote | null = null;
  if (resolved.symbol) {
    try {
      const q = await getQuote(resolved.symbol);
      quote = q.data;
      sources.push(q.provenance);
    } catch (err) {
      warnings.push(
        `Live quote unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let news: NewsItem[] = [];
  try {
    const n = await getCompanyNews(resolved.name);
    news = n.data;
    sources.push(n.provenance);
  } catch (err) {
    warnings.push(
      `Press coverage unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (financials.length === 0 && irQuarters.length >= 2) {
    const withRevenue = irQuarters.filter((q) => q.revenueUsdMn !== null);
    if (withRevenue.length >= 2) {
      financials.push({
        metric: "Revenue",
        tag: "Quarterly fact sheet, USD revenue as translated by the company",
        unit: "USD",
        periodType: "quarterly",
        points: withRevenue.map((q) => ({
          period: q.label,
          label: q.label,
          value: q.revenueUsdMn! * 1e6,
          form: "Fact sheet",
          filed: "",
        })),
      });

      const withOp = withRevenue.filter((q) => q.operatingMarginPct !== null);
      if (withOp.length >= 2) {
        financials.push({
          metric: "Operating income",
          tag: "Derived from reported revenue and reported operating margin",
          unit: "USD",
          periodType: "quarterly",
          points: withOp.map((q) => ({
            period: q.label,
            label: q.label,
            value: q.revenueUsdMn! * 1e6 * (q.operatingMarginPct! / 100),
            form: "Fact sheet",
            filed: "",
          })),
        });
      }

      const withNet = withRevenue.filter((q) => q.netMarginPct !== null);
      if (withNet.length >= 2) {
        financials.push({
          metric: "Net income",
          tag: "Derived from reported revenue and reported net margin",
          unit: "USD",
          periodType: "quarterly",
          points: withNet.map((q) => ({
            period: q.label,
            label: q.label,
            value: q.revenueUsdMn! * 1e6 * (q.netMarginPct! / 100),
            form: "Fact sheet",
            filed: "",
          })),
        });
      }
    }
  }

  const peers = resolved.inUniverse
    ? UNIVERSE.filter(
        (c) =>
          c.subsector === resolved.inUniverse!.subsector &&
          c.symbol !== resolved.inUniverse!.symbol,
      )
    : [];

  const revenue = financials.find((f) => f.metric === "Revenue");
  const netIncome = financials.find((f) => f.metric === "Net income");
  const operatingIncome = financials.find((f) => f.metric === "Operating income");
  const rnd = financials.find((f) => f.metric === "Research and development");

  const latestRevenuePoint = revenue?.points.at(-1) ?? null;
  const latestRevenue = latestRevenuePoint?.value ?? null;
  const firstRevenue = revenue?.points[0]?.value ?? null;

  const intervals = revenue ? revenue.points.length - 1 : 0;
  const yearsPerInterval = revenue?.periodType === "quarterly" ? 0.25 : 1;
  const years = Number((intervals * yearsPerInterval).toFixed(2));

  const revenueCagrPct =
    latestRevenue && firstRevenue && firstRevenue > 0 && years > 0
      ? (Math.pow(latestRevenue / firstRevenue, 1 / years) - 1) * 100
      : null;

  const atPeriod = (s: FinancialSeries | undefined, period: string) =>
    s?.points.find((p) => p.period === period)?.value ?? null;

  const period = latestRevenuePoint?.period ?? null;
  const latestNet = period ? atPeriod(netIncome, period) : null;
  const latestOp = period ? atPeriod(operatingIncome, period) : null;
  const latestRnd = period ? atPeriod(rnd, period) : null;

  const ratio = (numerator: number | null) =>
    numerator !== null && latestRevenue && latestRevenue > 0
      ? (numerator / latestRevenue) * 100
      : null;

  const latestNetMarginPct = ratio(latestNet);
  const latestOperatingMarginPct = ratio(latestOp);
  const rndIntensityPct = ratio(latestRnd);

  if (period && operatingIncome && latestOp === null) {
    warnings.push(
      `Operating income is not reported for the ${period.slice(0, 4)} period that revenue covers, so the operating margin is not shown rather than being computed across mismatched periods.`,
    );
  }

  const filingProv: Provenance[] = sources.filter((s) => s.kind === "filing");

  if (revenueCagrPct !== null && latestRevenue) {
    findings.push({
      id: findingId(++seq),
      severity: revenueCagrPct < 0 ? "risk" : revenueCagrPct < 5 ? "attention" : "info",
      headline: `Revenue compound growth of ${revenueCagrPct.toFixed(1)} percent a year`,
      detail:
        `Reported revenue moved from ${fmtUsd(firstRevenue!)} to ${fmtUsd(latestRevenue)} across ` +
        `${intervals + 1} ${revenue?.periodType === "quarterly" ? "quarters" : "annual periods"}, ` +
        `a span of ${years} year${years === 1 ? "" : "s"}, giving a compound annual rate of ${revenueCagrPct.toFixed(1)} percent. ` +
        (revenue?.periodType === "quarterly"
          ? `The series comes from the company's quarterly fact sheets, which is the reported record for a company that does not file with the SEC. Over a span this short the rate is sensitive to the quarters at each end.`
          : `Figures are as tagged in the company's own annual filings, taking the most recently filed value for each year so restatements are reflected.`),
      evidence: filingProv,
      metric: { label: "Revenue CAGR", value: `${revenueCagrPct.toFixed(1)}%` },
    });
  }

  if (latestOperatingMarginPct !== null) {
    const priorRevenuePoint =
      revenue && revenue.points.length >= 2 ? revenue.points.at(-2)! : null;
    const priorOp = priorRevenuePoint
      ? atPeriod(operatingIncome, priorRevenuePoint.period)
      : null;
    const priorMargin =
      priorOp !== null && priorRevenuePoint && priorRevenuePoint.value > 0
        ? (priorOp / priorRevenuePoint.value) * 100
        : null;
    const shift = priorMargin !== null ? latestOperatingMarginPct - priorMargin : null;

    findings.push({
      id: findingId(++seq),
      severity:
        shift !== null && shift < -2 ? "risk" : shift !== null && shift < 0 ? "attention" : "info",
      headline: `Operating margin at ${latestOperatingMarginPct.toFixed(1)} percent`,
      detail:
        `Operating income of ${fmtUsd(latestOp!)} on revenue of ${fmtUsd(latestRevenue!)}.` +
        (shift !== null
          ? ` That is ${shift >= 0 ? "up" : "down"} ${Math.abs(shift).toFixed(1)} points on the prior year, when the margin was ${priorMargin!.toFixed(1)} percent.`
          : " There is no prior comparable year in the tagged data."),
      evidence: filingProv,
      metric: {
        label: "Operating margin",
        value: `${latestOperatingMarginPct.toFixed(1)}%`,
      },
    });
  }

  if (rndIntensityPct !== null) {
    findings.push({
      id: findingId(++seq),
      severity: "info",
      headline: `Research and development at ${rndIntensityPct.toFixed(1)} percent of revenue`,
      detail:
        `${fmtUsd(latestRnd!)} of research spend against ${fmtUsd(latestRevenue!)} of revenue. ` +
        `In technology this is the clearest read on whether a business is buying its next product cycle or harvesting the current one. ` +
        `Software and semiconductor names typically run in the teens to low twenties; IT services run low single digits because delivery capacity, not product, is the cost base.`,
      evidence: filingProv,
      metric: { label: "R&D intensity", value: `${rndIntensityPct.toFixed(1)}%` },
    });
  }

  if (quote && quote.fiftyTwoWeekHigh !== null && quote.fiftyTwoWeekLow !== null) {
    const span = quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow;
    const position = span > 0 ? ((quote.price - quote.fiftyTwoWeekLow) / span) * 100 : null;
    if (position !== null) {
      findings.push({
        id: findingId(++seq),
        severity: position <= 15 ? "attention" : "info",
        headline: `Trading ${position.toFixed(0)} percent up its annual range`,
        detail:
          `Last price ${quote.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quote.currency} ` +
          `against a fifty two week range of ${quote.fiftyTwoWeekLow.toLocaleString("en-US", { maximumFractionDigits: 2 })} to ` +
          `${quote.fiftyTwoWeekHigh.toLocaleString("en-US", { maximumFractionDigits: 2 })}.` +
          (position <= 15
            ? " A name at the bottom of its range warrants checking whether the reset is company specific or sector wide."
            : ""),
        evidence: sources.filter((s) => s.source.includes("Yahoo")),
        metric: { label: "Range position", value: `${position.toFixed(0)}%` },
      });
    }
  }

  if (profile?.filings.length) {
    const recent = profile.filings.slice(0, 3);
    const eightKs = profile.filings.filter((f) => f.form.startsWith("8-K")).length;
    findings.push({
      id: findingId(++seq),
      severity: "info",
      headline: `${profile.filings.length} material filings on record, most recent ${recent[0].filingDate}`,
      detail:
        `Latest submissions: ` +
        recent.map((f) => `${f.form} on ${f.filingDate}`).join(", ") +
        `. ${eightKs} current reports on Form 8-K in the retained window, which is the channel for material events between periodic reports.`,
      evidence: filingProv,
      metric: { label: "Material filings", value: String(profile.filings.length) },
    });
  }

  if (documents.length > 0) {
    const totalChars = documents.reduce((s, d) => s + d.characters, 0);
    const extracted = documents.flatMap((d) => d.extracted);
    findings.push({
      id: findingId(++seq),
      severity: "info",
      headline: `${documents.length} private document${documents.length === 1 ? "" : "s"} ingested alongside the public record`,
      detail:
        documents.map((d) => `${d.name} (${d.pages ?? "unknown"} pages, ${d.characters.toLocaleString("en-US")} characters)`).join("; ") +
        `. ${extracted.length} tagged figures were recovered and are available to the assistant. ` +
        `Uploaded material is held in memory for this session only and is never written to disk or sent to a third party.`,
      evidence: [
        {
          kind: "filing",
          source: "Documents supplied by the analyst",
          retrievedAt: nowIso(),
          note: `${totalChars.toLocaleString("en-US")} characters indexed.`,
        },
      ],
      metric: { label: "Documents", value: String(documents.length) },
    });
  }

  if (irQuarters.length > 0) {
    const latest = irQuarters[irQuarters.length - 1];
    const oldest = irQuarters[0];

    findings.push({
      id: findingId(++seq),
      severity: "info",
      headline: `${irQuarters.length} quarters parsed from published fact sheets`,
      detail:
        `Covering ${oldest.label} to ${latest.label}, read directly from the company's own quarterly documents rather than an aggregator. ` +
        (latest.revenueUsdMn !== null
          ? `Latest quarter revenue ${latest.revenueUsdMn.toLocaleString("en-US")} million US dollars. `
          : "") +
        (latest.operatingMarginPct !== null
          ? `Operating margin ${latest.operatingMarginPct.toFixed(1)} percent. `
          : "") +
        `This company does not file with the SEC, so these documents are the reported record.`,
      evidence: sources.filter((s) => s.source.includes("investor relations")),
      metric: { label: "Quarters on file", value: String(irQuarters.length) },
    });

    if (latest.attritionLtmPct !== null && latest.headcount !== null) {
      const headcounts = irQuarters.filter((q) => q.headcount !== null);
      const peak = Math.max(...headcounts.map((q) => q.headcount!));
      const trough = Math.min(...headcounts.map((q) => q.headcount!));
      findings.push({
        id: findingId(++seq),
        severity: latest.attritionLtmPct > 15 ? "attention" : "info",
        headline: `Attrition ${latest.attritionLtmPct.toFixed(1)} percent against headcount of ${latest.headcount.toLocaleString("en-US")}`,
        detail:
          `Across the ${headcounts.length} quarters on file, headcount ranged from ${trough.toLocaleString("en-US")} to ${peak.toLocaleString("en-US")}, ` +
          `a spread of ${(((peak - trough) / peak) * 100).toFixed(1)} percent of the peak. ` +
          `Attrition is read against the headcount direction, not on its own: a falling base flatters the ratio.`,
        evidence: sources.filter((s) => s.source.includes("investor relations")),
        metric: { label: "Attrition LTM", value: `${latest.attritionLtmPct.toFixed(1)}%` },
      });
    }

    const ccSeries = irQuarters.filter((q) => q.ccGrowthYoyPct !== null && q.inrGrowthYoyPct !== null);
    if (ccSeries.length > 0) {
      const last = ccSeries[ccSeries.length - 1];
      const gap = last.inrGrowthYoyPct! - last.ccGrowthYoyPct!;
      findings.push({
        id: findingId(++seq),
        severity: Math.abs(gap) > 6 ? "risk" : "attention",
        headline: `${gap.toFixed(1)} points of reported growth is currency, not volume`,
        detail:
          `${last.label} reported growth of ${last.inrGrowthYoyPct!.toFixed(1)} percent in rupees against ${last.ccGrowthYoyPct!.toFixed(1)} percent in constant currency. ` +
          `Any comparison against a dollar-reporting peer must use the constant currency series, because the rupee figure carries a translation effect the peer does not have.`,
        evidence: sources.filter((s) => s.source.includes("investor relations")),
        metric: { label: "Currency contribution", value: `${gap.toFixed(1)} pts` },
      });
    }
  }

  const tier1 = news.filter((n) => n.publisherTier === 1).length;
  if (news.length > 0) {
    findings.push({
      id: findingId(++seq),
      severity: "info",
      headline: `${news.length} verified items of coverage in the last ten days`,
      detail:
        `${tier1} from primary and wire sources. Leading item: "${news[0].title}" (${news[0].publisher}). ` +
        `Coverage from outlets outside the verified publisher list was discarded at ingestion.`,
      evidence: sources.filter((s) => s.source.includes("publisher")),
      metric: { label: "Verified items", value: String(news.length) },
    });
  }

  const severityRank = { risk: 0, attention: 1, info: 2 } as const;
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    query,
    resolved: {
      name: profile?.name ?? resolved.name,
      cik: resolved.cik,
      tickers: profile?.tickers ?? (resolved.symbol ? [resolved.symbol] : []),
      exchanges: profile?.exchanges ?? [],
      sicDescription: profile?.sicDescription ?? null,
      inUniverse: resolved.inUniverse,
    },
    quote,
    filings: profile?.filings ?? [],
    financials,
    derived: {
      revenueCagrPct,
      latestRevenueUsd: latestRevenue,
      latestNetMarginPct,
      latestOperatingMarginPct,
      rndIntensityPct,
      years,
    },
    news,
    irQuarters,
    irUrl,
    facts,
    filing,
    ir,
    peers,
    findings,
    documents,
    sources,
    warnings,
  };
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} billion US dollars`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} million US dollars`;
  return `${v.toLocaleString("en-US")} US dollars`;
}
