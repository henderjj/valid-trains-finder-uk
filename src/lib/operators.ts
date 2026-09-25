// Operator (ATOC) codes used in the timetable, mapped to the names passengers know.
const OPERATORS: Record<string, string> = {
  AW: 'Transport for Wales',
  CC: 'c2c',
  CH: 'Chiltern Railways',
  CS: 'Caledonian Sleeper',
  EM: 'East Midlands Railway',
  ES: 'Eurostar',
  GC: 'Grand Central',
  GN: 'Great Northern',
  GR: 'LNER',
  GW: 'GWR',
  GX: 'Gatwick Express',
  HT: 'Hull Trains',
  HX: 'Heathrow Express',
  IL: 'Island Line',
  LD: 'Lumo',
  LE: 'Greater Anglia',
  LM: 'West Midlands Railway',
  LO: 'London Overground',
  LT: 'London Underground',
  ME: 'Merseyrail',
  NT: 'Northern',
  SE: 'Southeastern',
  SN: 'Southern',
  SR: 'ScotRail',
  SW: 'South Western Railway',
  TL: 'Thameslink',
  TP: 'TransPennine Express',
  TW: 'Tyne and Wear Metro',
  VT: 'Avanti West Coast',
  XC: 'CrossCountry',
  XR: 'Elizabeth line',
};

/** Names from the fares feed's operator list, for codes the list above doesn't have. */
const feedNames: Record<string, string> = {};

/**
 * Adds operator names from the published data (operators.json), so an operator that starts
 * running after this list was written still gets a name, and fares naming it can be read.
 */
export function registerOperators(names: Record<string, string>): void {
  Object.assign(feedNames, names);
}

export const operatorName = (code: string) => OPERATORS[code] ?? feedNames[code] ?? code;

// Names used for operators in fares route descriptions such as "LNER ONLY" or "NOT GC".
const ROUTE_ALIASES: Record<string, string[]> = {
  AW: ['AW', 'TFW', 'TRANSPORT FOR WALES', 'ARRIVA TW', 'TFW RS', 'TFWRS'],
  CC: ['C2C'],
  CH: ['CH', 'CHILTERN', 'CHLTRN', 'CHILTERN RAILWAYS'],
  CS: ['CALEDONIAN SLEEPER', 'SLEEPER'],
  EM: ['EMR', 'EAST MIDLANDS', 'EAST MIDLANDS RAILWAY'],
  GC: ['GC', 'GRAND CENTRAL', 'GRAND CTRL'],
  GN: ['GN', 'GREAT NORTHERN'],
  GR: ['LNER'],
  GW: ['GWR', 'GW', 'GREAT WESTERN'],
  GX: ['GATWICK EXPRESS', 'GATWICK EXP', 'GATWKEXP', 'GATEX'],
  HT: ['HULL TRAINS', 'HT', 'HULLTRNS'],
  HX: ['HEATHROW EXPRESS', 'HEATHROW EXP', 'HEX'],
  LD: ['LUMO', 'ECTL'],
  LE: ['GREATER ANGLIA', 'GREATER ANG', 'GRT ANG', 'GA'],
  LM: ['LM', 'WMR', 'WMT', 'WEST MIDLANDS', 'LNR', 'LNWR', 'LONDON NORTHWESTERN'],
  ME: ['MERSEYRAIL', 'MRAIL'],
  NT: ['NORTHERN', 'NTHN', 'NRTH', 'NORTHN'],
  SE: ['SOUTHEASTERN', 'SE'],
  SN: ['SOUTHERN', 'SN'],
  SR: ['SCOTRAIL', 'SCR', 'SR'],
  SW: ['SWR', 'SW', 'SOUTH WESTERN', 'SW RAILWAY', 'S W RAILWAY'],
  TL: ['THAMESLINK', 'TL', 'TLINK'],
  TP: ['TP', 'TPE', 'TRANSPENNINE', 'TP EXPRESS'],
  VT: ['AVANTI', 'AWC', 'AVANTI WC', 'AVANTI WEST COAST'],
  XC: ['XC', 'CROSSCOUNTRY', 'CROSS COUNTRY', 'CROSS CNTRY'],
};

/** Names standing for more than one operator. */
const GROUP_ALIASES: Record<string, string[]> = {
  TLGN: ['TL', 'GN'],
};

/** Words that add nothing to an operator's name, as in "LNER TRAINS" or "C2C RAIL". */
const FILLER = /\s+(?:TRAINS?|RAIL|SERVICES)$/;

function codesFor(name: string): string[] | null {
  const n = name.replace(/\./g, '').replace(/\s+/g, ' ').replace(FILLER, '').trim();
  if (GROUP_ALIASES[n]) return GROUP_ALIASES[n];
  const code = Object.keys(ROUTE_ALIASES).find((c) => ROUTE_ALIASES[c].includes(n));
  if (code) return [code];
  const fromFeed = Object.keys(feedNames).find((c) => feedNames[c].toUpperCase() === n);
  return fromFeed ? [fromFeed] : null;
}

/**
 * Operator codes named by a route description part such as "LNER", "GC/HT" or "TP HT GW",
 * or null when any part isn't a known operator.
 */
export function operatorsNamed(text: string): string[] | null {
  const parts = text
    .toUpperCase()
    .split(/\s*(?:\/|&|,|\+|\bAND\b|\bOR\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const codes: string[] = [];
  for (const part of parts) {
    // A part can be one name ("GRAND CENTRAL") or a list of short names ("TP HT GW").
    const whole = codesFor(part);
    const words = whole ? null : part.split(' ').map(codesFor);
    if (whole) codes.push(...whole);
    else if (words && words.length > 1 && words.every(Boolean)) codes.push(...words.flatMap((w) => w!));
    else return null;
  }
  return codes;
}
