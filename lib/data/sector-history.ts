export interface CohortSeries {
  cohort: string;
  values: Array<number | null>;
}

export interface HistorySet {
  id: string;
  title: string;
  unit: "%" | "bps" | "count" | "thousands";
  periods: string[];
  series: CohortSeries[];
  note: string;
  source: string;
}

export const HISTORY_SOURCE =
  "IT services sector, quarterly key trends as of December 2024, published March 2025";

const Q_DEC19_DEC24 = [
  "Dec-19", "Mar-20", "Jun-20", "Sep-20", "Dec-20", "Mar-21", "Jun-21", "Sep-21",
  "Dec-21", "Mar-22", "Jun-22", "Sep-22", "Dec-22", "Mar-23", "Jun-23", "Sep-23",
  "Dec-23", "Mar-24", "Jun-24", "Sep-24", "Dec-24",
];

const Q_DEC20_DEC24 = [
  "Dec-20", "Mar-21", "Jun-21", "Sep-21", "Dec-21", "Mar-22", "Jun-22", "Sep-22",
  "Dec-22", "Mar-23", "Jun-23", "Sep-23", "Dec-23", "Mar-24", "Jun-24", "Sep-24",
  "Dec-24",
];

const FY_Q3FY21_Q3FY25 = [
  "Q3FY21", "Q4FY21", "Q1FY22", "Q2FY22", "Q3FY22", "Q4FY22", "Q1FY23", "Q2FY23",
  "Q3FY23", "Q4FY23", "Q1FY24", "Q2FY24", "Q3FY24", "Q4FY24", "Q1FY25", "Q2FY25",
  "Q3FY25",
];

const Q_MAR22_DEC24 = [
  "Mar-22", "Jun-22", "Sep-22", "Dec-22", "Mar-23", "Jun-23", "Sep-23", "Dec-23",
  "Mar-24", "Jun-24", "Sep-24", "Dec-24",
];

const Q_DEC21_DEC24 = [
  "Dec-21", "Mar-22", "Jun-22", "Sep-22", "Dec-22", "Mar-23", "Jun-23", "Sep-23",
  "Dec-23", "Mar-24", "Jun-24", "Sep-24", "Dec-24",
];

