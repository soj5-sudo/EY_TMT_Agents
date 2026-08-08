from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

from scrapling.fetchers import DynamicFetcher, Fetcher

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "lib" / "data" / "ir-discovered.ts"

INDEXES: dict[str, list[str]] = {
    "TCS.NS": ["https://www.tcs.com/investor-relations/financial-statements"],
    "HCLTECH.NS": ["https://www.hcltech.com/investors/quarterly-results"],
    "MPHASIS.NS": ["https://www.mphasis.com/home/corporate/investors.html"],
    "TECHM.NS": ["https://www.techmahindra.com/investors/quarterly-earnings/"],
    "BHARTIARTL.NS": ["https://www.airtel.in/about-bharti/equity/results"],
    "RELIANCE.NS": ["https://www.ril.com/InvestorRelations/FinancialReporting.aspx"],
    "LTIM.NS": [
        "https://www.ltm.com/investors/financial-results",
        "https://www.ltimindtree.com/investors/financial-results/",
    ],
    "COFORGE.NS": ["https://investors.coforge.com/quarter-reports"],
    "PERSISTENT.NS": ["https://www.persistent.com/investors/quarterly-results/"],
    "CAP.PA": ["https://investors.capgemini.com/en/financial-results/"],
    "EXPN.L": [
        "https://www.experianplc.com/investors/results-reports-presentations/results-presentations"
    ],
    "ATE.PA": ["https://www.alten.com/investors/"],
    "ZENSARTECH.NS": [
        "https://www.zensar.com/investors",
        "https://www.zensar.com/about/investors/investors-relation",
    ],
    "BSOFT.NS": [
        "https://www.birlasoft.com/company/investors/financial-reports",
        "https://www.birlasoft.com/company/investors",
        "https://www.birlasoft.com/company/investors/policies-reports-filings",
    ],
    "MASTEK.NS": [
        "https://www.mastek.com/investors/financial-information/",
        "https://www.mastek.com/investors/quarterly-results/",
    ],
    "DATAMATICS.NS": [
        "https://www.datamatics.com/about-us/investor-relations/financials",
        "https://www.datamatics.com/investors/financial-results",
        "https://www.datamatics.com/about-us/investor-relations",
    ],
    "RSYSTEMS.NS": [
        "https://www.rsystems.com/investors-info/",
        "https://www.rsystems.com/investors/financial-results/",
    ],
    "HAPPSTMNDS.NS": [
        "https://www.happiestminds.com/investors/",
        "https://www.happiestminds.com/investors/financial-results/",
    ],
    "SAKSOFT.NS": [
        "https://www.saksoft.com/investor/financials/",
        "https://www.saksoft.com/investor/",
    ],
    "KELLTONTEC.NS": [
        "https://www.kellton.com/financial-results",
        "https://www.kellton.com/investors",
    ],
    "GLOB": ["https://investors.globant.com/quarterly-earnings"],
}

FILE_RE = re.compile(r"\.(xlsx?|pdf)(?:$|\?)", re.I)

NOISE_RE = re.compile(
    r"modern[-_ ]?slavery|policy|policies|code[-_ ]?of|charter|notice|intimation|"
    r"postal[-_ ]?ballot|scrutin|newspaper|advertis|agm|egm|dividend[-_ ]?payment|"
    r"transfer|dematerialis|unclaimed|nomination|whistle|prevention|terms[-_ ]?of|"
    r"subsidiar",
    re.I,
)

def score(url: str) -> int:
    name = url.rsplit("/", 1)[-1].lower()
    s = 0
    if re.search(r"\.xlsx?($|\?)", name):
        s += 60
    if re.search(r"data[-_ ]?sheet|fact[-_ ]?sheet|factsheet", name):
        s += 50
    if re.search(r"kpi|key[-_ ]?(financial|metric)|metrics", name):
        s += 40
    if re.search(r"quarter|result|earning|financial", name):
        s += 25
    if re.search(r"press[-_ ]?release|investor[-_ ]?(release|presentation|update)", name):
        s += 20
    if re.search(r"transcript|earnings[-_ ]?call", name):
        s += 15
    if re.search(r"q[1-4]|fy[-_ ]?\d{2}", name):
        s += 25
    year = re.search(r"(?:fy|20)(\d{2})\b", name)
    if year:
        s += min(30, int(year.group(1))) * 2
    if NOISE_RE.search(name):
        s -= 90
    return s

def collect(page, base: str) -> set[str]:
    out: set[str] = set()
    for href in page.css("a::attr(href)").getall():
        if not href:
            continue
        absolute = urljoin(base, href.strip())
        if not FILE_RE.search(absolute):
            continue
        if urlparse(absolute).scheme not in ("http", "https"):
            continue
        out.add(absolute)
    return out

def discover(url: str) -> tuple[set[str], str]:
    try:
        plain = Fetcher.get(url, stealthy_headers=True, timeout=30)
        files = collect(plain, url)
        if any(score(f) > 0 for f in files):
            return files, "plain"
    except Exception:  # noqa: BLE001
        files = set()

    try:
        page = DynamicFetcher.fetch(
            url, headless=True, network_idle=True, load_dom=True, timeout=90000
        )
        return collect(page, url) | files, "dynamic"
    except Exception as exc:  # noqa: BLE001
        print(f"      rendered failed: {type(exc).__name__}: {str(exc)[:110]}")
        return files, "plain"

def main() -> int:
    result: dict[str, dict] = {}

    for symbol, urls in INDEXES.items():
        best: list[str] = []
        used = ""
        mode = ""

        for url in urls:
            files, how = discover(url)
            ranked = sorted(
                ({f for f in files if score(f) > 0}),
                key=lambda f: -score(f),
            )
            if ranked:
                best = ranked[:24]
                used = url
                mode = how
                break

        result[symbol] = {"indexUrl": used or urls[0], "mode": mode or "none", "files": best}
        print(f"{symbol:16} {mode or 'none':8} {len(best):2} files  {used or urls[0][:60]}")
        for f in best[:3]:
            print(f"                  {f[:118]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    banner = (
        "/**\n"
        " * Document URLs exposed by each investor relations index.\n"
        " *\n"
        " * Generated by scraper/discover_ir. Several of these sites build their file\n"
        " * list in the browser, so the URLs below only appear once the page has been\n"
        " * rendered, which the harvest can do and the deployment cannot.\n"
        " *\n"
        " * Discovery only. The documents themselves are downloaded and read by the\n"
        " * TypeScript side, so every figure on the dashboard comes from one reader\n"
        " * with one set of rules and this file only ever contributes addresses.\n"
        " *\n"
        " * Refresh with: npm run discover:ir\n"
        " */\n\n"
        "export interface DiscoveredIrIndex {\n"
        "  indexUrl: string;\n"
        "  /** How the list was obtained: a plain request, or a rendered page. */\n"
        "  mode: string;\n"
        "  files: string[];\n"
        "}\n\n"
        f"export const IR_DISCOVERED_AT = {json.dumps(datetime.now(timezone.utc).isoformat())};\n\n"
        "export const IR_DISCOVERED: Record<string, DiscoveredIrIndex> = "
    )
    OUT.write_text(banner + json.dumps(result, indent=1) + ";\n")

    total = sum(len(v["files"]) for v in result.values())
    covered = sum(1 for v in result.values() if v["files"])
    print(f"\nwrote {OUT.relative_to(REPO)}: {covered} of {len(INDEXES)} indexes, {total} files")
    return 0

if __name__ == "__main__":
    sys.exit(main())
