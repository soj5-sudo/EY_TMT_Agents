# TMT Intelligence Console

A due-diligence console for technology, media and telecom. It reads what
companies actually published, computes the figures itself, and shows the
document behind every number.

Seventy companies. US registrants are read from the SEC's XBRL register.
Indian companies are read from their own exchange filings, fact sheets,
quarterly presentations and earnings call transcripts, because that is where
their numbers are published.

Nothing is typed in by hand. There is no database, and no paid API.

**Start here:** [ARCHITECTURE.md](ARCHITECTURE.md) is the system overview.
It has the end-to-end data flow, how the scrapers work, how the model is
trained, and a step-by-step server setup. Same document as a PDF:
[TMT-Intelligence-Console-Architecture.pdf](TMT-Intelligence-Console-Architecture.pdf).

---

## 1. What you need before you start

| | Version | Check with | Where to get it |
|---|---|---|---|
| Node.js | 20.9 or newer | `node --version` | https://nodejs.org (LTS) |
| npm | 10 or newer | `npm --version` | ships with Node |
| Python | 3.12 or newer | `python3 --version` | only for refreshing data, not for running the app |
| Git | any | `git --version` | https://git-scm.com |

Outbound HTTPS is required. The server fetches from sec.gov and from company
investor-relations domains. There is a fixed allowlist of hosts in
`lib/core/fetcher.ts`; it will not connect to anything else.

---

## 2. Run it locally

```bash
git clone https://github.com/soj5-sudo/EY_TMT_Agents.git
cd EY_TMT_Agents
npm install
npm run dev
```

Open http://localhost:4870

That is the whole setup. No environment file, no key, no database. The first
load of a page takes 30 to 60 seconds because the server is reading filings;
after that it serves from memory for six hours.

If port 4870 is taken, change it in `package.json` under `scripts.dev`.

---

## 3. Run it on your own server

```bash
npm ci
npm run build
npm run start
```

`npm run start` serves on port 4870. Put it behind your reverse proxy.

**nginx**

```nginx
location / {
  proxy_pass http://127.0.0.1:4870;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 300s;
}
```

`proxy_read_timeout` matters. Assembling a company from its filings can take
up to five minutes on a cold cache, and a 60-second default will cut it off.

**systemd**

```ini
[Unit]
Description=TMT Intelligence Console
After=network.target

[Service]
WorkingDirectory=/opt/tmt-console
ExecStart=/usr/bin/npm run start
Restart=always
Environment=NODE_ENV=production
Environment=SEC_USER_AGENT=YourCompany Research (contact: you@yourcompany.com)
User=tmtconsole

[Install]
WantedBy=multi-user.target
```

