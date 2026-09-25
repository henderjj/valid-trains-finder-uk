// Prints the structure of the fares feed and follows one route through it (locations,
// clusters, flows, fares, ticket types, restrictions), so the parser can be checked against
// real data. Usage: npm run data:inspect-fares -- [originNLC destNLC]
import { execFileSync } from 'node:child_process';

const ZIP = 'data/raw/fares.zip';
const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 1 << 30, encoding: 'latin1' });
const [origin = '1829', dest = '6691'] = process.argv.slice(2);

const members = unzip('-Z1', ZIP).split('\n').filter(Boolean);
const file = (ext: string) => {
  const m = members.find((n) => n.endsWith(`.${ext}`));
  return m ? unzip('-p', ZIP, m).split(/\r?\n/).filter((l) => l && !l.startsWith('/')) : [];
};
const show = (title: string, lines: string[], max = 30) => {
  console.log(`\n=== ${title}: ${lines.length}`);
  for (const l of lines.slice(0, max)) console.log(`    |${l}|`);
};

console.log(`Members: ${members.join(' ')}`);
for (const ext of ['FFL', 'TTY', 'RST', 'TVL', 'FSC', 'NFO', 'NDF', 'LOC', 'TJS', 'TOC', 'FRR', 'RLC', 'DIS']) {
  const lines = file(ext);
  const types = new Map<string, { n: number; samples: string[] }>();
  for (const l of lines) {
    const k = l.slice(0, ext === 'RST' ? 4 : 2);
    const t = types.get(k) ?? { n: 0, samples: [] };
    t.n++;
    if (t.samples.length < 2) t.samples.push(l);
    types.set(k, t);
  }
  console.log(`\n### ${ext}: ${lines.length} records`);
  for (const [k, t] of types) {
    console.log(`  [${k}] ${t.n}`);
    for (const s of t.samples) console.log(`    |${s}|`);
  }
}

// Clusters that contain either station, and location records (fare group).
const fsc = file('FSC');
const clusters = (nlc: string) => fsc.filter((l) => l.slice(5, 9) === nlc).map((l) => l.slice(1, 5));
const originCodes = [origin, ...clusters(origin)];
const destCodes = [dest, ...clusters(dest)];
show(`FSC records for ${origin} / ${dest}`, fsc.filter((l) => [origin, dest].includes(l.slice(5, 9))));
const loc = file('LOC').filter((l) => l[1] === 'L' && [origin, dest].includes(l.slice(36, 40)) && l.slice(9, 17) === '31122999');
show('Current LOC records', loc);
const fareGroups = loc.map((l) => ({ nlc: l.slice(36, 40), rest: l.slice(40) }));
console.log(fareGroups);

// Flows in either direction between any of those codes.
const ffl = file('FFL');
const flows = ffl.filter(
  (l) =>
    l[1] === 'F' &&
    ((originCodes.includes(l.slice(2, 6)) && destCodes.includes(l.slice(6, 10))) ||
      (destCodes.includes(l.slice(2, 6)) && originCodes.includes(l.slice(6, 10)))),
);
show(`Flows (origin codes ${originCodes.join(',')}; dest codes ${destCodes.join(',')})`, flows, 60);
const flowIds = new Set(flows.map((l) => l.slice(42, 49)));
const fares = ffl.filter((l) => l[1] === 'T' && flowIds.has(l.slice(2, 9)));
show('Fares on those flows', fares, 200);

const tickets = new Set(fares.map((l) => l.slice(9, 12)));
show('TTY records for those tickets', file('TTY').filter((l) => tickets.has(l.slice(1, 4))), 100);

const restrictions = [...new Set(fares.map((l) => l.slice(20, 22)).filter((r) => r.trim()))];
console.log(`\nRestriction codes used: ${restrictions.join(' ')}`);
const rst = file('RST');
for (const r of restrictions.slice(0, 6)) {
  show(`RST lines mentioning ${r}`, rst.filter((l) => l.slice(2, 4) === r || l.slice(3, 5) === r || l.slice(4, 6) === r), 80);
}
