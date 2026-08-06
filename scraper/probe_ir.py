"""
Can a rendered browser reach the results files that a plain request cannot?

Five companies in the coverage universe publish their results only through an
investor relations site that builds its file list in the browser. A plain HTTP
request returns the page shell with no link in it, so the console has no source
for them at all. This checks whether rendering the page changes that, before
any of it is wired into the harvest.

Run:
    scraper/.venv/bin/python scraper/probe_ir.py
"""

import re
import sys
from urllib.parse import urljoin

from scrapling.fetchers import DynamicFetcher, Fetcher

TARGETS = [
    ("Tech Mahindra", "https://www.techmahindra.com/investors/"),
    ("LTIMindtree", "https://www.ltimindtree.com/investors/financial-results/"),
    ("Coforge", "https://www.coforge.com/investors"),
    ("Persistent", "https://www.persistent.com/investors/"),
    ("Capgemini", "https://investors.capgemini.com/en/"),
]

FILE_RE = re.compile(r"\.(xlsx?|pdf)(?:$|\?)", re.I)
RESULTS_RE = re.compile(
    r"result|quarter|financial|earning|fact|press|q[1-4]|fy\d{2}", re.I
)


def links_from(page, base):
    out = set()
    for href in page.css("a::attr(href)").getall():
        if not href:
            continue
        absolute = urljoin(base, href.strip())
        if FILE_RE.search(absolute):
            out.add(absolute)
    return out


def main() -> int:
    for name, url in TARGETS:
        print(f"\n=== {name}")
        print(f"    {url}")

        # Baseline: the same plain request the console makes today.
        try:
            plain = Fetcher.get(url, stealthy_headers=True, timeout=30)
            plain_files = links_from(plain, url)
            print(f"    plain    status={plain.status} files={len(plain_files)}")
        except Exception as exc:  # noqa: BLE001
            print(f"    plain    failed: {type(exc).__name__}: {exc}")
            plain_files = set()

        # Rendered: let the page build its own list first.
        try:
            page = DynamicFetcher.fetch(
                url,
                headless=True,
                network_idle=True,
                load_dom=True,
                timeout=90000,
            )
            files = links_from(page, url)
            results = {f for f in files if RESULTS_RE.search(f.rsplit("/", 1)[-1])}
            print(
                f"    rendered status={page.status} files={len(files)} "
                f"results-shaped={len(results)} gained={len(files - plain_files)}"
            )
            for f in sorted(results)[:6]:
                print(f"      {f[:130]}")
            if not results:
                for f in sorted(files)[:4]:
                    print(f"      (other) {f[:120]}")
        except Exception as exc:  # noqa: BLE001
            print(f"    rendered failed: {type(exc).__name__}: {str(exc)[:160]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