**Docker**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 4870
CMD ["npm", "run", "start"]
```

Memory: 1 GB is enough. The cache is in-process, so if you run more than one
instance behind a load balancer each one warms its own cache. That is fine, it
just means the first request to each instance is slow.

---

## 4. Environment variables

All of them are optional. The console runs with none set.

| Variable | Default | What it does |
|---|---|---|
| `SEC_USER_AGENT` | a generic string | The SEC asks that automated readers identify themselves. Set this to `YourCompany (contact: someone@yourcompany.com)`. Set it in production. |
| `GEMINI_API_KEY` | unset | Turns on the optional wording pass. See below. |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Which Gemini model. |
| `HF_API_TOKEN` | unset | Same, using Hugging Face instead. |
| `HF_MODEL` | `meta-llama/Llama-3.1-8B-Instruct` | Which Hugging Face model. |

Put them in `.env.local` at the repo root, or set them in systemd. `.env*` is
gitignored; do not commit a key.

```bash
# .env.local
SEC_USER_AGENT=Acme Research (contact: research@acme.com)
GEMINI_API_KEY=AIza...
```

### What a language model is and is not used for

**It is not used to produce any figure.** Every number on every screen is
computed by the code in this repository from a document it downloaded. A model
never sees a request for a number, and switching it off changes no figure
anywhere.

The only thing a key buys is wording. When `GEMINI_API_KEY` or `HF_API_TOKEN`
is set, the answer text on the "Ask the data" panel is passed through the model
with an instruction to tighten the prose and change no number, name, date or
citation. With no key, the console writes that text itself, which it does
perfectly well. The panel names which of the two is in use.

If the model call fails, times out, or is rate limited, the original text is
returned. A dead key cannot empty a page.

The code is one file: `lib/ai/provider.ts`. To add a third provider, add a
function alongside `gemini()` and `huggingface()`.

---

## 5. What is on each screen

| Route | What it answers |
|---|---|
| `/` | Sector signal. All seventy names: revenue, margin, growth, research intensity, split by segment, region and theme, with the coverage feed. |
| `/dashboard/company` | One company end to end. Key measures, per-employee economics, the income statement, transactions, developments, and what management said on the last call. |
| `/compare` | Two or three companies on the same measures, then one company against a named cohort. |
| `/dashboard/tracker` | The quarterly sector record for the listed Indian IT services names, with the earnings call quotes behind each move. |
| `/research` | Name any company and get a research pack. Accepts private documents, which are parsed in the request and never stored. |
| `/agents` | The diligence workstreams. See section 7. |

---

## 6. Where the data comes from

Three kinds of source, in the order the console tries them.

**1. The SEC register.** For US registrants, `lib/research/facts.ts` pulls the
company's XBRL `companyfacts` document in one request and lifts 44 diligence
concepts from it, under both the us-gaap and ifrs-full taxonomies. This is the
whole reported history, not a summary of it.

**2. The company's own published files.** For companies that do not file with
the SEC, and for Indian companies that do, the console downloads their
published spreadsheets and PDFs and reads them:

- `lib/research/ir-scrape.ts` finds and downloads the documents.
- `lib/research/xlsx.ts` reads spreadsheets with no dependency.
- `lib/pdf/extract.ts` reads PDFs, including AES-256 encrypted ones and
  subset-font documents that need the ToUnicode map decoded.
- `lib/research/ir-narrative.ts` reads figures stated in a sentence rather
  than a table, which is how most mid-caps publish. A figure is taken only
  when one sentence names the period, names the measure, and puts a currency
  and a scale against the number.
- `lib/research/ir-facts.ts` maps what was read onto the same concept set the
  SEC path produces, converts to US dollars at a live rate, and refuses any row
  whose currency or scale the document did not state.

**3. A checked reading, as the floor.** Some investor-relations hosts serve
their files to an ordinary connection and refuse one from a data centre. For
those, `lib/data/ir-published.ts` holds the latest published quarter for each
company, read from the document and then checked against that same document a
second time before being recorded. Every row carries the document URL, the
period, and whether it was confirmed or corrected on the second reading. These
figures only ever fill a gap; a figure computed live always wins.

Currency conversion is live, from the ECB via Frankfurter, no key. Prices are
from Yahoo Finance, no key. Coverage is Google News RSS, no key.

### Refreshing the stored readings

Only needed when you want to pull in a newer quarter. The app runs without
ever doing this.

```bash
# Python side, only for discovery. One-time setup:
cd scraper
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

npm run discover:ir     # find document URLs on each investor site
npm run harvest:ir      # download and read them into lib/data/ir-ledger-snapshot.ts
npm run ingest:sheets   # re-read the two published tracker workbooks
```

Discovery renders investor pages in a headless browser, because several build
their file list in JavaScript. The reading is done in TypeScript either way, so
every figure comes from one reader with one set of rules.

---

## 7. How the agents work

The agents are deterministic TypeScript. No model is called, nothing is
generated, and the same company on the same filings gives the same answer every
time. They are called agents because each one holds a role, reads only the
evidence its role calls for, states what it found, and hands to the next.

### The three layers

```
lib/agents/registry.ts    47 seats: id, role, what it needs, who it hands to
lib/agents/analysis.ts    what each seat actually does with the evidence
lib/agents/os.ts          the orchestrator: order, evidence, gates, handoffs
```

### The run

```
POST /api/workstream  { "workstream": "full", "company": "TCS" }

  1. Resolve the subject          lib/research/company.ts
     Ticker, exchange, sector, and which source path applies.

  2. Build the dossier once       ledgerFor() in lib/brain/ledger.ts
     Filings, the concept ledger, narrative sections of the annual report,
     published results files, coverage, peers. Built once and passed to every
     seat, so forty seven agents cause one set of downloads.

  3. Run the workstreams in order
     screening, financial, commercial, operational, technology, legal,
     people, ESG, synthesis. Each seat receives the dossier plus every
     finding made upstream of it.

  4. Each seat emits findings
     severity (risk | attention | info), a headline, a detail that shows the
     series it read, the provenance of each figure, and optionally one metric
     that later seats can cross-check.

  5. Synthesis
     The consistency seat checks that no figure was asserted two different
     ways. The adversary seat argues the case for declining from the same
     record. The memo seat writes the committee paper.

  6. Gaps become the document request list
     Anything a seat needed and could not find is returned as a gap, which is
     what you send to the target company.
