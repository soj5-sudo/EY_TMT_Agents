/**
 * The latest earnings call each company published on its own investor site.
 *
 * Management commentary comes from the call itself, not from a summary of it.
 * Every quote below was searched for in the transcript at the URL on the row
 * and found there; anything that could not be found was dropped.
 *
 * Refresh with: node --experimental-strip-types scripts/write-calls.mts
 */

export interface CallQuote {
  speaker: string;
  role: string;
  text: string;
  topic: string;
}

export interface EarningsCall {
  symbol: string;
  name: string;
  /** The quarter the call covered, in the company's own words. */
  quarter: string;
  callDate: string;
  transcriptUrl: string;
  transcriptTitle: string;
  audioUrl: string;
  quotes: CallQuote[];
  verification: string;
}

export const IR_CALLS_TAKEN = "2026-08-08T05:08:17.565Z";

export const IR_CALLS: EarningsCall[] = [
 {
  "symbol": "COFORGE.NS",
  "name": "Coforge",
  "quarter": "Q1FY27",
  "callDate": "2026-07-28",
  "transcriptUrl": "https://investors.coforge.com/hubfs/Coforge_Q1FY27%20Earnings%20Conference%20Call%20Transcript.pdf",
  "transcriptTitle": "COFORGE LIMITED EARNINGS CONFERENCE CALL Q1FY27 - Tuesday, July 28, 2026",
  "audioUrl": "https://investors.coforge.com/hubfs/Coforge-Audio-Recording-July28-2026.mp3",
  "quotes": [
   {
    "speaker": "Sudhir Singh",
    "role": "Chief Executive Officer and Executive Director",
    "text": "As we had shared last time, for Coforge the demand tailwind is structural and pure.",
    "topic": "demand"
   },
   {
    "speaker": "Saurabh Goel",
    "role": "Chief Financial Officer",
    "text": "Q1 FY27 reported revenue stood at $592.2 million, including two months of contribution from Encora which was $100.7 million.",
    "topic": "revenue"
   },
   {
    "speaker": "Saurabh Goel",
    "role": "Chief Financial Officer",
    "text": "Based on the progress achieved to date, we remain confident of not only delivering but surpassing the 15.5% consolidated EBIT margin guidance shared in the last earnings call for FY27.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "HAPPSTMNDS.NS",
  "name": "Happiest Minds",
  "quarter": "Q1 FY27",
  "callDate": "2026-07-28",
  "transcriptUrl": "https://www.happiestminds.com/investors/Earnings%20Call/2026-2027-Q1/EarningsCallTranscirpt30072026.pdf",
  "transcriptTitle": "Happiest Minds Technologies Limited Q1 FY27 Earnings Conference Call",
  "audioUrl": "",
  "quotes": [
   {
    "speaker": "Joseph Anantharaju",
    "role": "Co-Chairman and Chief Executive Officer",
    "text": "The demand environment remains mixed with discretionary spending continuing to be selective.",
    "topic": "demand"
   },
   {
    "speaker": "Venkatraman Narayanan",
    "role": "Managing Director",
    "text": "Operating revenues for the quarter stood at INR629 crores, representing a growth of 4% sequentially and 14.3% year-over-year.",
    "topic": "revenue"
   },
   {
    "speaker": "Joseph Anantharaju",
    "role": "Co-Chairman and Chief Executive Officer",
    "text": "We also maintained a healthy EBITDA margin of 21.7% while continuing to invest meaningfully in AI capabilities, enterprise platforms, talent, and go-to-market initiatives that will support our long-term growth.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "HCLTECH.NS",
  "name": "HCL Tech",
  "quarter": "Q1 FY27",
  "callDate": "2026-07-13",
  "transcriptUrl": "https://www.hcltech.com/sites/default/files/documents/investor-reports/HCLTech-Earnings-Q1-FY27-Transcript.pdf",
  "transcriptTitle": "HCL Technologies Limited Q1 FY'27 Earnings Conference Call",
  "audioUrl": "https://www.hcltech.com/sites/default/files/2026-07/10044443.mp3",
  "quotes": [
   {
    "speaker": "C. Vijayakumar",
    "role": "Chief Executive Officer & Managing Director",
    "text": "Looking at the broader market trends, we are seeing a clear divergence across different segments of the AI landscape.",
    "topic": "demand"
   },
   {
    "speaker": "C. Vijayakumar",
    "role": "Chief Executive Officer & Managing Director",
    "text": "Our net new TCV booking for the quarter was $2.4 billion, highest ever Q1 bookings.",
    "topic": "deals"
   },
   {
    "speaker": "Shiv Walia",
    "role": "Chief Financial Officer",
    "text": "Adjusting for restructuring expenses of 62 basis points during the quarter, our Q1 EBIT margins are 17.5% compared with 17.7% in the previous quarter.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "LTIM.NS",
  "name": "LTIMindtree",
  "quarter": "Q1 FY2027",
  "callDate": "2026-07-11",
  "transcriptUrl": "https://www.ltm.com/content/dam/ltimcorporatewebsite/uploads/investors/2026/07/earnings-call-transcript-q1fy27.pdf",
  "transcriptTitle": "Transcript of LTM Limited Q1 FY2027 Earnings Call",
  "audioUrl": "https://www.ltm.com/content/dam/ltimcorporatewebsite/uploads/investors/2026/07/earnings-call-audio-recording-q1fy27.mp3",
  "quotes": [
   {
    "speaker": "Vipul Chandra",
    "role": "Chief Financial Officer & Whole-Time Director",
    "text": "Our EBIT margin expanded by 40 basis points sequentially to 15.5%, primarily driven by operational efficiencies from the New Horizons program, in addition to Forex benefits.",
    "topic": "margin"
   },
   {
    "speaker": "Venu Lambu",
    "role": "Chief Executive Officer & Managing Director",
    "text": "Taken together, the order book, the AI proof points, and the completion of this client transition gives us confidence that our growth will accelerate through Q2 and into the second half alongside further expansion of the margins.",
    "topic": "outlook"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "MASTEK.NS",
  "name": "Mastek",
  "quarter": "Q1FY27",
  "callDate": "2026-07-22",
  "transcriptUrl": "https://www.mastek.com/wp-content/uploads/2026/07/Transcript-Q1FY27-Earnings-Call-Mastek.pdf",
  "transcriptTitle": "Mastek Limited Q1FY27 Earnings Conference Call",
  "audioUrl": "https://www.mastek.com/wp-content/uploads/2026/07/Analyst-Call-Q1FY27.mp3",
  "quotes": [
   {
    "speaker": "Umang Nahata",
    "role": "Chief Executive Officer",
    "text": "In this quarter, we continue to see good demand in new AI-led deals, and we had 40-plus new opportunities that we've closed in the current quarter, which were backed on AI-led initiatives.",
    "topic": "demand"
   },
   {
    "speaker": "Umang Nahata",
    "role": "Chief Executive Officer",
    "text": "North America again saw a strong order book performance for the third consecutive quarter led by a $25 million AI transformation deal in Salesforce Agent force, which is one of our largest deals in the recent quarters.",
    "topic": "deals"
   },
   {
    "speaker": "Deepak Kedia",
    "role": "Chief Financial Officer",
    "text": "In rupee terms, we reported revenue of INR 985 crore, a sequential growth of 5% and a Y-on-Y growth of 7.7%.",
    "topic": "revenue"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "MPHASIS.NS",
  "name": "Mphasis",
  "quarter": "Q1 FY 2027",
  "callDate": "2026-07-24",
  "transcriptUrl": "https://www.mphasis.com/content/dam/mphasis-com/global/en/investors/financial-results/2027/transcript-of-earnings-call-q1-2027.pdf",
  "transcriptTitle": "Mphasis Limited Q1 FY 2027 Earnings Conference Call",
  "audioUrl": "https://event.choruscall.com/mediaframe/webcast.html?webcastid=nVTr8iJK",
  "quotes": [
   {
    "speaker": "Nitin Rakesh",
    "role": "Chief Executive Officer",
    "text": "Q1 FY27 revenue came in at $471 million, growing 2.1% sequentially and 8.3% YoY in constant currency terms.",
    "topic": "revenue"
   },
   {
    "speaker": "Nitin Rakesh",
    "role": "Chief Executive Officer",
    "text": "Net new TCV for Q1 was $461 million - the fifth consecutive quarter above $400 million.",
    "topic": "deals"
   },
   {
    "speaker": "Aravind Viswanathan",
    "role": "Chief Financial Officer",
    "text": "The other big thing, Vibhor, that contributed was a steep drop in utilization, which is kind of more in anticipation of the growth trajectory that we've been talking about.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "PERSISTENT.NS",
  "name": "Persistent Systems",
  "quarter": "Q1 FY27",
  "callDate": "2026-08-03",
  "transcriptUrl": "https://www.persistent.com/wp-content/uploads/2026/08/Analyst-Call-Transcript-Q1FY27.pdf",
  "transcriptTitle": "Persistent Systems Earnings Conference Call, First Quarter, FY27 Ended June 30, 2026",
  "audioUrl": "https://www.persistent.com/wp-content/uploads/2026/08/Analyst-Call-Audio-Recording-Q1FY27.mp3",
  "quotes": [
   {
    "speaker": "Sandeep Kalra",
    "role": "Executive Director and Chief Executive Officer",
    "text": "We achieved a healthy revenue growth of 3.8%, quarter-on-quarter and 16.1% year-on-year, delivering US$452.4 million in Q1 FY27.",
    "topic": "revenue"
   },
   {
    "speaker": "Sandeep Kalra",
    "role": "Executive Director and Chief Executive Officer",
    "text": "The total contract value for the quarter stood at US$1.146 billion, with total contract value of new bookings coming in at US$952.2 million.",
    "topic": "deals"
   },
   {
    "speaker": "Vinit Teredesai",
    "role": "Executive Director and Chief Financial Officer",
    "text": "All these headwinds and tailwinds put together have resulted in a decline of 30 basis points in our EBIT margin on a quarter-on-quarter basis.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "TCS.NS",
  "name": "TCS",
  "quarter": "Q1 FY2027",
  "callDate": "2026-07-09",
  "transcriptUrl": "https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/2026-27/q1/Management%20Commentary/Transcript%20of%20the%20Q1%202026-27%20Earnings%20Conference%20Call%20held%20on%20Jul%209,%202026.pdf",
  "transcriptTitle": "Transcript of the Q1 2026-27 Earnings Conference Call held on Jul 9, 2026",
  "audioUrl": "",
  "quotes": [
   {
    "speaker": "Samir Seksaria",
    "role": "Chief Financial Officer",
    "text": "Operating margin for the quarter was 24%, declining 130 bps sequentially.",
    "topic": "margin"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "TECHM.NS",
  "name": "Tech Mahindra",
  "quarter": "Q1 FY27",
  "callDate": "2026-07-16",
  "transcriptUrl": "https://insights.techmahindra.com/investors/tml-q1-fy-27-earnings-transcript.pdf",
  "transcriptTitle": "Tech Mahindra Limited Q1 FY27 Earnings Conference Call",
  "audioUrl": "https://insights.techmahindra.com/investors/earnings-call-q1fy27.mp3",
  "quotes": [
   {
    "speaker": "Rohit Anand",
    "role": "Chief Financial Officer",
    "text": "In Q1, we reported revenues at USD1,660 million, representing a 2.2% quarter-on-quarter growth and a 6.1% Y-o-Y growth on a reported basis.",
    "topic": "revenue"
   },
   {
    "speaker": "Atul Soneja",
    "role": "Chief Operating Officer",
    "text": "Clients are looking for agentic workflows, AI-native engineering, autonomous operations, AI-led modernization, responsible AI, model governance, and better control over AI consumption and cost.",
    "topic": "demand"
   },
   {
    "speaker": "Mohit Joshi",
    "role": "Chief Executive Officer and Managing Director",
    "text": "These wins were broad-based across key verticals and geographies, with the largest deal wins coming from manufacturing and HLS verticals.",
    "topic": "deals"
   }
  ],
  "verification": "found in the transcript"
 },
 {
  "symbol": "WIT",
  "name": "Wipro",
  "quarter": "Q1 FY '27",
  "callDate": "2026-07-16",
  "transcriptUrl": "https://www.wipro.com/content/dam/nexus/en/investor/quarterly-results/2026-2027/q1fy27/q1fy27-earnings-transcript.pdf",
  "transcriptTitle": "Wipro Limited Q1 FY '27 Earnings Conference Call",
  "audioUrl": "",
  "quotes": [
   {
    "speaker": "Srini Pallia",
    "role": "Chief Executive Officer and Managing Director",
    "text": "Clients continue to invest in AI, data, cloud, modernization, cybersecurity, and productivity-led transformation.",
    "topic": "demand"
   },
   {
    "speaker": "Aparna Iyer",
    "role": "Chief Financial Officer",
    "text": "Our IT services revenues grew 0.9% year-on-year in constant currency while declining 1.2% sequentially.",
    "topic": "revenue"
   },
   {
    "speaker": "Srini Pallia",
    "role": "Chief Executive Officer and Managing Director",
    "text": "During the quarter, order booking totaled $3.4 billion and large deal bookings totaled $1.6 billion.",
    "topic": "deals"
   }
  ],
  "verification": "found in the transcript"
 }
];


const INDEX = new Map<string, EarningsCall>();
for (const call of IR_CALLS) {
  INDEX.set(call.symbol, call);
  INDEX.set(call.name.toLowerCase(), call);
}

export function callFor(nameOrSymbol: string): EarningsCall | null {
  const k = nameOrSymbol.trim();
  return INDEX.get(k) ?? INDEX.get(k.toLowerCase()) ?? null;
}
