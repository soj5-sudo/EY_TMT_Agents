# Engineering notes

Working notes for anyone extending this console. Conventions, the non-obvious
decisions, and the things that cost time to discover.

Owner: Soham Jariwala.

## Conventions

- Every figure reaching a screen carries a `Provenance`. If you add a data
  source, add its provenance with it. A number without a source does not ship.
- Empty values render `Not set`. Never blank, never a dash.
- No emoji in interface copy. No em or en dashes; use a period, comma or colon.
- Components read semantic CSS tokens only. A hardcoded hex inside a component
  is a bug, because the token tier is what makes the theme swappable.
- Charts are hand-built SVG in `components/charts`. No chart library: the CSP
  admits no external origin and library defaults fight the visual language.

## Non-obvious decisions

**Encrypted filings.** Several IR fact sheets ship AES-256 encrypted
(`/AESV3`, revision 6) with an empty user password. A naive inflate returns
nothing. `lib/pdf/extract.ts` derives the file key per ISO 32000-2 algorithm 2.B
and decrypts each stream first. Stream slices must be trimmed of the trailing
EOL before `endstream` or AES block alignment breaks.

**Host headers.** `tcs.com` returns 403 to a bare client and 200 to a full
browser header set. `lib/core/fetcher.ts` sends one by default.

**SEC concept merging.** Filers migrate between XBRL tags mid-history. NVIDIA
reported revenue under `RevenueFromContractWithCustomerExcludingAssessedTax`
through FY2022 and `Revenues` after. Reading the first tag that resolves
truncates the series four years early and produces a 484 percent operating
margin. `getConcept` fetches every candidate tag and merges on reporting period,
newest filing winning.

**Period matching.** Ratios are computed only where numerator and denominator
cover the same period. Series lengths differ by concept, so taking the last
point of each independently divides one year's profit by another year's revenue.
Return null instead; the interface renders `Not set`.

**Yahoo rate limits.** IP-level and persistent for minutes once tripped.
Quote sweeps are serial with a 500 ms gap, cached eight minutes, and backed by a
last-known-good map so a refused sweep degrades to labelled stale values rather
than an empty table.

**FX providers are raced.** Frankfurter latency has been observed between under
a second and 40 seconds. `Promise.any` against open.er-api returns whichever
answers and fails only when both do.

**Stooq is not usable.** It now serves a JavaScript proof-of-work challenge.

**Cache retains expired entries.** `cacheGet` does not delete on expiry. The
stale entry is the fallback when a refresh fails. Eviction is by size only.

## Adding a company

Add it to `lib/data/universe.ts` with its Yahoo symbol, sector, subsector,
region and themes. CIKs resolve at runtime from the SEC ticker map, so do not
hardcode them. Verify the symbol resolves before committing.

## Adding a publisher

Add the registrable domain to `lib/sources/registry.ts` with a tier. Tier 1 is
primary and wire only. Anything not listed is discarded at ingestion.

## Testing

```bash
npm run typecheck
```

```bash
npm run build
```

Exercise the gate after any change to `proxy.ts` or `lib/security`: a browser
user agent should get 200 and an automated one 403.

## Known limits

- PDF extraction reads WinAnsi and Standard encodings. ToUnicode CMaps for
  subset fonts with custom encodings are not resolved. Callers check parse
  confidence rather than trusting output.
- The session key for uploaded documents is derived from request headers, not a
  cookie. Two browsers on one machine share a key. Acceptable for a
  single-operator local deployment; not isolation.
- Dashboards 02 and 03 are TCS-depth. The parsers, agents and charts are
  company-agnostic, so extending them is a data task.
