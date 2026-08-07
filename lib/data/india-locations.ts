export interface IndiaLocation {
  company: string;
  state: string;
  city: string;
  /** Other names the same company is filed under. */
  aliases?: string[];
}

export const INDIA_LOCATIONS: IndiaLocation[] = [
  { company: "TCS", state: "Maharashtra", city: "Mumbai" },
  { company: "Reliance Industries", state: "Maharashtra", city: "Mumbai" },
  { company: "LTIMindtree", state: "Maharashtra", city: "Mumbai", aliases: ["LTI Mindtree", "LTM Limited"] },
  { company: "L&T Technology Services", state: "Maharashtra", city: "Mumbai", aliases: ["LTTS"] },
  { company: "Mastek", state: "Maharashtra", city: "Mumbai" },
  { company: "Datamatics Global Services Limited", state: "Maharashtra", city: "Mumbai" },
  { company: "Trigyn Technologies", state: "Maharashtra", city: "Mumbai" },
  { company: "WNS", state: "Maharashtra", city: "Mumbai" },
  { company: "Firstsource (RPSG Ventures Limited)", state: "Maharashtra", city: "Mumbai" },
  { company: "CRISIL", state: "Maharashtra", city: "Mumbai" },
  { company: "eClrex", state: "Maharashtra", city: "Mumbai" },
  { company: "Tech Mahindra", state: "Maharashtra", city: "Pune", aliases: ["Tech M"] },
  { company: "Persistent Systems", state: "Maharashtra", city: "Pune" },
  { company: "Zensar", state: "Maharashtra", city: "Pune" },
  { company: "Birlasoft", state: "Maharashtra", city: "Pune" },
  { company: "KPIT Technologies", state: "Maharashtra", city: "Pune" },
  { company: "Accelya Solutions India Ltd", state: "Maharashtra", city: "Pune" },

  { company: "Infosys", state: "Karnataka", city: "Bengaluru" },
  { company: "Wipro", state: "Karnataka", city: "Bengaluru" },
  { company: "Mphasis", state: "Karnataka", city: "Bengaluru" },
  { company: "Sonata Software", state: "Karnataka", city: "Bengaluru" },
  { company: "Happiest Minds", state: "Karnataka", city: "Bengaluru" },
  { company: "Axis Cades", state: "Karnataka", city: "Bengaluru" },
  { company: "Expleo Engineering", state: "Karnataka", city: "Bengaluru" },
  { company: "Sasken Technologies", state: "Karnataka", city: "Bengaluru" },
  { company: "Hinduja Global Solutions", state: "Karnataka", city: "Bengaluru" },

  { company: "HCL Tech", state: "Uttar Pradesh", city: "Noida" },
  { company: "Coforge", state: "Uttar Pradesh", city: "Noida" },
  { company: "R Systems International", state: "Uttar Pradesh", city: "Noida" },
  { company: "Nucleus Software Exports", state: "Uttar Pradesh", city: "Noida" },
  { company: "RateGain", state: "Uttar Pradesh", city: "Noida" },

  { company: "Bharti Airtel", state: "Delhi", city: "New Delhi" },
  { company: "Newgen Software", state: "Delhi", city: "New Delhi" },
  { company: "C.E Infosystem (Mapmyindia)", state: "Delhi", city: "New Delhi" },

  { company: "Cyient", state: "Telangana", city: "Hyderabad" },
  { company: "Kellton Tech Solutions Ltd", state: "Telangana", city: "Hyderabad" },
  { company: "GSS Infotech", state: "Telangana", city: "Hyderabad" },
  { company: "CES Limited", state: "Telangana", city: "Hyderabad" },
  { company: "Xtglobal Infotech", state: "Telangana", city: "Hyderabad" },

  { company: "Saksoft", state: "Tamil Nadu", city: "Chennai" },
  { company: "Intellect Design", state: "Tamil Nadu", city: "Chennai", aliases: ["Intellect Design Arena"] },
  { company: "Latent View", state: "Tamil Nadu", city: "Chennai" },
];

export const INDIA_LOCATION_NOTE =
  "State is the registered office or principal headquarters as filed with the exchanges. It is a fixed attribute; the revenue, margin and headcount shown against each state are the live figures the console computes.";

const NORMALISE = /\s+(limited|ltd|inc|plc|technologies|technology|solutions|systems)\b\.?/gi;

function key(name: string): string {
  return name.toLowerCase().replace(NORMALISE, "").replace(/[^a-z0-9]/g, "");
}

const INDEX = new Map<string, IndiaLocation>();
for (const loc of INDIA_LOCATIONS) {
  INDEX.set(key(loc.company), loc);
  for (const alias of loc.aliases ?? []) INDEX.set(key(alias), loc);
}

/**
 * A shortened name still has to be a long one. Five letters of overlap put
 * Intel in Chennai as Intellect Design, so a prefix has to carry seven.
 */
const MIN_PREFIX = 7;

export function locationFor(name: string): IndiaLocation | null {
  const k = key(name);
  if (!k) return null;
  const exact = INDEX.get(k);
  if (exact) return exact;
  for (const [ik, loc] of INDEX) {
    if (k.length < MIN_PREFIX && ik.length < MIN_PREFIX) continue;
    const shorter = k.length <= ik.length ? k : ik;
    if (shorter.length < MIN_PREFIX) continue;
    if (ik.startsWith(k) || k.startsWith(ik)) return loc;
  }
  return null;
}

export const INDIA_STATES = [...new Set(INDIA_LOCATIONS.map((l) => l.state))].sort();
