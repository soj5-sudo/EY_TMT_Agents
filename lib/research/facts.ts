/**
 * Deep fact ledger.
 *
 * A single company-facts document carries every concept a filer has ever
 * tagged, which for a large registrant is four to six hundred of them. The
 * console previously read eight. Eight concepts support a profit and loss
 * summary and nothing else, which is why most diligence agents had no material
 * to work from and could only restate their own remit.
 *
 * This reads the same one document and lifts the concepts a diligence review
 * actually asks for: the working capital components, the order book, the tax
 * position, the lease and debt commitments, the share count and the buyback,
 * the litigation accrual. Each is resolved across candidate tags in both
 * taxonomies, because filers migrate tags between years and foreign private
 * issuers report the same substance under IFRS names.
 *
 * Nothing here infers a figure. A concept the filer never tagged is absent,
 * and absent means the agent that wanted it raises a request instead.
 */

import { fetchJson } from "@/lib/core/fetcher";
import { cached } from "@/lib/core/cache";
import { nowIso, type Provenance } from "@/lib/core/types";

const TTL_MS = 12 * 60 * 60 * 1000;

const HEADERS = {
  "User-Agent": "EY TMT Intelligence Console soj5@cornell.edu",
  Accept: "application/json",
};

export interface FactValue {
  start: string | null;
  end: string;
  value: number;
  form: string;
  filed: string;
  /** Fiscal label derived from the period end, never from the filing's own
   *  fiscal year field, which describes the filing rather than the period. */
  label: string;
}

export interface FactSeries {
  key: string;
  label: string;
  /** The XBRL tag or tags the value was actually read from. */
  tag: string;
  unit: string;
  annual: FactValue[];
  quarterly: FactValue[];
  /** Most recent annual value. */
  latest: number | null;
  /** Prior annual value, for a year on year read. */
  prior: number | null;
  /** Most recent instantaneous value, for balance sheet concepts. */
  instant: number | null;
}

export type FactKey = keyof typeof DD_CONCEPTS;

export interface FactLedger {
  cik: string;
  entityName: string;
  /** Concepts the filer has tagged at least once, across all taxonomies. */
  conceptsTagged: number;
  /** Of the concepts this review asks for, how many the filer reports. */
  conceptsResolved: number;
  conceptsRequested: number;
  taxonomies: string[];
  series: Partial<Record<FactKey, FactSeries>>;
  fiscalYearEnd: string | null;
  provenance: Provenance;
}

/**
 * The concepts a diligence review asks for, with the tags each is reported
 * under. Order is preference order: the first tag that carries values wins,
 * and later tags top up periods the earlier ones do not cover.
 */