```

### Calling it

```bash
curl -X POST http://localhost:4870/api/workstream \
  -H 'Content-Type: application/json' \
  -d '{"workstream":"full","company":"Coforge"}'
```

```jsonc
{
  "subject": "Coforge Limited",
  "runs":     [ /* one per workstream, each with its seats */ ],
  "findings": [ /* every finding, flattened, most severe first */ ],
  "gaps":     [ /* what could not be evidenced */ ],
  "gates":    [ /* the points a human has to sign off */ ],
  "summary":  "..."
}
```

`{"workstream":"financial"}` runs one workstream instead of all of them.
`{"documents":[...]}` adds private files to the evidence for that request only;
they are parsed in the request and never written to disk.

### Adding a seat

1. Add an entry to `AGENTS` in `lib/agents/registry.ts`, giving it an `id`, a
   `workstream`, what it `needs` and who it `handsTo`.
2. Add a function with the same `id` to the map at the bottom of
   `lib/agents/analysis.ts`. It receives `(dossier, emit, priorFindings)`.
3. Emit findings with `e.find(severity, headline, detail, metric?)`.

The rule the whole thing rests on: a seat may only state something it can point
at. If the evidence is not there, it says so and the gap goes on the list. That
is why the console will tell you a figure is not published rather than
estimating it.

---

## 8. The intent model

`/api/chat` routes a typed question to the right computation. A set of keyword
rules produces an intent, and a multinomial logistic regression trained on
labelled questions overrides that intent when it is confident enough. The model
sits in front of the rules; it does not replace them.

- Training script: `scripts/train-intent.mts`
- Weights, checked in: `lib/brain/intent-model.ts`
- Classifier: `lib/brain/classifier.ts`
- The rules, and the floor that decides which answer stands: `lib/brain/intent.ts`

Measured on 34 held-out pattern families, 1,794 questions the model has never
seen phrased that way:

| | Held out |
|---|---|
| Model alone | 81.2% |
| Keyword rules alone | 82.1% |
| Model in front of the rules, 0.80 confidence floor | 82.7% |

The rules beat the model overall, which is why both are kept. The model exists
for comparison questions, where it scores 100 percent against the rules' 74.5
percent on phrasings like "how does X stack up against Y". The confidence floor
keeps it out of the way on the classes the rules already handle well. The
training script sweeps that floor from 0 to 0.95 and prints the best.

Retrain after adding training examples:

```bash
npm run train:intent
```

That rewrites `lib/brain/intent-model.ts`. Commit it. There is no model file to
load at runtime and no inference server; the weights are a TypeScript array and
the classifier is about forty lines of arithmetic.

---

## 9. Repository map

```
app/
  page.tsx                 sector signal
  dashboard/company/       the company dashboard
  dashboard/tracker/       the quarterly sector record
  compare/                 side by side and cohort position
  research/                research pack, private document upload
  agents/                  diligence workstreams
  api/                     every endpoint listed in section 10

components/
  charts/                  hand-built SVG. No chart library.
  dashboards/              one component per screen
  ui/                      panel, stat block, provenance chip, company picker

lib/
  agents/                  registry, analysis, orchestrator
  ai/provider.ts           the optional wording model
  brain/                   ledger, company view, sector rows, intent, engine
  core/                    fetcher with host allowlist, cache, types
  data/                    the checked-in readings, all generated
  feeds/                   SEC, FX, prices, news
  financials/              statement model and ratios
  pdf/extract.ts           PDF reader
  rag/                     retrieval for the ask-the-data panel
  research/                document reading and the concept ledger
  security/                input sanitising

