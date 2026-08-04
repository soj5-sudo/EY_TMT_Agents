import { PageHeader, Stack } from "@/components/ui/Bits";
import { PUBLISHERS, TIER_LABEL } from "@/lib/sources/registry";
import { AGENTS, WORKSTREAMS } from "@/lib/agents/registry";
import { UNIVERSE } from "@/lib/data/universe";

export const metadata = {
  title: "Terms and sources",
};

export default function TermsPage() {
  const byTier = ([1, 2, 3] as const).map((t) => ({
    tier: t,
    label: TIER_LABEL[t],
    names: PUBLISHERS.filter((p) => p.tier === t).map((p) => p.name),
  }));

  return (
    <div className="shell">
      <PageHeader
        index="Reference"
        title="Terms and sources"
        lede="What this console is, where its numbers come from, and what it does not do."
      />

      <Stack gap={0}>
        <div className="prose">
          <h2>What this is</h2>
          <p>
            A working tool for analysts covering technology, media and telecom. It
            assembles evidence from public filings, market data and verified
            press, runs it through a set of specialist seats, and produces
            findings with the source attached to each one.
          </p>
          <p>
            It is a prototype. Coverage depth varies by company and by
            workstream, and the console says so on the surface rather than in a
            footnote.
          </p>

          <h2>Not investment advice</h2>
          <p>
            Everything here is information, not advice. Nothing on this console is
            a recommendation to buy, sell or hold any security, and nothing here
            takes account of anyone&apos;s circumstances or objectives.
          </p>
          <p>
            The output is a starting point for your own work. Please take
            professional advice before acting on any of it, and check any figure
            against its original source before it goes into a document that
            matters.
          </p>

          <h2>Where the numbers come from</h2>
          <ul>
            <li>
              Filing history and tagged financials come from{" "}
              <a href="https://www.sec.gov/edgar" target="_blank" rel="noopener noreferrer">
                SEC EDGAR
              </a>
              , the official filing system.
            </li>
            <li>
              Company documents are read directly from the publisher&apos;s own
              investor relations material.
            </li>
            <li>Quotes and price history come from a public market data feed.</li>
            <li>
              Exchange rates come from two independent providers, whichever
              answers first.
            </li>
            <li>
              Press coverage is restricted to the publisher list below.
              Everything else is discarded before it is read.
            </li>
          </ul>

          <h2>How accuracy is handled</h2>
          <ul>
            <li>
              Every figure carries a marker showing whether it is live, cached,
              from a filing, from the checked-in baseline, or unavailable.
            </li>
            <li>
              Nothing is estimated or interpolated. A figure that was not in a
              source is not shown; the field reads &quot;Not set&quot;.
            </li>
            <li>
              Ratios are computed only where the numerator and denominator cover
              the same reporting period.
            </li>
            <li>
              Financial concepts are merged across the tag variants a company has
              used over time, so a series is not silently truncated when a filer
              changes its tagging.
            </li>
            <li>
              Where a year has been restated, the most recently filed value is
              used.
            </li>
            <li>
              A seat with no evidence raises a document request rather than
              producing an answer.
            </li>
          </ul>

          <h2>Your documents</h2>
          <p>
            Documents you attach are parsed in memory for your session only. They
            are never written to disk, never sent to a third party, and are
            discarded when the process restarts or when you clear them.
          </p>

          <h2>Coverage</h2>
          <p>
            {UNIVERSE.length} listed companies across technology, media and
            telecom, plus on-demand research against any company in the SEC
            register. {AGENTS.length} seats across {WORKSTREAMS.length}{" "}
            workstreams.
          </p>

          <h2>Verified publishers</h2>
          <p>
            Coverage is limited to these outlets. Anything published elsewhere is
            dropped at ingestion rather than filtered on screen.
          </p>
          {byTier.map((group) => (
            <div key={group.tier} style={{ marginBottom: 18 }}>
              <p className="t-label" style={{ fontSize: 10, marginBottom: 8 }}>
                Tier {group.tier}, {group.label}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
                {[...new Set(group.names)].join(" · ")}
              </p>
            </div>
          ))}

          <h2>Third-party text</h2>
          <p>
            Headlines are reproduced from their publishers and are not verified by
            this console. They are labelled as third-party throughout, and they
            are treated as data rather than as instruction wherever they reach an
            automated step.
          </p>

          <h2>Built by</h2>
          <p>
            Developed by{" "}
            <a href="https://jewellabs.io" target="_blank" rel="noopener noreferrer">
              Jewel Labs
            </a>
            .
          </p>
        </div>
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
