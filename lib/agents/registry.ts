/**
 * Agent registry.
 *
 * The unit of work is not a prompt, it is a seat. Each seat has a defined role,
 * a declared evidence contract, and a named handoff to the seat after it. That
 * is what makes a run repeatable: the same company through the same workstream
 * produces the same structure of output every time, and any figure can be
 * traced back to the seat and the source that produced it.
 *
 * An agent emits one of two things. A finding, which is backed by evidence and
 * carries its provenance. Or a gap, which names the document that would close
 * it. A seat that lacks evidence never guesses; it raises the request. That is
 * how a real diligence checklist behaves and it is the reason output from this
 * system is usable in a committee paper.
 */

export type WorkstreamId =
  | "context"
  | "screening"
  | "commercial"
  | "financial"
  | "operational"
  | "legal"
  | "people"
  | "esg"
  | "synthesis"
  | "monitoring";

export interface Workstream {
  id: WorkstreamId;
  step: string;
  name: string;
  purpose: string;
  /** What a reviewer should be able to conclude once this workstream closes. */
  closes: string;
}

export const WORKSTREAMS: Workstream[] = [
  {
    id: "context",
    step: "00",
    name: "Context and intake",
    purpose:
      "Establish who the subject is and assemble the shared record every later seat reads from.",
    closes: "The subject is identified and the evidence base is known.",
  },
  {
    id: "screening",
    step: "01",
    name: "Screening and thesis",
    purpose:
      "Decide whether the subject is worth diligence at all, and write down what would have to be true for the investment to work.",
    closes: "Proceed or pass, with the thesis and the killer questions stated.",
  },
  {
    id: "commercial",
    step: "02",
    name: "Commercial",
    purpose:
      "Test the market, the position within it, and whether demand is durable.",
    closes: "The revenue line is explained by something other than the company's own account of it.",
  },
  {
    id: "financial",
    step: "03",
    name: "Financial",
    purpose:
      "Test whether reported earnings are real, repeatable and convertible to cash.",
    closes: "Quality of earnings is understood and adjustments are quantified.",
  },
  {
    id: "operational",
    step: "04",
    name: "Operational",
    purpose:
      "Test whether the business can deliver what it has sold at the margin it claims.",
    closes: "Delivery capacity, systems and dependency risk are mapped.",
  },
  {
    id: "legal",
    step: "05",
    name: "Legal, regulatory and tax",
    purpose:
      "Find the obligations and exposures that do not appear in the accounts.",
    closes: "Structure, contracts, disputes and tax position are documented.",
  },
  {
    id: "people",
    step: "06",
    name: "People and culture",
    purpose:
      "Test whether the team that produced the record will produce the plan.",
    closes: "Management capability, incentives and key-person risk are assessed.",
  },
  {
    id: "esg",
    step: "07",
    name: "ESG and sustainability",
    purpose:
      "Identify environmental, social and governance exposures that carry financial or reputational cost.",
    closes: "Material ESG risks are named and sized.",
  },
  {
    id: "synthesis",
    step: "08",
    name: "Synthesis and decision",
    purpose:
      "Reconcile every workstream into one view, attack it, and produce the paper.",
    closes: "A committee-ready memo with the open items and the dissent recorded.",
  },
  {
    id: "monitoring",
    step: "09",
    name: "Portfolio monitoring",
    purpose:
      "Run the holding after the deal closes, on a cadence set by the business rather than by the reporting calendar.",
    closes: "Position, runway and flags are current, with escalation already triggered.",
  },
];

/** What an agent needs before it can produce anything. */
export type EvidenceKind =
  | "public-filings"
  | "market-data"
  | "verified-news"
  | "provided-documents"
  | "prior-findings";

export interface AgentSkill {
  id: string;
  name: string;
  summary: string;
}

export interface AgentDef {
  id: string;
  /** Short working name. This is what appears on the seat in the console. */
  name: string;
  workstream: WorkstreamId;
  role: string;
  /** Why the seat exists. What goes wrong when nobody holds it. */
  why: string;
  skills: AgentSkill[];
  needs: EvidenceKind[];
  /** Seats this one hands its output to. */
  handsTo: string[];
  /** True when a person must sign the output before the workstream advances. */
  humanGate: boolean;
}

const s = (id: string, name: string, summary: string): AgentSkill => ({
  id,
  name,
  summary,
});