const DD_CONCEPTS = {
  /* --- Profit and loss ------------------------------------------------ */
  revenue: {
    label: "Revenue",
    unit: "USD",
    tags: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "RevenueFromSaleOfGoods",
      "Revenue",
      "RevenueFromContractsWithCustomers",
    ],
  },
  costOfRevenue: {
    label: "Cost of revenue",
    unit: "USD",
    tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfSales", "CostOfServices"],
  },
  grossProfit: { label: "Gross profit", unit: "USD", tags: ["GrossProfit"] },
  sga: {
    label: "Selling, general and administrative",
    unit: "USD",
    tags: [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
      "SellingAndMarketingExpense",
      "AdministrativeExpense",
    ],
  },
  rnd: {
    label: "Research and development",
    unit: "USD",
    tags: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  },
  operatingIncome: {
    label: "Operating income",
    unit: "USD",
    tags: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  },
  netIncome: { label: "Net income", unit: "USD", tags: ["NetIncomeLoss", "ProfitLoss"] },
  interestExpense: {
    label: "Interest expense",
    unit: "USD",
    tags: ["InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet", "FinanceCosts"],
  },
  restructuring: {
    label: "Restructuring charges",
    unit: "USD",
    tags: ["RestructuringCharges", "RestructuringSettlementAndImpairmentProvisions", "RestructuringCosts"],
  },
  impairment: {
    label: "Goodwill impairment",
    unit: "USD",
    tags: ["GoodwillImpairmentLoss", "ImpairmentOfIntangibleAssetsIncludingGoodwill",
      "AssetImpairmentCharges",
      "ImpairmentLossRecognisedInProfitOrLossGoodwill",],
  },

  /* --- Balance sheet -------------------------------------------------- */
  assets: { label: "Total assets", unit: "USD", tags: ["Assets"] },
  currentAssets: { label: "Current assets", unit: "USD", tags: ["AssetsCurrent", "CurrentAssets"] },
  currentLiabilities: { label: "Current liabilities", unit: "USD", tags: ["LiabilitiesCurrent", "CurrentLiabilities"] },
  cash: {
    label: "Cash and equivalents",
    unit: "USD",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "CashAndCashEquivalents",
    ],
  },
  receivables: {
    label: "Trade receivables",
    unit: "USD",
    tags: [
      "AccountsReceivableNetCurrent",
      "ReceivablesNetCurrent",
      "AccountsReceivableGrossCurrent",
      "TradeAndOtherCurrentReceivables",
      "CurrentTradeReceivables",
      "TradeReceivables",
    ],
  },
  unbilled: {
    label: "Unbilled receivables",
    unit: "USD",
    tags: [
      "ContractWithCustomerAssetNetCurrent",
      "UnbilledContractsReceivable",
      "ContractWithCustomerAssetNet",
      "ContractAssets",
      "CurrentAccruedIncomeIncludingCurrentContractAssets",
    ],
  },
  payables: {
    label: "Trade payables",
    unit: "USD",
    tags: ["AccountsPayableCurrent",
      "AccountsPayableTradeCurrent",
      "TradeAndOtherCurrentPayables",
      "TradeAndOtherPayables",],
  },
  inventory: { label: "Inventory", unit: "USD", tags: ["InventoryNet", "Inventories"] },
  deferredRevenue: {
    label: "Deferred revenue",
    unit: "USD",
    tags: [
      "ContractWithCustomerLiabilityCurrent",
      "DeferredRevenueCurrent",
      "ContractWithCustomerLiability",
      "DeferredRevenue",
      "CurrentContractLiabilities",
      "ContractLiabilities",
      "DeferredIncomeClassifiedAsCurrent",
    ],
  },
  goodwill: { label: "Goodwill", unit: "USD", tags: ["Goodwill"] },
  intangibles: {
    label: "Intangible assets",
    unit: "USD",
    tags: [
      "FiniteLivedIntangibleAssetsNet",
      "IntangibleAssetsNetExcludingGoodwill",
      "IntangibleAssetsNetIncludingGoodwill",
      "IntangibleAssetsOtherThanGoodwill",
    ],
  },
  ppe: {
    label: "Property and equipment",
    unit: "USD",
    tags: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipment"],
  },
  debt: {
    label: "Long term debt",
    unit: "USD",
    tags: [
      "LongTermDebtNoncurrent",
      "LongTermDebt",
      "DebtLongtermAndShorttermCombinedAmount",
      "LongTermBorrowings",
      "NoncurrentBorrowings",
      "Borrowings",
    ],
  },
  debtCurrent: {
    label: "Short term debt",
    unit: "USD",
    tags: ["LongTermDebtCurrent", "DebtCurrent", "ShorttermBorrowings", "CurrentBorrowings"],
  },
  leaseLiability: {
    label: "Lease liabilities",
    unit: "USD",
    tags: [
      "OperatingLeaseLiabilityNoncurrent",
      "OperatingLeaseLiability",
      "LeaseLiabilityNoncurrent",
      "LeaseLiability",
      "NoncurrentLeaseLiabilities",
      "LeaseLiabilities",
      "CurrentLeaseLiabilities",
    ],
  },
  equity: {
    label: "Shareholders equity",
    unit: "USD",
    tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"],
  },
  minorityInterest: {
    label: "Non-controlling interests",
    unit: "USD",
    tags: ["MinorityInterest", "NoncontrollingInterests"],
  },

  /* --- Cash flow ------------------------------------------------------ */
  cashFromOps: {
    label: "Cash from operations",
    unit: "USD",
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      "CashFlowsFromUsedInOperatingActivities",
    ],
  },
  capex: {
    label: "Capital expenditure",
    unit: "USD",
    tags: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PurchaseOfPropertyPlantAndEquipment",
      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    ],
  },
  depreciation: {
    label: "Depreciation and amortisation",
    unit: "USD",
    tags: [
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "DepreciationAndAmortisationExpense",
      "DepreciationAndAmortisationExpenseContinuingOperations",
    ],
  },
  acquisitions: {
    label: "Cash paid for acquisitions",
    unit: "USD",
    tags: [
      "PaymentsToAcquireBusinessesNetOfCashAcquired",
      "PaymentsToAcquireBusinessesGross",
      "BusinessCombinationConsiderationTransferred1",
      "CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities",
    ],
  },
  buyback: {
    label: "Share repurchases",
    unit: "USD",
    tags: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity",
      "PurchaseOfOwnShares",
      "PaymentsToAcquireOrRedeemEntitysShares",],
  },
  dividends: {
    label: "Dividends paid",
    unit: "USD",
    tags: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid"],
  },

  /* --- People and compensation ---------------------------------------- */
  employees: {
    label: "Employees",
    unit: "pure",
    tags: ["EntityNumberOfEmployees", "NumberOfEmployees"],
  },
  shareComp: {
    label: "Share-based compensation",
    unit: "USD",
    tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense",
      "ShareBasedPayments",
      "AdjustmentsForSharebasedPayments",
      "ExpenseFromSharebasedPaymentTransactionsWithEmployees",],
  },

  /* --- Tax -------------------------------------------------------------*/
  taxExpense: {
    label: "Income tax expense",
    unit: "USD",
    tags: ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
  },
  pretaxIncome: {
    label: "Pre-tax income",
    unit: "USD",
    tags: [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      "ProfitLossBeforeTax",
    ],
  },
  effectiveTaxRate: {
    label: "Effective tax rate",
    unit: "pure",
    tags: [
      "EffectiveIncomeTaxRateContinuingOperations",
      "EffectiveIncomeTaxRateReconciliationAtFederalStatutoryIncomeTaxRate",
      "AverageEffectiveTaxRate",
      "ApplicableTaxRate",
    ],
  },
  unrecognisedTax: {
    label: "Unrecognised tax benefits",
    unit: "USD",
    tags: [
      "UnrecognizedTaxBenefits",
      "UnrecognizedTaxBenefitsThatWouldImpactEffectiveTaxRate",
    ],
  },

  /* --- Contracts, litigation and commitments --------------------------- */
  orderBook: {
    label: "Remaining performance obligation",
    unit: "USD",
    tags: ["RevenueRemainingPerformanceObligation", "RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionAmount",
      "TransactionPriceAllocatedToRemainingPerformanceObligations",],
  },
  lossContingency: {
    label: "Loss contingency accrual",
    unit: "USD",
    tags: [
      "LossContingencyAccrualAtCarryingValue",
      "AccrualForEnvironmentalLossContingencies",
      "LossContingencyEstimateOfPossibleLoss",
      "LitigationSettlementAmountAwardedToOtherParty",
      "LitigationSettlementExpense",
    ],
  },
  purchaseCommitments: {
    label: "Purchase obligations",
    unit: "USD",
    tags: ["PurchaseObligation", "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount",
      "OtherCommitment",
      "ContractualCommitmentsForAcquisitionOfPropertyPlantAndEquipment",],
  },

  /* --- Per share -------------------------------------------------------*/
  epsDiluted: {
    label: "Diluted earnings per share",
    unit: "USD/shares",
    tags: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "DilutedEarningsLossPerShare"],
  },
  dilutedShares: {
    label: "Diluted shares outstanding",
    unit: "shares",
    tags: [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
    ],
  },
} as const;

