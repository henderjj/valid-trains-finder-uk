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
  ME: 'Merseyrail',
  NT: 'Northern',
  SE: 'Southeastern',
  SN: 'Southern',
  SR: 'ScotRail',
  SW: 'South Western Railway',
  TL: 'Thameslink',
  TP: 'TransPennine Express',
  VT: 'Avanti West Coast',
  XC: 'CrossCountry',
  XR: 'Elizabeth line',
};

export const operatorName = (code: string) => OPERATORS[code] ?? code;

// Names used for operators in fares route descriptions such as "LNER ONLY" or "NOT GC".
const ROUTE_ALIASES: Record<string, string[]> = {
  AW: ['TFW', 'TRANSPORT FOR WALES', 'ARRIVA TW'],
  CC: ['C2C'],
  CH: ['CHILTERN', 'CHILTERN RAILWAYS'],
  CS: ['CALEDONIAN SLEEPER', 'SLEEPER'],
  EM: ['EMR', 'EAST MIDLANDS', 'EAST MIDLANDS RAILWAY'],
  GC: ['GC', 'GRAND CENTRAL'],
  GN: ['GN', 'GREAT NORTHERN'],
  GR: ['LNER'],
  GW: ['GWR', 'GW', 'GREAT WESTERN'],
  GX: ['GATWICK EXPRESS', 'GATEX'],
  HT: ['HULL TRAINS', 'HT'],
  HX: ['HEATHROW EXPRESS', 'HEX'],
  LD: ['LUMO'],
  LE: ['GREATER ANGLIA', 'GA'],
  LM: ['WMR', 'WEST MIDLANDS', 'LNR', 'LONDON NORTHWESTERN'],
  NT: ['NORTHERN'],
  SE: ['SOUTHEASTERN', 'SE', 'HS1', 'HIGH SPEED'],
  SN: ['SOUTHERN'],
  SR: ['SCOTRAIL'],
  SW: ['SWR', 'SOUTH WESTERN'],
  TL: ['THAMESLINK', 'TL'],
  TP: ['TPE', 'TRANSPENNINE', 'TP EXPRESS'],
  VT: ['AVANTI', 'AWC', 'AVANTI WEST COAST'],
  XC: ['XC', 'CROSSCOUNTRY', 'CROSS COUNTRY'],
};

/** Operator codes named by a route description part such as "LNER" or "GC/HT". */
export function operatorsNamed(text: string): string[] | null {
  const parts = text
    .toUpperCase()
    .split(/\s*(?:\/|&|,|\bAND\b|\bOR\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const codes = parts.map((p) => Object.keys(ROUTE_ALIASES).find((c) => ROUTE_ALIASES[c].includes(p)));
  return parts.length && codes.every(Boolean) ? (codes as string[]) : null;
}