scraper/                   Python. Document discovery only.
scripts/                   data refresh and model training
```

### Dependencies

```json
"dependencies": {
  "next": "^16.3.0",
  "react": "^19.2.8",
  "react-dom": "^19.2.8"
}
```

That is the entire runtime dependency list. No chart library, no PDF library,
no spreadsheet library, no ORM, no state manager. Everything else is
TypeScript in this repository. `npm audit` has nothing to report because there
is almost nothing to report on.

---

## 10. API

Every endpoint is GET unless marked. All return JSON. None require a key.

| Endpoint | Returns |
|---|---|
| `/api/health` | Liveness. |
| `/api/sector` | All seventy companies with their figures, plus segment and theme roll-ups. Slow when cold, six-hour cache. |
| `/api/company?company=TCS` | One company: periods, key measures, per-employee measures, operating measures, call quotes, sources. |
| `/api/compare?companies=TCS,Infosys,Wipro` | The same measures across up to six companies. |
| `/api/benchmark?company=TCS` | One company against a named cohort, with the full distribution. |
| `/api/financials?company=ACN` | The filed income statement, quarter by quarter. |
| `/api/tracker` | The quarterly sector record and the peer universe. |
| `/api/feeds/news` | The curated coverage feed. |
| `/api/feeds/search?q=Coforge` | Live coverage search. |
| `/api/feeds/markets`, `/api/feeds/fx` | Prices and exchange rates. |
| `/api/filings?company=ACN` | Filing history. |
| `/api/research` (POST) | The research pack. |
| `/api/workstream` (POST) | The agents. See section 7. |
| `/api/export` (POST) | The current view as a file. |

---

## 11. Security

- **Host allowlist.** `lib/core/fetcher.ts` will only connect to hosts on a
  fixed list. Adding a data source means adding its host there deliberately.
  This is what stops a URL in a document from turning the server into a proxy.
- **No user data is stored.** There is no database and no session. Documents
  uploaded on the research page are parsed inside that one request and are gone
  when it returns.
- **Input is sanitised** at every endpoint before it reaches a query
  (`lib/security/sanitize.ts`).
- **The site refuses automated clients.** `proxy.ts` returns 403 to
  self-declared bots and to requests with no browser signature.
- **Content Security Policy** admits no external origin, which is why the
  charts are hand-built.
- **Untrusted text is marked.** Anything read out of a third-party document is
  labelled as such in the citation and never treated as an instruction.

Before going live on your own domain, set `SEC_USER_AGENT` to a real contact
address. The SEC blocks readers that do not identify themselves.

---

## 12. Handover checklist

- [ ] `npm ci && npm run build && npm run start` succeeds on the target server
- [ ] Reverse proxy read timeout raised to 300 seconds
- [ ] `SEC_USER_AGENT` set to a real contact address
- [ ] Outbound HTTPS permitted to sec.gov and the investor-relations hosts in
      `lib/core/fetcher.ts`
- [ ] Decide whether you want a wording model. If yes, put the key in the
      environment, not in the repository
- [ ] Someone owns the quarterly refresh: `npm run discover:ir` then
      `npm run harvest:ir`, once a quarter after results season

## 13. Known limits, stated plainly

- **Two companies carry no revenue.** Thoughtworks was taken private in 2024
  and no longer reports. Experian publishes a first-quarter trading update with
  growth rates and no revenue figure.
- **Two transcripts cannot be quoted.** Infosys and Birlasoft set their call
  transcripts in two columns, which the PDF reader interleaves. Rather than
  print a garbled quote, those two carry the tracker's written note instead,
  labelled as such.
- **Utilisation is not universal.** Only companies that publish a utilisation
  rate carry revenue per billable employee. It is not estimated for the others.
- **The cache is per process.** Behind a load balancer, each instance warms
  separately.
- **The quarterly tracker is a fixed reading**, not a live feed, and the screen
  says so. Everything else on the console is computed on the request.
