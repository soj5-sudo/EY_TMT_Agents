# Rendered scraping

Some investor relations sites build their file list in the browser. A plain
HTTP request returns the page shell with no link in it, so the console has no
source for those companies at all.

[Scrapling](https://github.com/D4Vinci/Scrapling) renders the page first, which
recovers the links. Verified: LTIMindtree goes from three files to seven,
including its quarterly factsheet and consolidated financials; Persistent
exposes its analyst factsheet.

This is a harvest-time tool, not a runtime one. The deployed console is
zero-dependency TypeScript on a serverless host and cannot carry Python or a
browser binary. The harvest reads the documents, commits what it found, and the
commit is itself a deploy.

## Setup

The macOS system Python is 3.9 and Scrapling needs 3.10 or newer. The Homebrew
python@3.12 on this machine has a broken pyexpat, which breaks XML, plists and
therefore pip, so the environment is built with `uv`, which ships its own
CPython.

    curl -LsSf https://astral.sh/uv/install.sh | sh
    uv venv --python 3.12 scraper/.venv
    uv pip install --python scraper/.venv/bin/python -r scraper/requirements.txt
    scraper/.venv/bin/scrapling install

## Use

    scraper/.venv/bin/python scraper/probe_ir.py      # what a rendered page exposes
    scraper/.venv/bin/python scraper/discover_ir.py   # write the discovered file list