export const HISTORY: HistorySet[] = [
  {
    id: "cc-growth-tier1",
    title: "Constant currency revenue growth, tier-1",
    unit: "%",
    periods: Q_DEC19_DEC24,
    series: [
      {
        cohort: "Indian tier-1",
        values: [8.7, 5.8, -2.6, -1.4, 1.3, 5.0, 15.9, 17.3, 18.7, 18.2, 17.6, 16.1, 13.0, 9.3, 4.8, 1.1, -0.2, 1.3, 2.5, 3.7, 3.9],
      },
      {
        cohort: "Global tier-1",
        values: [4.9, 2.4, 0.0, 0.8, -1.3, 3.2, 10.9, 10.8, 16.3, 16.5, 17.5, 13.9, 7.0, 5.5, 2.3, 3.0, 2.2, 0.5, 0.6, 2.0, 4.7],
      },
      {
        cohort: "Indian tier-1 excluding Tech M and Wipro",
        values: [9.7, 6.3, -2.3, -0.9, 2.4, 6.3, 15.5, 15.6, 17.2, 16.0, 17.3, 16.5, 13.5, 10.1, 6.0, 2.8, 1.4, 3.4, 4.1, 5.0, 4.9],
      },
    ],
    note:
      "Weighted average year on year, on CY24 revenue as the weight. Indian tier-1 covers TCS, Infosys, Wipro, HCL Tech and Tech Mahindra. Global tier-1 covers IBM, DXC, Capgemini, Cognizant, Accenture and CGI.",
    source: HISTORY_SOURCE,
  },
  {
    id: "cc-growth-midtier",
    title: "Constant currency revenue growth, mid-tier",
    unit: "%",
    periods: Q_DEC19_DEC24,
    series: [
      {
        cohort: "Indian mid-tier",
        values: [4.6, 4.3, 0.2, 1.4, 1.3, 1.6, 6.4, 17.2, 27.8, 27.3, 23.2, 16.2, 14.1, 10.7, 6.0, 2.4, 2.4, 3.0, 4.6, 9.8, 11.8],
      },
      {
        cohort: "Global mid-tier",
        values: [25.5, 25.8, 14.4, 12.7, 16.0, 23.1, 43.3, 50.7, 54.0, 50.7, 40.2, 33.4, 20.5, 9.0, 3.2, -0.3, -0.8, 0.1, 3.5, 5.5, 8.7],
      },
    ],
    note:
      "Indian mid-tier covers LTIMindtree, Mphasis, Coforge, Zensar, Hexaware and Happiest Minds. Global mid-tier covers EPAM, Globant, Endava, Netcompany and Thoughtworks.",
    source: HISTORY_SOURCE,
  },
  {
    id: "attrition",
    title: "Attrition, tier-1",
    unit: "%",
    periods: FY_Q3FY21_Q3FY25,
    series: [
      {
        cohort: "Indian tier-1",
        values: [10.2, 11.5, 13.4, 17.8, 21.5, 22.9, 23.5, 23.1, 21.1, 19.0, 16.3, 14.0, 12.6, 12.3, 12.3, 12.7, 13.2],
      },
      {
        cohort: "Global tier-1",
        values: [13.6, 15.3, 21.2, 25.2, 25.0, 25.0, 27.5, 27.2, 21.3, 19.3, 17.9, 16.3, 13.8, 14.0, 14.3, 14.7, 14.5],
      },
    ],
    note:
      "Indian tier-1 covers Infosys, Wipro, TCS, HCL and Tech Mahindra. Global tier-1 covers Capgemini, Cognizant and Accenture; the rest of that universe does not publish attrition.",
    source: HISTORY_SOURCE,
  },
  {
    id: "net-adds",
    title: "Net headcount addition, tier-1",
    unit: "thousands",
    periods: Q_DEC20_DEC24,
    series: [
      {
        cohort: "Indian tier-1",
        values: [34, 46, 54, 70, 64, 86, 60, 34, -4, -5, -22, -18, -17, -12, -2, 14, -3],
      },
      {
        cohort: "Global tier-1",
        values: [20, 34, 182, 95, 84, 54, 23, 26, 20, -9, -24, -8, -3, -11, -5, 19, 18],
      },
    ],
    note:
      "Indian tier-1 covers TCS, Infosys, Wipro, HCL and Tech Mahindra. Global tier-1 covers DXC, Capgemini, Cognizant, Atos and Accenture.",
    source: HISTORY_SOURCE,
  },
  {
    id: "clients-tier1",
    title: "Clients by deal band, Indian tier-1",
    unit: "count",
    periods: Q_MAR22_DEC24,
    series: [
      {
        cohort: "Under 50 million dollars",
        values: [7758, 7961, 8099, 8243, 8341, 8471, 8528, 8486, 8478, 8495, 8494, 8466],
      },
      {
        cohort: "50 million dollars and above",
        values: [329, 338, 347, 359, 360, 369, 371, 371, 368, 368, 371, 373],
      },
      {
        cohort: "100 million dollars and above",
        values: [131, 125, 134, 133, 138, 139, 142, 143, 146, 147, 150, 145],
      },
    ],
    note: "Sum across Infosys, Wipro, TCS, HCL and Tech Mahindra.",
    source: HISTORY_SOURCE,
  },
  {
    id: "clients-midtier",
    title: "Clients by deal band, Indian mid-tier",
    unit: "count",
    periods: Q_MAR22_DEC24,
    series: [
      {
        cohort: "Under 50 million dollars",
        values: [1161, 1208, 1257, 1289, 1324, 1352, 1366, 1395, 1419, 1423, 1508, 1523],
      },
      {
        cohort: "50 million dollars and above",
        values: [23, 23, 24, 23, 25, 24, 24, 21, 22, 25, 25, 27],
      },
      {
        cohort: "100 million dollars and above",
        values: [6, 9, 11, 10, 10, 9, 9, 9, 9, 9, 8, 8],
      },
    ],
    note:
      "Sum across LTIMindtree, Mphasis, Coforge, Persistent Systems, Zensar and Happiest Minds.",
    source: HISTORY_SOURCE,
  },
];