export const FACT_KEYS = Object.keys(DD_CONCEPTS) as FactKey[];

/* ------------------------------------------------------------------ *
 * Period classification
 * ------------------------------------------------------------------ */

const ANNUAL_FORM = /^(10-K|20-F|40-F)/;
const PERIODIC_FORM = /^(10-K|10-Q|20-F|40-F|6-K)/;

function days(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function fiscalLabel(end: string): string {
  return `FY${new Date(`${end}T00:00:00Z`).getUTCFullYear()}`;
}

interface RawFact {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  filed?: string;
  fy?: number;
  fp?: string;
}

/** All units a concept was reported in, flattened with the unit recorded. */
function unitsOf(entry: { units?: Record<string, RawFact[]> }): Array<[string, RawFact[]]> {
  return Object.entries(entry.units ?? {});
}

function buildSeries(
  key: FactKey,
  def: (typeof DD_CONCEPTS)[FactKey],
  facts: Record<string, Record<string, { units?: Record<string, RawFact[]> }>>,
): FactSeries | null {
  // Period identity is start-and-end, so an annual and a quarterly fact that
  // share an end date do not collide. The latest filed value wins, which is
  // also how a restatement supersedes the figure it corrects.
  const merged = new Map<string, FactValue>();
  const tagsUsed: string[] = [];
  let unit: string = def.unit;

  for (const taxonomy of Object.keys(facts)) {
    for (const tag of def.tags) {
      const entry = facts[taxonomy]?.[tag];
      if (!entry) continue;

      const units = unitsOf(entry);
      // Prefer the declared unit; otherwise take whichever the filer used.
      const chosen =
        units.find(([u]) => u === def.unit) ??
        units.find(([u]) => u.startsWith("USD")) ??
        units[0];
      if (!chosen) continue;

      const [unitName, rows] = chosen;
      if (!rows?.length) continue;
      unit = unitName;
      if (!tagsUsed.includes(tag)) tagsUsed.push(tag);

      for (const f of rows) {
        if (typeof f.val !== "number" || typeof f.end !== "string") continue;
        if (!f.form || !PERIODIC_FORM.test(f.form)) continue;

        const k = `${f.start ?? "instant"}|${f.end}`;
        const held = merged.get(k);
        const filed = f.filed ?? "";
        if (held && Date.parse(held.filed) >= Date.parse(filed)) continue;

        merged.set(k, {
          start: f.start ?? null,
          end: f.end,
          value: f.val,
          form: f.form,
          filed,
          label: fiscalLabel(f.end),
        });
      }
    }
  }

  if (merged.size === 0) return null;

  const all = [...merged.values()].sort((a, b) => a.end.localeCompare(b.end));

  // A duration fact spanning about a year on an annual form is the annual
  // series. An instant fact (no start) belongs to the balance sheet and is
  // treated as annual when it lands on an annual form.
  const annual = all.filter((p) => {
    if (p.start === null) return ANNUAL_FORM.test(p.form);
    const d = days(p.start, p.end);
    return d > 300 && d < 400 && ANNUAL_FORM.test(p.form);
  });

  const quarterly = all.filter((p) => {
    if (p.start === null) return false;
    const d = days(p.start, p.end);
    return d > 60 && d < 120;
  });

  // Keep the latest value per fiscal label so restatements collapse.
  const dedupe = (xs: FactValue[]) => {
    const m = new Map<string, FactValue>();
    for (const x of xs) {
      const held = m.get(x.label + (x.start ?? ""));
      if (!held || Date.parse(x.filed) > Date.parse(held.filed)) m.set(x.label + (x.start ?? ""), x);
    }
    return [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
  };

  const a = dedupe(annual);
  const q = dedupe(quarterly);
  const instants = all.filter((p) => p.start === null);

  return {
    key,
    label: def.label,
    tag: tagsUsed.join(" + "),
    unit,
    annual: a.slice(-10),
    quarterly: q.slice(-16),
    latest: a.at(-1)?.value ?? null,
    prior: a.length >= 2 ? a[a.length - 2].value : null,
    instant: instants.at(-1)?.value ?? a.at(-1)?.value ?? null,
  };
}

/**
 * Reads the whole company-facts document once and lifts every diligence
 * concept from it. One network call, because the endpoint returns the filer's
 * entire tagged history in a single response.
 */
export async function getFactLedger(cik: string): Promise<FactLedger> {
  const padded = cik.padStart(10, "0");

  const res = await cached(`facts:ledger:${padded}`, TTL_MS, async () => {
    const doc = await fetchJson<{
      cik: number;
      entityName: string;
      facts: Record<string, Record<string, { units?: Record<string, RawFact[]> }>>;
    }>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
      headers: HEADERS,
      timeoutMs: 45_000,
      retries: 1,
    });

    const facts = doc.facts ?? {};
    const taxonomies = Object.keys(facts);
    const conceptsTagged = taxonomies.reduce(
      (s, t) => s + Object.keys(facts[t] ?? {}).length,
      0,
    );

    const series: Partial<Record<FactKey, FactSeries>> = {};
    for (const key of FACT_KEYS) {
      const built = buildSeries(key, DD_CONCEPTS[key], facts);
      if (built) series[key] = built;
    }

    // The fiscal year end is the month and day of the latest annual period.
    const rev = series.revenue ?? series.assets ?? series.netIncome;
    const fiscalYearEnd = rev?.annual.at(-1)?.end.slice(5) ?? null;

    return {
      entityName: doc.entityName ?? "",
      conceptsTagged,
      taxonomies,
      series,
      fiscalYearEnd,
    };
  });

  const v = res.value;
  const resolved = Object.keys(v.series).length;

  return {
    cik: padded,
    entityName: v.entityName,
    conceptsTagged: v.conceptsTagged,
    conceptsResolved: resolved,
    conceptsRequested: FACT_KEYS.length,
    taxonomies: v.taxonomies,
    series: v.series,
    fiscalYearEnd: v.fiscalYearEnd,
    provenance: {
      kind: res.fresh ? "filing" : "cached",
      source: `SEC EDGAR XBRL company facts, ${v.entityName || padded}`,
      url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
      retrievedAt: new Date(res.storedAt).toISOString(),
      note: `${v.conceptsTagged} concepts tagged by the filer; ${resolved} of ${FACT_KEYS.length} diligence concepts resolved.`,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Read helpers used by the agents
 * ------------------------------------------------------------------ */

export function val(l: FactLedger, k: FactKey): number | null {
  return l.series[k]?.latest ?? null;
}

export function priorVal(l: FactLedger, k: FactKey): number | null {
  return l.series[k]?.prior ?? null;
}

export function instant(l: FactLedger, k: FactKey): number | null {
  return l.series[k]?.instant ?? null;
}

export function has(l: FactLedger, ...keys: FactKey[]): boolean {
  return keys.every((k) => l.series[k] !== undefined);
}

/** Ratio guarded against a denominator too small to carry meaning. */
export function ratio(
  numerator: number | null,
  denominator: number | null,
  floor = 0,
): number | null {
  if (numerator === null || denominator === null) return null;
  if (Math.abs(denominator) <= floor) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function annualOf(l: FactLedger, k: FactKey): FactValue[] {
  return l.series[k]?.annual ?? [];
}

/** Most recent filing date across every concept read. */
export function ledgerLastFiled(l: FactLedger): string | null {
  let latest: string | null = null;
  for (const s of Object.values(l.series)) {
    for (const p of s.annual) if (p.filed && (!latest || p.filed > latest)) latest = p.filed;
  }
  return latest;
}
