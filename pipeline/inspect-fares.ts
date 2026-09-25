// Prints the structure of the fares feed (members, record types, sample records) so the
// parser can be checked against real data. Usage: npm run data:inspect-fares -- [station names…]
import { execFileSync } from 'node:child_process';

const ZIP = 'data/raw/fares.zip';
const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 1 << 30, encoding: 'latin1' });

const names = (process.argv.slice(2).length ? process.argv.slice(2) : ['LONG EATON', 'SHEFFIELD']).map((n) => n.toUpperCase());

console.log(unzip('-l', ZIP));
const members = unzip('-Z1', ZIP).split('\n').filter(Boolean);
const text = (m: string) => unzip('-p', ZIP, m).split(/\r?\n/);

for (const m of members) {
  const lines = text(m);
  const byType = new Map<string, string[]>();
  let maxLen = 0;
  for (const l of lines) {
    if (!l) continue;
    maxLen = Math.max(maxLen, l.length);
    const key = l.startsWith('/') ? '/' : l.slice(0, 2);
    const list = byType.get(key) ?? [];
    if (list.length < 3) list.push(l);
    byType.set(key, list);
  }
  console.log(`\n=== ${m}: ${lines.length} lines, max length ${maxLen}`);
  for (const [k, samples] of byType) {
    console.log(`  [${k}]`);
    for (const s of samples) console.log(`    |${s}|`);
  }
}

// Follow one route through the files: location codes, then flows and fares between them.
const loc = members.find((m) => m.endsWith('.LOC'));
const ffl = members.find((m) => m.endsWith('.FFL'));
if (loc && ffl) {
  const locLines = text(loc).filter((l) => names.some((n) => l.includes(n)));
  console.log(`\n=== LOC records for ${names.join(', ')}`);
  for (const l of locLines.slice(0, 20)) console.log(`    |${l}|`);
  const nlcs = [...new Set(locLines.map((l) => l.slice(36, 40)))];
  console.log(`  candidate NLCs (cols 36-39): ${nlcs.join(' ')}`);
  const flows = text(ffl).filter((l) => l[1] === 'F' && nlcs.includes(l.slice(2, 6)) && nlcs.includes(l.slice(6, 10)));
  console.log(`\n=== FFL flows between them: ${flows.length}`);
  for (const f of flows.slice(0, 10)) console.log(`    |${f}|`);
  const ids = new Set(flows.map((f) => f.slice(42, 49)));
  const fares = text(ffl).filter((l) => l[1] === 'T' && ids.has(l.slice(2, 9)));
  console.log(`\n=== FFL fares on those flows: ${fares.length}`);
  for (const f of fares.slice(0, 40)) console.log(`    |${f}|`);
}