export interface MarginRow {
  company: string;
  cohort: "Indian tier-1" | "Global tier-1";
  values: Array<number | null>;
}

export const MARGIN_PERIODS = Q_DEC21_DEC24;

export const MARGIN_MATRIX: MarginRow[] = [
  { company: "TCS", cohort: "Indian tier-1", values: [25.0, 25.0, 23.1, 24.0, 24.5, 24.5, 23.2, 24.3, 25.0, 24.6, 24.7, 24.1, 24.5] },
  { company: "Infosys", cohort: "Indian tier-1", values: [23.5, 21.5, 20.0, 21.5, 21.5, 21.0, 20.8, 21.2, 20.5, 20.1, 21.1, 21.1, 21.3] },
  { company: "HCL Tech", cohort: "Indian tier-1", values: [19.0, 17.9, 17.0, 18.0, 19.6, 18.1, 17.0, 18.5, 19.8, 17.6, 17.1, 18.6, 19.5] },
  { company: "Wipro", cohort: "Indian tier-1", values: [17.6, 17.0, 15.0, 15.1, 16.3, 16.3, 16.0, 16.1, 16.0, 16.0, 16.5, 16.7, 17.5] },
  { company: "Tech Mahindra", cohort: "Indian tier-1", values: [14.8, 13.2, 11.0, 11.4, 12.0, 11.2, 6.8, 4.7, 5.4, 7.4, 8.5, 9.6, 10.2] },
  { company: "IBM", cohort: "Global tier-1", values: [17.2, 4.4, 11.1, -31.9, 19.8, 7.4, 12.9, 12.7, 21.6, 7.4, 14.1, -5.4, 18.8] },
  { company: "DXC", cohort: "Global tier-1", values: [8.7, 8.5, 7.0, 7.5, 8.7, 8.9, 6.5, 7.3, 7.6, 8.4, 6.9, 8.6, 8.9] },
  { company: "Cognizant", cohort: "Global tier-1", values: [15.3, 15.0, 15.5, 16.4, 14.2, 14.6, 14.2, 15.5, 16.1, 15.1, 15.2, 15.3, 15.7] },
  { company: "CGI", cohort: "Global tier-1", values: [16.9, 16.0, 16.0, 16.1, 16.1, 16.2, 16.1, 16.3, 16.2, 16.8, 16.4, 16.4, 16.2] },
  { company: "NTT Data", cohort: "Global tier-1", values: [9.11, 6.46, 8.49, 7.23, 7.3, 6.98, 5.7, 6.0, 3.6, 9.4, 5.3, 8.3, 3.8] },
  { company: "Accenture", cohort: "Global tier-1", values: [16.3, 13.7, 16.1, 14.7, 16.5, 12.3, 14.2, 14.9, 16.7, 13.0, 16.0, 14.3, 16.7] },
];

export const MARGIN_NOTE =
  "EBIT margin by quarter. DXC and Cognizant are adjusted EBIT. IBM and NTT Data swing on portfolio and one off items rather than on trading.";

export interface PerEmployeePoint {
  cohort: string;
  first: number;
  last: number;
}

