import { getFactLedger, type FactKey, type FactLedger } from "@/lib/research/facts";
import { scrapeIr } from "@/lib/research/ir-scrape";
import { buildLedgerFromIr } from "@/lib/research/ir-facts";
import { getFxTable } from "@/lib/feeds/fx";
import { snapshotLedger } from "@/lib/research/ir-snapshot-ledger";
import { resolveCik } from "@/lib/feeds/sec";
import type { Company } from "@/lib/data/universe";
import type { MetricKey } from "@/lib/brain/intent";
import type { Provenance } from "@/lib/core/types";

export interface CompanyLedger {
  ledger: FactLedger | null;
  provenance: Provenance | null;
  unavailable: string | null;
}

export async function ledgerFor(company: Company): Promise<CompanyLedger> {
  if (company.secFiler) {
    const sec = await resolveCik(company.symbol).catch(() => null);
    if (!sec) {
      return {
        ledger: null,
        provenance: null,
        unavailable: `${company.short} is not in the SEC register.`,
      };
    }
    const ledger = await getFactLedger(sec.cik);
    return { ledger, provenance: ledger.provenance, unavailable: null };
  }

  const scraped = await scrapeIr(company.symbol, 3).catch(() => null);

  if (scraped && scraped.metrics.length > 0) {
    const fx = await getFxTable().catch(() => null);
    const bridged = buildLedgerFromIr(scraped, fx, company.currency);
    if (bridged) {
      return {
        ledger: bridged.ledger,
        provenance: bridged.ledger.provenance,
        unavailable: null,
      };
    }
  }

  const harvested = snapshotLedger(company.symbol);
  if (harvested) {
    return { ledger: harvested, provenance: harvested.provenance, unavailable: null };
  }

  return {
    ledger: null,
    provenance: scraped?.provenance ?? null,
    unavailable: scraped
      ? `${company.short} publishes results files, but none of the rows could be mapped onto a standard measure.`
      : `No published results file could be read for ${company.short}.`,
  };
}

interface Basis {
  points: Array<{ label: string; end: string }>;
  read: (key: FactKey, end: string) => number | null;
  periodsPerYear: number;
}

function basisOf(ledger: FactLedger): Basis | null {
  const revenue = ledger.series.revenue;
  if (!revenue) return null;

  const useAnnual = revenue.annual.length >= 2;
  const points = (useAnnual ? revenue.annual : revenue.quarterly).map((p) => ({
    label: p.label,
    end: p.end,
  }));
  if (points.length === 0) return null;

  const read = (key: FactKey, end: string): number | null => {
    const line = ledger.series[key];
    if (!line) return null;
    const from = useAnnual ? line.annual : line.quarterly;
    const hit = from.find((p) => p.end === end);
    if (hit) return hit.value;
    const instants = [...line.annual, ...line.quarterly]
      .filter((p) => p.start === null && p.end <= end)
      .sort((a, b) => a.end.localeCompare(b.end));
    const nearest = instants.at(-1);
    if (!nearest) return null;
    const gap = (Date.parse(end) - Date.parse(nearest.end)) / 86_400_000;
    return gap <= 120 ? nearest.value : null;
  };

  return { points, read, periodsPerYear: useAnnual ? 1 : 4 };
}

export function ledgerPeriodsPerYear(ledger: FactLedger): number {
  return basisOf(ledger)?.periodsPerYear ?? 1;
}

export function annualise(
  key: MetricKey,
  value: number,
  periodsPerYear: number,
): number {
  if (periodsPerYear === 1) return value;
  if (key === "revenue") return value * periodsPerYear;
  if (key === "revenueGrowth") return (Math.pow(1 + value / 100, periodsPerYear) - 1) * 100;
  return value;
}

export function seriesFor(
  ledger: FactLedger,
  key: MetricKey,
): Array<{ label: string; value: number }> {
  const basis = basisOf(ledger);
  if (!basis) return [];

  const out: Array<{ label: string; value: number }> = [];

  for (let i = 0; i < basis.points.length; i++) {
    const { label, end } = basis.points[i];
    const revenue = basis.read("revenue", end);
    if (revenue === null) continue;

    const priorPoint = i > 0 ? basis.points[i - 1] : null;
    const expected = 365 / basis.periodsPerYear;
    const gapDays = priorPoint
      ? (Date.parse(end) - Date.parse(priorPoint.end)) / 86_400_000
      : null;
    const adjacent = gapDays !== null && gapDays > expected * 0.6 && gapDays < expected * 1.7;
    const priorRevenue = adjacent ? basis.read("revenue", priorPoint!.end) : null;

    const usable = (d: number | null) =>
      d !== null && Number.isFinite(d) && d !== 0 && Math.abs(d) >= Math.abs(revenue) * 0.02;

    const over = (n: number | null, d: number | null, scale: number) =>
      n !== null && usable(d) ? (n / d!) * scale : null;

    let v: number | null = null;

    switch (key) {
      case "revenue":
        v = revenue;
        break;
      case "revenueGrowth":
        v =
          priorRevenue !== null && priorRevenue > 0
            ? ((revenue - priorRevenue) / priorRevenue) * 100
            : null;
        break;
      case "grossMargin": {
        const cost = basis.read("costOfRevenue", end);
        const gross = basis.read("grossProfit", end) ?? (cost !== null ? revenue - cost : null);
        v = over(gross, revenue, 100);
        break;
      }
      case "operatingMargin":
        v = over(basis.read("operatingIncome", end), revenue, 100);
        break;
      case "netMargin":
        v = over(basis.read("netIncome", end), revenue, 100);
        break;
      case "rndIntensity":
        v = over(basis.read("rnd", end), revenue, 100);
        break;
      case "shareBasedComp":
        v = over(basis.read("shareComp", end), revenue, 100);
        break;
      case "cashConversion":
        v = over(basis.read("cashFromOps", end), basis.read("netIncome", end), 100);
        break;
      case "freeCashMargin": {
        const ocf = basis.read("cashFromOps", end);
        const capex = basis.read("capex", end);
        v = ocf === null ? null : over(ocf - Math.abs(capex ?? 0), revenue, 100);
        break;
      }
      case "receivableDays":
        v = over(basis.read("receivables", end), revenue * basis.periodsPerYear, 365);
        break;
      case "returnOnEquity": {
        const ni = basis.read("netIncome", end);
        v = over(ni === null ? null : ni * basis.periodsPerYear, basis.read("equity", end), 100);
        break;
      }
      case "headcount": {
        const n = basis.read("employees", end);
        v = n !== null && n >= 1 ? n : null;
        break;
      }
      case "attrition":
        v = null;
        break;
    }

    if (v !== null && Number.isFinite(v)) out.push({ label, value: v });
  }

  return out;
}