export const AGENTS: AgentDef[] = [
  /* ---------------- 00 Context ---------------- */
  {
    id: "search",
    name: "Search",
    workstream: "context",
    role: "Find the subject and everything public about it",
    why: "Every later seat reads from what this one finds. Get the entity wrong and the whole run is about a different company, which is the most expensive error in the process and the hardest to notice late.",
    skills: [
      s("resolve", "Resolve entity", "Match the name to a registrant, ticker and filing history."),
      s("register", "Pull the register", "Retrieve the filing index and classification from the regulator."),
      s("coverage", "Sweep coverage", "Collect verified press coverage across the window."),
      s("disambiguate", "Disambiguate", "Surface near-matches so the wrong subsidiary is not researched."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["intake", "explain"],
    humanGate: false,
  },
  {
    id: "intake",
    name: "Intake",
    workstream: "context",
    role: "Normalise whatever was supplied into one schema",
    why: "Founders and vendors send the same numbers in a dozen shapes. Rekeying by hand is where transcription errors enter and where an analyst loses two days a quarter.",
    skills: [
      s("parse", "Parse documents", "Read supplied PDFs, spreadsheets and text into structured text."),
      s("normalise", "Normalise to schema", "Map varied labels onto one internal set of line items."),
      s("tag", "Tag figures", "Pull labelled values and keep the surrounding context for audit."),
      s("inventory", "Inventory the pack", "Record what was received and what is missing."),
    ],
    needs: ["provided-documents"],
    handsTo: ["reconcile", "quality-of-earnings"],
    humanGate: false,
  },
  {
    id: "explain",
    name: "Explain",
    workstream: "context",
    role: "Say what a figure means in plain language",
    why: "A number without an interpretation gets read differently by every person around the table. This seat writes the one-line reading so the committee argues about the decision rather than about what the metric was.",
    skills: [
      s("define", "Define the metric", "State what the measure is and what it excludes."),
      s("benchmark", "Set the reference", "Give the range that counts as normal for this sector."),
      s("read", "Give the reading", "Say what this particular value indicates, and what would change it."),
      s("caveat", "Name the limits", "State what the figure cannot tell you."),
    ],
    needs: ["prior-findings"],
    handsTo: [],
    humanGate: false,
  },

  /* ---------------- 01 Screening ---------------- */
  {
    id: "screen",
    name: "Screen",
    workstream: "screening",
    role: "Test the subject against the mandate",
    why: "Most deals should die here. Time spent screening properly is the cheapest time in the process; a bad deal killed at step one costs a day, at step eight it costs a quarter.",
    skills: [
      s("size", "Size the subject", "Revenue, growth and scale against the mandate band."),
      s("sector-fit", "Check sector fit", "Position the subject in the coverage taxonomy."),
      s("trajectory", "Read trajectory", "Multi-year direction rather than the latest print."),
    ],
    needs: ["public-filings", "market-data"],
    handsTo: ["thesis", "red-flag"],
    humanGate: false,
  },
  {
    id: "thesis",
    name: "Thesis",
    workstream: "screening",
    role: "Write what has to be true",
    why: "An unwritten thesis cannot be falsified, so diligence drifts into gathering facts nobody will act on. Writing it first turns the rest of the process into a set of tests with pass conditions.",
    skills: [
      s("value-drivers", "Name the drivers", "The two or three variables the return depends on."),
      s("must-be-true", "State must-be-trues", "Conditions that would have to hold for the case to work."),
      s("kill-questions", "Set kill questions", "The findings that would end the process."),
    ],
    needs: ["prior-findings"],
    handsTo: ["market", "revenue-quality"],
    humanGate: true,
  },
  {
    id: "red-flag",
    name: "Red flag",
    workstream: "screening",
    role: "Surface early disqualifiers",
    why: "Certain findings should stop a process on day one. Restatements, auditor changes, going-concern language and litigation clusters are cheap to check and expensive to discover after an exclusivity payment.",
    skills: [
      s("restatement", "Detect restatements", "Compare filed values across versions for quiet revisions."),
      s("filing-cadence", "Check filing cadence", "Late or amended filings as a control-environment signal."),
      s("event-scan", "Scan current reports", "Material event filings in the recent window."),
      s("concentration", "Flag concentration", "Single-customer, single-market or single-person dependency."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["thesis", "litigation"],
    humanGate: false,
  },
  {
    id: "strategic-fit",
    name: "Fit",
    workstream: "screening",
    role: "Assess fit with the existing portfolio",
    why: "A good company can still be a poor holding. Overlap, conflict and correlation with what is already owned change the answer without changing the target.",
    skills: [
      s("overlap", "Map overlap", "Where the subject competes with or complements current holdings."),
      s("correlation", "Test correlation", "Whether the subject rises and falls with the existing book."),
      s("capability", "Check capability", "Whether the firm can actually help this company."),
    ],
    needs: ["market-data", "prior-findings"],
    handsTo: ["thesis"],
    humanGate: false,
  },

  /* ---------------- 02 Commercial ---------------- */
  {
    id: "market",
    name: "Market",
    workstream: "commercial",
    role: "Size the market and its direction",
    why: "Growth attributed to the company is often growth in the market. Separating the two is the difference between backing an operator and backing a tide.",
    skills: [
      s("size-market", "Size the market", "Establish the addressable base from public sources."),
      s("growth-decomp", "Decompose growth", "Split market growth from share gain."),
      s("cycle", "Locate the cycle", "Where the sector sits in its spending cycle."),
    ],
    needs: ["market-data", "verified-news", "public-filings"],
    handsTo: ["competitor", "growth-drivers"],
    humanGate: false,
  },
  {
    id: "industry",
    name: "Industry",
    workstream: "commercial",
    role: "Map structure and profit pools",
    why: "Structure sets the ceiling on margin. A well-run company in a badly structured industry converges to the industry, not to its own history.",
    skills: [
      s("structure", "Map structure", "Concentration, entry barriers and buyer power."),
      s("profit-pool", "Locate profit", "Which layer of the chain captures the margin."),
      s("disruption", "Test disruption", "Technology or regulation shifting the structure."),
    ],
    needs: ["market-data", "verified-news"],
    handsTo: ["competitor"],
    humanGate: false,
  },
  {
    id: "competitor",
    name: "Competitor",
    workstream: "commercial",
    role: "Benchmark against the peer set",
    why: "Absolute performance is uninformative. A 12 percent margin is strong or weak only against the set of companies solving the same problem with the same cost base.",
    skills: [
      s("peer-set", "Build the peer set", "Select genuine comparables rather than sector members."),
      s("relative", "Compare relative", "Growth, margin and intensity against the set."),
      s("share-shift", "Track share", "Direction of relative position over time."),
    ],
    needs: ["public-filings", "market-data"],
    handsTo: ["growth-drivers", "valuation"],
    humanGate: false,
  },
  {
    id: "customer",
    name: "Customer",
    workstream: "commercial",
    role: "Test the revenue base",
    why: "Revenue quality is decided by who pays and how repeatably. A concentrated base with short contracts is a different asset from a diversified one on multi-year terms, at the same revenue.",
    skills: [
      s("concentration-band", "Band concentration", "Distribution of revenue across the customer base."),
      s("retention", "Read retention", "Churn and expansion where disclosed."),
      s("contract-shape", "Read contract shape", "Term, renewal and pricing mechanics."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["revenue-quality"],
    humanGate: false,
  },
  {
    id: "growth-drivers",
    name: "Growth",
    workstream: "commercial",
    role: "Attribute growth to its causes",
    why: "Growth from price, from volume, from currency and from acquisition are worth different multiples and carry different durability. Reporting them as one number hides the entire question.",
    skills: [
      s("price-volume", "Split price and volume", "Separate rate from quantity where disclosed."),
      s("currency", "Strip currency", "Constant currency against reported."),
      s("organic", "Isolate organic", "Remove acquired contribution."),
    ],
    needs: ["public-filings", "prior-findings"],
    handsTo: ["revenue-quality", "valuation"],
    humanGate: false,
  },

  /* ---------------- 03 Financial ---------------- */
  {
    id: "revenue-quality",
    name: "Revenue quality",
    workstream: "financial",
    role: "Test whether revenue is real and repeatable",
    why: "Recognition policy, channel loading and one-off contracts can carry a reported line that will not repeat. This is the seat that decides whether the top line is a base or a peak.",
    skills: [
      s("recognition", "Check recognition", "Policy and any change in it across the period."),
      s("repeatability", "Test repeatability", "Recurring against one-off composition."),
      s("cadence", "Read cadence", "Quarter shape and any period-end concentration."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["quality-of-earnings", "margin"],
    humanGate: false,
  },
  {
    id: "margin",
    name: "Margin",
    workstream: "financial",
    role: "Build the margin bridge",
    why: "A margin move is never one thing. Attributing it line by line is what separates a mix effect from a pricing problem, and only one of those is fixable by the buyer.",
    skills: [
      s("bridge", "Bridge the move", "Attribute the change to each cost line in points of revenue."),
      s("capacity-mix", "Test capacity mix", "Owned against bought-in delivery cost."),
      s("operating-leverage", "Measure leverage", "How margin responds to volume."),
    ],
    needs: ["public-filings"],
    handsTo: ["quality-of-earnings"],
    humanGate: false,
  },
  {
    id: "working-capital",
    name: "Working capital",
    workstream: "financial",
    role: "Size the cash tied up in the cycle",
    why: "Working capital is where a deal price goes wrong quietly. A normalised level set from a flattering month transfers real cash from the buyer at completion.",
    skills: [
      s("cycle", "Measure the cycle", "Receivable, payable and inventory days."),
      s("seasonality", "Test seasonality", "Whether the balance date flatters the position."),
      s("normalise", "Normalise the level", "The level a buyer should fund."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["cash-flow", "deal-structure"],
    humanGate: false,
  },
  {
    id: "cash-flow",
    name: "Cash flow",
    workstream: "financial",
    role: "Test conversion from profit to cash",
    why: "Earnings are an opinion until they convert. Persistent conversion below the sector floor is the earliest reliable signal that something in the revenue line is not what it appears.",
    skills: [
      s("conversion", "Measure conversion", "Operating cash flow against reported profit."),
      s("capex", "Split capex", "Maintenance against growth investment."),
      s("free-cash", "Compute free cash", "Cash available after the cost of staying in business."),
    ],
    needs: ["public-filings"],
    handsTo: ["quality-of-earnings", "valuation"],
    humanGate: false,
  },
  {
    id: "quality-of-earnings",
    name: "Quality of earnings",
    workstream: "financial",
    role: "Restate earnings to a defensible base",
    why: "The number the deal is priced on is almost never the number in the accounts. This seat produces the adjusted figure and, more importantly, the list of adjustments somebody has to defend.",
    skills: [
      s("adjustments", "Schedule adjustments", "Non-recurring, owner and pro-forma items."),
      s("run-rate", "Set the run rate", "The base a forward multiple should apply to."),
      s("bridge-reported", "Bridge to reported", "Reconcile adjusted back to filed figures."),
    ],
    needs: ["public-filings", "provided-documents", "prior-findings"],
    handsTo: ["valuation", "adversary"],
    humanGate: true,
  },

  /* ---------------- 04 Operational ---------------- */
  {
    id: "operations",
    name: "Operations",
    workstream: "operational",
    role: "Test delivery capacity against the plan",
    why: "Plans assume capacity that often does not exist. Growth sold but not deliverable shows up as margin erosion two quarters after close.",
    skills: [
      s("capacity", "Measure capacity", "Output per unit of resource and headroom."),
      s("utilisation", "Read utilisation", "Where disclosed, and its trend."),
      s("scalability", "Test scalability", "Cost behaviour as volume rises."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["efficiency"],
    humanGate: false,
  },
  {
    id: "supply-chain",
    name: "Supply chain",
    workstream: "operational",
    role: "Map dependency and single points of failure",
    why: "One sole-sourced input or one geography can hold the entire cost base hostage. This is cheap to find and expensive to discover during a disruption.",
    skills: [
      s("supplier-concentration", "Band suppliers", "Dependency on individual suppliers."),
      s("geography", "Map geography", "Concentration of supply by region."),
      s("input-cost", "Track input cost", "Exposure to traded input prices."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["efficiency", "esg-risk"],
    humanGate: false,
  },
  {
    id: "systems",
    name: "Systems",
    workstream: "operational",
    role: "Assess the process and systems estate",
    why: "Integration cost is set here, not in the model. A fragmented estate is the difference between a twelve month and a thirty month integration, and nobody budgets for the second.",
    skills: [
      s("estate", "Map the estate", "Core systems and their age."),
      s("integration", "Size integration", "Effort to combine with an existing platform."),
      s("control", "Test controls", "Whether the process supports the reported numbers."),
    ],
    needs: ["provided-documents", "public-filings"],
    handsTo: ["technology"],
    humanGate: false,
  },
  {
    id: "technology",
    name: "Technology",
    workstream: "operational",
    role: "Assess the technology position",
    why: "Research intensity and platform age tell you whether the company is buying its next cycle or harvesting the current one. Harvesting is fine if the price reflects it.",
    skills: [
      s("intensity", "Measure intensity", "Research spend against revenue and against peers."),
      s("debt", "Estimate technical debt", "Signals of deferred renewal."),
      s("ai-position", "Read AI position", "Exposure to the current compute and agent cycle."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["efficiency", "valuation"],
    humanGate: false,
  },
  {
    id: "efficiency",
    name: "Efficiency",
    workstream: "operational",
    role: "Measure unit economics",
    why: "Aggregate margin hides whether each unit of work is profitable. Revenue and cost per head is the fastest read on whether scale is helping or hurting.",
    skills: [
      s("per-head", "Compute per head", "Revenue and cost per employee over time."),
      s("productivity", "Track productivity", "Direction of output per unit of input."),
      s("cost-inflation", "Isolate inflation", "Wage and input inflation inside the cost base."),
    ],
    needs: ["public-filings", "prior-findings"],
    handsTo: ["quality-of-earnings"],
    humanGate: false,
  },

  /* ---------------- 05 Legal ---------------- */
  {
    id: "legal-structure",
    name: "Structure",
    workstream: "legal",
    role: "Map the entity and ownership structure",
    why: "What is being bought is a set of entities, not a brand. Structure decides what transfers, what is stranded and what tax falls due on the way through.",
    skills: [
      s("entities", "Map entities", "Group structure and jurisdictions from the register."),
      s("ownership", "Trace ownership", "Holders and control from public filings."),
      s("transfer", "Test transferability", "What moves with the deal and what does not."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["contracts", "tax"],
    humanGate: false,
  },
  {
    id: "contracts",
    name: "Contracts",
    workstream: "legal",
    role: "Read the contracts that carry the revenue",
    why: "Change-of-control, exclusivity and termination clauses can delete the revenue the deal is priced on the day it completes. This is the highest-value reading in the legal workstream.",
    skills: [
      s("change-of-control", "Find change of control", "Clauses triggered by the transaction."),
      s("termination", "Read termination", "Notice, cause and penalty."),
      s("commitments", "Schedule commitments", "Obligations extending past close."),
    ],
    needs: ["provided-documents"],
    handsTo: ["deal-structure"],
    humanGate: true,
  },
  {
    id: "litigation",
    name: "Litigation",
    workstream: "legal",
    role: "Find disputes and size the exposure",
    why: "Disclosed disputes are the visible part. Pattern and frequency say more about the operating culture than any individual case does.",
    skills: [
      s("disclosed", "Read disclosed matters", "Proceedings named in filings."),
      s("pattern", "Read the pattern", "Frequency and type across the record."),
      s("provision", "Test provisions", "Whether recognised amounts look adequate."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["adversary"],
    humanGate: false,
  },
  {
    id: "regulatory",
    name: "Regulatory",
    workstream: "legal",
    role: "Map the regulatory perimeter",
    why: "Regulation sets the cost of doing business and can change it without notice. Export controls, data rules and antitrust are live variables in this sector, not background.",
    skills: [
      s("perimeter", "Map the perimeter", "Which regimes bind the subject."),
      s("change", "Track change", "Pending measures affecting the sector."),
      s("licences", "Check licences", "Permissions the business depends on."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["esg-governance"],
    humanGate: false,
  },
  {
    id: "tax",
    name: "Tax",
    workstream: "legal",
    role: "Read the tax position",
    why: "Effective rate is a forward cost. A rate held down by an expiring incentive is a margin cliff already in the diary.",
    skills: [
      s("effective-rate", "Track effective rate", "Reported rate against statutory across periods."),
      s("incentives", "Find incentives", "Reliefs and their expiry."),
      s("exposure", "Size exposure", "Uncertain positions where disclosed."),
    ],
    needs: ["public-filings"],
    handsTo: ["deal-structure"],
    humanGate: false,
  },

  /* ---------------- 06 People ---------------- */
  {
    id: "management",
    name: "Management",
    workstream: "people",
    role: "Assess the team against the plan",
    why: "The plan is executed by people. A team that delivered a turnaround is not automatically a team that can deliver a scale-up, and the record shows which one this is.",
    skills: [
      s("track-record", "Read the record", "Delivery against prior stated targets."),
      s("tenure", "Measure tenure", "Stability of the senior team."),
      s("gaps", "Find gaps", "Roles the plan requires that are unfilled."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["key-person"],
    humanGate: false,
  },
  {
    id: "org-structure",
    name: "Organisation",
    workstream: "people",
    role: "Read the shape of the organisation",
    why: "Headcount shape decides operating leverage. A pyramid that has inverted carries a cost base that cannot be flexed down when demand turns.",
    skills: [
      s("shape", "Read the shape", "Headcount distribution and its direction."),
      s("span", "Measure span", "Layers and reporting breadth where disclosed."),
      s("location", "Map locations", "Delivery footprint and cost geography."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["efficiency"],
    humanGate: false,
  },
  {
    id: "compensation",
    name: "Compensation",
    workstream: "people",
    role: "Read incentives and what they buy",
    why: "People do what they are paid to do. If the incentive rewards a metric the thesis does not depend on, the plan will not happen regardless of who signs it.",
    skills: [
      s("alignment", "Test alignment", "Whether incentives track the value drivers."),
      s("dilution", "Size dilution", "Equity-based cost against reported earnings."),
      s("retention-cost", "Cost retention", "Spend required to keep the team through the hold."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["deal-structure"],
    humanGate: false,
  },
  {
    id: "culture",
    name: "Culture",
    workstream: "people",
    role: "Read the operating culture from observable evidence",
    why: "Culture is usually asserted and rarely evidenced. Attrition, disputes and the pattern of departures are the parts that leave a record, and those are what this seat reads.",
    skills: [
      s("attrition-read", "Read attrition", "Rate against the headcount direction, not alone."),
      s("signals", "Collect signals", "Observable indicators in the public record."),
      s("integration-risk", "Assess integration risk", "Where culture would obstruct the plan."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["key-person"],
    humanGate: false,
  },
  {
    id: "key-person",
    name: "Key person",
    workstream: "people",
    role: "Identify dependency on individuals",
    why: "In services and technology the asset frequently walks out at six each evening. Naming that dependency changes both the structure and the price.",
    skills: [
      s("identify", "Identify dependency", "Individuals the business relies on."),
      s("lock-in", "Check lock-in", "Contractual retention through the hold."),
      s("succession", "Test succession", "Whether a departure has a plan behind it."),
    ],
    needs: ["public-filings", "provided-documents"],
    handsTo: ["deal-structure", "adversary"],
    humanGate: false,
  },

  /* ---------------- 07 ESG ---------------- */
  {
    id: "esg-risk",
    name: "ESG risk",
    workstream: "esg",
    role: "Identify material ESG exposure",
    why: "The test is materiality, not disclosure volume. A long sustainability report and a real exposure are unrelated, and only the second one costs money.",
    skills: [
      s("materiality", "Screen materiality", "Which factors carry financial consequence here."),
      s("disclosure", "Read disclosure", "What the subject reports and to what standard."),
      s("gap", "Find gaps", "Where absence of disclosure is itself the finding."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["esg-environment", "esg-social", "esg-governance"],
    humanGate: false,
  },
  {
    id: "esg-environment",
    name: "Environment",
    workstream: "esg",
    role: "Size environmental exposure",
    why: "Energy is a first-order cost in compute-heavy and manufacturing businesses. Where the power comes from and what it costs is a margin question before it is a values question.",
    skills: [
      s("intensity", "Measure intensity", "Energy and emissions against output where reported."),
      s("transition", "Assess transition", "Exposure to carbon pricing and energy cost."),
      s("physical", "Assess physical risk", "Asset exposure to climate disruption."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["esg-risk"],
    humanGate: false,
  },
  {
    id: "esg-social",
    name: "Social",
    workstream: "esg",
    role: "Assess workforce and community exposure",
    why: "Labour practice and supply-chain conditions convert into cost through disputes, turnover and lost contracts, particularly for businesses selling to regulated buyers.",
    skills: [
      s("workforce", "Read workforce", "Composition and practice where disclosed."),
      s("supply-labour", "Check supply labour", "Conditions in the supplier base."),
      s("community", "Assess community", "Local exposure around major sites."),
    ],
    needs: ["public-filings", "verified-news"],
    handsTo: ["esg-risk"],
    humanGate: false,
  },
  {
    id: "esg-governance",
    name: "Governance",
    workstream: "esg",
    role: "Test the control environment",
    why: "Governance is the seat that predicts the others. Weak control is why restatements, disputes and misreporting happen, so a finding here upgrades the risk on every workstream.",
    skills: [
      s("board", "Read the board", "Composition and independence."),
      s("controls", "Test controls", "Auditor tenure, changes and reported weaknesses."),
      s("related-party", "Find related parties", "Transactions with connected persons."),
    ],
    needs: ["public-filings"],
    handsTo: ["adversary"],
    humanGate: false,
  },

  /* ---------------- 08 Synthesis ---------------- */
  {
    id: "valuation",
    name: "Valuation",
    workstream: "synthesis",
    role: "Anchor value to comparable evidence",
    why: "A model produces whatever it is asked to. Anchoring to the traded peer set and to the adjusted base is what keeps the answer inside the range a committee will accept.",
    skills: [
      s("comparables", "Build comparables", "Traded peers on consistent measures."),
      s("multiple-base", "Set the base", "Apply the multiple to the adjusted figure, not the reported one."),
      s("sensitivity", "Run sensitivity", "Where the answer breaks."),
    ],
    needs: ["public-filings", "market-data", "prior-findings"],
    handsTo: ["deal-structure", "adversary"],
    humanGate: true,
  },
  {
    id: "deal-structure",
    name: "Structure the deal",
    workstream: "synthesis",
    role: "Convert findings into terms",
    why: "Most diligence findings are not reasons to walk, they are reasons to change the terms. This seat converts each one into the mechanism that covers it.",
    skills: [
      s("price-adjust", "Adjust price", "Findings that move the number."),
      s("protection", "Design protection", "Indemnity, escrow and earn-out against specific risks."),
      s("conditions", "Set conditions", "What must complete before signing."),
    ],
    needs: ["prior-findings"],
    handsTo: ["memo"],
    humanGate: true,
  },
  {
    id: "consistency",
    name: "Consistency",
    workstream: "synthesis",
    role: "Cross-check every figure against its source",
    why: "This is the seat that catches the number written two different ways in the same document. It is unglamorous and it is the reason the paper survives contact with a committee.",
    skills: [
      s("cross-check", "Cross-check figures", "Every stated figure against the underlying record."),
      s("unit-check", "Check units", "Currency, scale and period consistency."),
      s("restate-check", "Check restatements", "Whether a figure changed between workstreams."),
    ],
    needs: ["prior-findings"],
    handsTo: ["memo"],
    humanGate: false,
  },
  {
    id: "adversary",
    name: "Adversary",
    workstream: "synthesis",
    role: "Attack the case before anyone else does",
    why: "A process that only gathers supporting evidence will always recommend proceeding. This seat argues the other side on purpose, so the weakest point is found internally rather than by a counterparty.",
    skills: [
      s("refute", "Refute the thesis", "Build the case for passing."),
      s("stress", "Stress the assumptions", "Which assumption breaks the return."),
      s("unsupported", "Find unsupported claims", "Assertions carrying no evidence."),
      s("dissent", "Record dissent", "Put the counter-case in the paper."),
    ],
    needs: ["prior-findings"],
    handsTo: ["memo"],
    humanGate: false,
  },
  {
    id: "memo",
    name: "Memo",
    workstream: "synthesis",
    role: "Draft the committee paper",
    why: "Written from the reconciled record rather than from recollection, so the paper and the evidence cannot drift apart between draft and meeting.",
    skills: [
      s("draft", "Draft the paper", "Recommendation, case, risks and open items."),
      s("open-items", "Schedule open items", "What remains unresolved and who owns it."),
      s("evidence-index", "Index the evidence", "Every claim mapped to its source."),
    ],
    needs: ["prior-findings"],
    handsTo: [],
    humanGate: true,
  },

  /* ---------------- 09 Monitoring ---------------- */
  {
    id: "kpi-intake",
    name: "KPI intake",
    workstream: "monitoring",
    role: "Normalise whatever each company actually sent",
    why: "Fourteen companies report in fourteen formats. Rekeying is where the quarter is lost and where errors enter, and it is entirely mechanical work.",
    skills: [
      s("ingest", "Ingest any format", "Read decks, spreadsheets and prose into one schema."),
      s("map", "Map to schema", "Reconcile varied labels to one line-item set."),
      s("completeness", "Check completeness", "Name what did not arrive."),
    ],
    needs: ["provided-documents"],
    handsTo: ["reconcile"],
    humanGate: false,
  },
  {
    id: "reconcile",
    name: "Reconcile",
    workstream: "monitoring",
    role: "Tie this period to the last and flag every restatement",
    why: "Quiet restatements are the ones that matter. A prior-period figure that changed without comment is the single most informative event in a reporting pack.",
    skills: [
      s("tie-out", "Tie out", "Match current against prior across every line."),
      s("restatement", "Flag restatements", "Any prior value that moved, including small ones."),
      s("variance", "Explain variance", "Attribute movement to a cause or mark it unexplained."),
    ],
    needs: ["provided-documents", "prior-findings"],
    handsTo: ["runway", "valuation-movement"],
    humanGate: false,
  },
  {
    id: "runway",
    name: "Runway",
    workstream: "monitoring",
    role: "Recompute runway from actuals and fire on thresholds",
    why: "A bridge conversation at eleven months of runway is a negotiation. At seven it is a rescue. Same company, same facts, different price. This seat exists to move the conversation earlier.",
    skills: [
      s("burn", "Recompute burn", "From actuals rather than the last plan."),
      s("months", "Compute months", "Runway at current and at stressed burn."),
      s("threshold", "Fire thresholds", "Alert at the level set, not at period end."),
    ],
    needs: ["provided-documents", "prior-findings"],
    handsTo: ["flag"],
    humanGate: false,
  },
  {
    id: "valuation-movement",
    name: "Mark movement",
    workstream: "monitoring",
    role: "Explain every mark or state that it cannot be explained",
    why: "An unexplained mark is an audit finding waiting to happen. Saying plainly that a movement cannot be explained is a valid and far safer output than constructing a reason.",
    skills: [
      s("attribute", "Attribute the move", "Trading, performance or method."),
      s("evidence", "Attach evidence", "The comparable or event behind the mark."),
      s("unexplained", "Declare unexplained", "State it rather than reverse-engineer a story."),
    ],
    needs: ["market-data", "provided-documents", "prior-findings"],
    handsTo: ["flag"],
    humanGate: true,
  },
  {
    id: "flag",
    name: "Flag",
    workstream: "monitoring",
    role: "Set status and name the specific trigger",
    why: "On track, watch or at risk is only useful when the trigger is named. A status without a trigger cannot be argued with, actioned or cleared.",
    skills: [
      s("status", "Set status", "On track, watch or at risk."),
      s("trigger", "Name the trigger", "The specific breach behind the status."),
      s("escalate", "Escalate", "Route to the owner with the deadline attached."),
    ],
    needs: ["prior-findings"],
    handsTo: ["letter"],
    humanGate: true,
  },
  {
    id: "letter",
    name: "Letter",
    workstream: "monitoring",
    role: "Draft the investor letter from reconciled numbers",
    why: "Written from the tied-out record rather than from memory. The letter is the receipt for the monitoring process, not the process itself.",
    skills: [
      s("draft-letter", "Draft", "Compose from reconciled figures only."),
      s("position", "State positions", "Holding-level performance and status."),
      s("consistency-hook", "Hand to consistency", "Pass to the checking seat before release."),
    ],
    needs: ["prior-findings"],
    handsTo: ["consistency"],
    humanGate: true,
  },
];

export const AGENT_COUNT = AGENTS.length;

export function getAgent(id: string): AgentDef | null {
  return AGENTS.find((a) => a.id === id) ?? null;
}

export function agentsIn(workstream: WorkstreamId): AgentDef[] {
  return AGENTS.filter((a) => a.workstream === workstream);
}

export function getWorkstream(id: string): Workstream | null {
  return WORKSTREAMS.find((w) => w.id === id) ?? null;
}
