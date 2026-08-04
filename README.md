# EY TMT Intelligence

Technology, media and telecom intelligence console. Three dashboards, on-demand
company research, seven diligence agents, and an assistant that answers from the
console's own data.

Runs locally. No accounts, no API keys, no paid services.

## Run

```bash
npm install
```

```bash
npm run dev
```

http://localhost:4870

Port is pinned to 4870 to avoid collisions with other local projects.

## Dashboards

**01 Sector signal.** Fifty six listed names across technology, media and
telecom, plus five reference indices. Nine standing coverage queries filtered to
a verified publisher set. Rebased relative performance, theme exposure across
the AI compute, agentic AI and physical AI cohorts, and the full coverage
universe with annual range positions.

**02 Quarterly P&L.** Consolidated IFRS income statement across five quarters,
income statement bridge, expense by nature across thirteen lines, cash flow
summary. Switchable between rupees and dollars.

**03 KPI detail.** Revenue distribution by market and domain on four growth
bases, share against growth quadrant, client concentration by revenue band,
headcount, attrition, and derived unit economics.

**04 Company research.** Name any company. Resolves against the SEC register,
pulls filing history and tagged XBRL financials, checks market position, reads
verified coverage, and computes findings. Private documents can be ingested
alongside the public record.

**05 Diligence agents.** Seven agents with named skills that fetch primary
documents, parse them, and compute findings with evidence attached. Runs export
as CSV or JSON.

## Sources

| Source | Use | Key required |
|---|---|---|
| SEC EDGAR | Filing history, XBRL financials, company register | No |
| Company IR documents | Quarterly fact sheets, parsed in process | No |
| Yahoo Finance | Quotes and price history | No |
| Frankfurter, open.er-api | Foreign exchange, raced | No |
| Verified publisher set | Sector coverage, discovered via Google News | No |

Every figure carries a provenance marker: live, cached, from filing, baseline,
or unavailable. Nothing is estimated, modelled or interpolated. A figure that
was not in a source is not displayed; the field reads "Not set".

### Accuracy notes

- Company-reported currency translations are shown as filed. Conversions the
  console performs itself use the live rate and are marked derived.
- XBRL concepts are merged across candidate tags. Filers migrate between tags
  mid-history, and reading a single tag truncates the series.
- Ratios are only computed where numerator and denominator cover the same
  reporting period. Mismatched periods return "Not set" rather than a number.
- Where a year has been restated, the most recently filed value is used.

### Publisher allowlist

Coverage is restricted to outlets in `lib/sources/registry.ts`, tiered as
primary and wire, financial press, and trade press. Items from unlisted
publishers are discarded at ingestion, not filtered in the interface.

## Rate limits

Yahoo applies an IP-level rate limit. Requests are serialised with a
half-second gap and quotes cache for eight minutes. A partially refused sweep
retains the symbols that resolved in a last-known-good store, labelled with
their age, so the table fills in across refreshes rather than blanking.

## Security

- Automated clients refused: named crawlers, extraction services, headless
  stacks and AI ingestion agents, plus requests missing the header set a browser
  always sends.
- Per-client rate limiting across six budgets: pages, APIs, agents, chat,
  research and uploads.
- JSON endpoints reject cross-origin callers.
- Content security policy permits no external origin for scripts, styles, fonts
  or frames. All assets are same-origin.
- Robots directives refuse all crawlers, each named AI agent individually.
- No SQL in the application. React escapes rendered output.
- Third-party text is stripped of markup, control characters and bidi
  overrides. Instruction-shaped spans are defanged before reaching a prompt, and
  untrusted passages are fenced and labelled inside it.
- Outbound requests restricted to a host allowlist with private ranges blocked.
- CSV exports are formula-guarded.
- Uploaded documents are held in memory for the session, never written to disk
  and never forwarded.

## Optional model provider

The assistant works with no key, answering extractively from retrieved passages
with citations. See `.env.example` to connect a free provider, which changes
phrasing only. Retrieval, citation and injection defences are identical either
way.

## Layout

```
app/                    routes, dashboards, API handlers
components/charts/      SVG chart kit
components/dashboards/  dashboard compositions
components/ui/          shell, navigation, panels, source list
lib/core/               types, cache, outbound fetch
lib/feeds/              SEC, markets, FX, news, filings
lib/research/           company dossier, document ingestion
lib/pdf/                encrypted PDF decryption and extraction
lib/agents/             registry, runtime, run store
lib/rag/                BM25 index, corpus, answering
lib/security/           request gate, sanitisation, session
lib/sources/            publisher allowlist
lib/data/               coverage universe, verified baseline dataset
```

