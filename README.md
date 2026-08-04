# EY TMT Intelligence

Technology, media and telecom intelligence with a due diligence operating
system. Three dashboards, on-demand company research, 47 agent seats across ten
workstreams, and an assistant that answers from the console's own data.

Live: https://eyintelligence.jewellabs.org

No database. No accounts. No API keys. Every figure is fetched live from a
public source and labelled with where it came from.

## Run

```bash
npm install
```

```bash
npm run dev
```

http://localhost:4870

## What is in it

**01 Sector signal.** Fifty six listed names across technology, media and
telecom plus five reference indices. Nine standing coverage queries filtered to
a verified publisher set. Rebased relative performance, theme exposure across
the AI compute, agentic AI and physical AI cohorts, and the coverage universe
with annual range positions.

**02 Quarterly P&L.** The income statement quarter by quarter for any company in
the universe, built from that company's own XBRL tagging. Income statement
bridge and margin series.

**03 KPI detail.** Nine quality measures with a plain reading of each, multi-year
trends, and a benchmark against the company's own subsector cohort.

**04 Company research.** Name any company. Resolves against the SEC register,
pulls filing history and tagged financials, checks market position, reads
verified coverage, and computes findings. Private documents can be added.

**05 Diligence operating system.** 47 seats across ten workstreams, screening
through to committee paper plus portfolio monitoring. Each seat holds a role,
declares the evidence it needs, and hands to the next. A seat with evidence
returns a finding; a seat without it returns the document request that would
close the gap.

## Sources

| Source | Use | Key |
|---|---|---|
| SEC EDGAR | Filing history, XBRL company facts, company register | No |
| Company IR documents | Quarterly fact sheets, parsed in process | No |
| Yahoo Finance | Quotes and price history | No |
| Frankfurter, open.er-api | Foreign exchange, raced | No |
| Verified publisher set | Sector coverage, discovered via Google News | No |

Every figure carries a provenance marker: live, cached, from filing, baseline,
or unavailable. Nothing is estimated, modelled or interpolated. A figure that
was not in a source is not displayed; the field reads "Not set".

### Accuracy

- XBRL concepts are merged across every candidate tag. Filers migrate between
  tags mid-history, and reading one tag truncates the series. NVIDIA's revenue
  stops in 2022 under a single tag and produced a 484 percent operating margin
  before this was fixed.
- Ratios are computed only where numerator and denominator cover the same
  reporting period. Mismatched periods return "Not set".
- A ratio whose denominator falls below two percent of revenue is suppressed. It
  is arithmetically correct and analytically meaningless.
- Quarter labels are derived from period dates, not from the `fy` and `fp`
  fields, which describe the filing rather than the period.
- The fourth quarter is derived as full year less three reported quarters and
  flagged as derived.
- Growth is annualised from the real period span. A quarterly series is not
  reported as though its points were years.
- Where a year has been restated, the most recently filed value is used.
- Both `us-gaap` and `ifrs-full` taxonomies are read, so foreign private issuers
  filing on Form 20-F resolve.

### Companies outside the SEC register

TCS and the Indian cohort publish quarterly fact sheets on their own sites.
`lib/feeds/ir.ts` harvests and parses them, which is what gives that cohort a
reported record at all.

Those publishers refuse datacentre IP ranges, so a deployed instance is blocked
where a workstation is not. Regenerate the snapshot before deploying:

```bash
node --experimental-strip-types scripts/harvest-ir.mts
```

The application attempts a live fetch on every request and falls back to the
snapshot only when that fails, labelling the result with the date it was taken.

## Security

- Automated clients refused: crawlers, extraction services, headless stacks and
  AI ingestion agents, plus requests missing the header set a browser always
  sends.
- Per-client rate limiting across six budgets.
- JSON endpoints reject cross-origin callers.
- Content security policy permits no external origin. All assets are
  same-origin.
- No SQL anywhere. React escapes rendered output.
- Third-party text is stripped of markup, control characters and bidi
  overrides. Instruction-shaped spans are defanged before reaching a prompt.
- Outbound requests restricted to a host allowlist with private ranges blocked.
- CSV exports are formula-guarded.
- Uploaded documents are parsed in the request that carries them and returned to
  the browser. The server retains nothing and writes nothing to disk.

## Optional model provider

The assistant works with no key, answering extractively from retrieved passages
with citations. See `.env.example` to connect a free provider, which changes
phrasing only. Retrieval, citation and injection defences are identical either
way.

## Deploy

```bash
npx vercel@latest deploy --prod --yes
```

## Layout

```
app/                    routes, dashboards, API handlers
components/charts/      SVG chart kit, no chart library
components/dashboards/  dashboard compositions
components/ui/          shell, navigation, panels, source list, company picker
lib/agents/             seat registry and workstream runtime
lib/client/             browser-held documents, fetch wrapper
lib/core/               types, cache, outbound fetch
lib/data/               coverage universe, IR snapshot
lib/feeds/              SEC, markets, FX, news, IR documents
lib/financials/         statement model built from XBRL company facts
lib/pdf/                encrypted PDF decryption and extraction
lib/rag/                BM25 index, corpus, answering
lib/research/           company dossier, document ingestion
lib/security/           request gate, sanitisation
lib/sources/            publisher allowlist
scripts/                IR snapshot generator
```

Developed by [Jewel Labs](https://jewellabs.io).
