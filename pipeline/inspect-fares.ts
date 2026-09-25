// Phase 2 spike: measures walk-up fare volumes and lists the value codes used in the
// restrictions file, so the parser and data layout can be checked against real data.
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ZIP = 'data/raw/fares.zip';
const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 1 << 31, encoding: 'latin1' });
const members = unzip('-Z1', ZIP).split('\n').filter(Boolean);
const file = (ext: string) => {
  const m = members.find((n) => n.endsWith(`.${ext}`));
  return m ? unzip('-p', ZIP, m).split(/\r?\n/).filter((l) => l && !l.startsWith('/')) : [];
};
const show = (title: string, lines: string[], max = 20) => {
  console.log(`\n=== ${title}: ${lines.length}`);
  for (const l of lines.slice(0, max)) console.log(`    |${l}|`);
};
const counts = (values: string[]) => {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 25);
};

// Walk-up ticket types: not restricted to a train, single or return, current.
const tty = file('TTY').filter((l) => l.slice(4, 12) === '31122999');
const walkUp = new Set(
  tty.filter((l) => l[73] === 'N' && 'SR'.includes(l[44]) && !/GROUP|TEST|SEASON|CARNET/i.test(l.slice(28, 43))).map((l) => l.slice(1, 4)),
);
console.log(`Walk-up ticket codes: ${walkUp.size}`);
console.log(counts(tty.filter((l) => walkUp.has(l.slice(1, 4))).map((l) => l.slice(28, 43).trim())));

const ffl = file('FFL');
const flows = new Map<string, string>();
for (const l of ffl) if (l[1] === 'F' && l.slice(15, 18) === '000') flows.set(l.slice(42, 49), l);
console.log(`\nAdult flows: ${flows.size}`);
console.log('usage codes', counts([...flows.values()].map((l) => l[18])));
console.log('direction', counts([...flows.values()].map((l) => l[19])));
console.log('route codes', counts([...flows.values()].map((l) => l.slice(10, 15))).slice(0, 10));

const byOrigin = new Map<string, string[]>();
let fares = 0;
for (const l of ffl) {
  if (l[1] !== 'T' || !walkUp.has(l.slice(9, 12))) continue;
  const flow = flows.get(l.slice(2, 9));
  if (!flow) continue;
  fares++;
  const o = flow.slice(2, 6);
  const list = byOrigin.get(o) ?? [];
  list.push(`${flow.slice(6, 10)}${flow.slice(10, 15)}${flow[19]}${l.slice(9, 22)}`);
  byOrigin.set(o, list);
}
const all = [...byOrigin.values()].map((v) => JSON.stringify(v));
const raw = all.reduce((n, s) => n + s.length, 0);
const gz = all.reduce((n, s) => n + gzipSync(s).length, 0);
console.log(`\nWalk-up adult fares: ${fares}; origin codes: ${byOrigin.size}; raw ${(raw / 1e6).toFixed(1)} MB; gzip ${(gz / 1e6).toFixed(1)} MB`);
const biggest = [...byOrigin].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([k, v]) => `${k}:${v.length}`);
console.log(`largest origins: ${biggest.join(' ')}`);

const rst = file('RST');
const tr = rst.filter((l) => l.startsWith('RTRC'));
console.log('\nTR out_ret', counts(tr.map((l) => l[10])));
console.log('TR arr_dep_via', counts(tr.map((l) => l[19])));
console.log('TR location blank', tr.filter((l) => !l.slice(20, 23).trim()).length);
console.log('TR rstr_type', counts(tr.map((l) => l[23])));
console.log('TR train_type', counts(tr.map((l) => l[24])));
console.log('TR min_fare', counts(tr.map((l) => l[25])));
console.log('RH type_out/rtn/change', counts(rst.filter((l) => l.startsWith('RRHC')).map((l) => l.slice(136, 139))));
console.log('SR fields 12-14', counts(rst.filter((l) => l.startsWith('RSRC')).map((l) => l.slice(12))));
console.log('SQ tail', counts(rst.filter((l) => l.startsWith('RSQC')).map((l) => l.slice(15))));
show('B3 restriction', rst.filter((l) => l.startsWith('R') && l[3] === 'C' && l.slice(4, 6) === 'B3' && !l.startsWith('RRRC')), 60);
show('A time restriction with a location and TOC list', rst.filter((l) => /^R(TR|TT|TD)C0W0001/.test(l)), 20);
show('A train restriction', rst.filter((l) => /^RS[RQD]C1AC0464[78]/.test(l)), 20);
show('RR records for 2O', rst.filter((l) => l.startsWith('RRRC2O')), 10);
show('RCA samples', rst.filter((l) => l.startsWith('RCAC')), 5);
show('RTE samples', file('RTE'), 10);
show('NFO samples', file('NFO'), 5);
show('TOC samples', file('TOC'), 5);