export const PER_EMPLOYEE: Record<string, { title: string; unit: string; points: PerEmployeePoint[]; note: string }> = {
  revenue: {
    title: "Revenue per employee",
    unit: "US$ thousands per quarter",
    points: [
      { cohort: "Global mid-tier", first: 24.2, last: 24.0 },
      { cohort: "Global tier-1", first: 21.6, last: 22.6 },
      { cohort: "Indian mid-tier", first: 16.2, last: 18.4 },
      { cohort: "Indian tier-1", first: 12.9, last: 13.1 },
    ],
    note:
      "Dec-19 against Dec-24. India sits well below its global peers on revenue per head, and the gap has narrowed only in the mid-tier.",
  },
  sga: {
    title: "SG and A per employee",
    unit: "US$ thousands per quarter",
    points: [
      { cohort: "Global mid-tier", first: 7.2, last: 8.5 },
      { cohort: "Global tier-1", first: 3.0, last: 3.0 },
      { cohort: "Indian mid-tier", first: 3.2, last: 2.9 },
      { cohort: "Indian tier-1", first: 1.7, last: 1.6 },
    ],
    note: "Dec-19 against Dec-24.",
  },
  billable: {
    title: "Revenue per billable employee",
    unit: "US$ thousands per quarter",
    points: [
      { cohort: "Global mid-tier", first: 28.64, last: 26.61 },
      { cohort: "Global tier-1", first: 23.95, last: 25.07 },
      { cohort: "Indian mid-tier", first: 17.09, last: 20.31 },
      { cohort: "Indian tier-1", first: 13.89, last: 13.74 },
    ],
    note:
      "Jun-19 against Dec-24. Where a company does not publish a billable split, ninety percent of headcount is treated as billable.",
  },
};

export interface UtilisationRow {
  company: string;
  cohort: "Indian tier-1" | "Global tier-1";
  latest: number | null;
}

export const UTILISATION: UtilisationRow[] = [
  { company: "Infosys", cohort: "Indian tier-1", latest: 83.4 },
  { company: "Wipro", cohort: "Indian tier-1", latest: 83.5 },
  { company: "Tech Mahindra", cohort: "Indian tier-1", latest: 86.0 },
  { company: "TCS", cohort: "Indian tier-1", latest: null },
  { company: "HCL Tech", cohort: "Indian tier-1", latest: null },
  { company: "Accenture", cohort: "Global tier-1", latest: 92.0 },
  { company: "Cognizant", cohort: "Global tier-1", latest: 83.0 },
  { company: "Capgemini", cohort: "Global tier-1", latest: 72.0 },
];

export const UTILISATION_NOTE =
  "Blended rates as each company reports them, including trainees. The Indian average of 84.3 percent is Infosys, Wipro and Tech Mahindra; the global average of 82.3 percent is Accenture, Capgemini and Cognizant. TCS, HCL, IBM, DXC, Atos, CGI and NTT Data do not disclose utilisation.";

export const HEADCOUNT_YOY = {
  periodLabel: "Dec-24 against Dec-23",
  cohorts: [
    { cohort: "Global mid-tier", value: 9.2 },
    { cohort: "Indian mid-tier", value: 6.6 },
    { cohort: "Global tier-1", value: 1.3 },
    { cohort: "Indian tier-1", value: -0.2 },
  ],
  companies: [
    { company: "GFT Tech", region: "Global", value: 31.9 },
    { company: "EPAM", region: "Global", value: 15.0 },
    { company: "Globant", region: "Global", value: 7.6 },
    { company: "Accenture", region: "Global", value: 7.5 },
    { company: "Cognizant", region: "Global", value: -2.9 },
    { company: "Tietoevry", region: "Global", value: -5.4 },
    { company: "DXC Tech", region: "Global", value: -6.6 },
    { company: "Atos SE", region: "Global", value: -17.9 },
    { company: "Coforge", region: "India", value: 34.6 },
    { company: "Happiest Minds", region: "India", value: 24.5 },
    { company: "LTIMindtree", region: "India", value: 5.2 },
    { company: "Tech Mahindra", region: "India", value: 2.9 },
    { company: "Infosys", region: "India", value: 0.1 },
    { company: "HCL Tech", region: "India", value: -1.7 },
    { company: "Wipro", region: "India", value: -3.1 },
    { company: "Mphasis", region: "India", value: -8.2 },
  ],
};
