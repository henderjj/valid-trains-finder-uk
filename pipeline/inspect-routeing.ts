// Spike: lists the routeing guide feed's files with record counts and sample lines, so the
// parser can be written against real data.
import { execFileSync } from 'node:child_process';

const ZIP = 'data/raw/routeing.zip';
const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 2 ** 30, encoding: 'latin1' });
console.log(unzip('-l', ZIP));
for (const name of unzip('-Z1', ZIP).split('\n').filter(Boolean)) {
  const lines = unzip('-p', ZIP, name).split(/\r?\n/).filter(Boolean);
  const data = lines.filter((l) => !l.startsWith('/'));
  console.log(`\n=== ${name}: ${lines.length} lines, ${data.length} data`);
  for (const l of lines.filter((l) => l.startsWith('/')).slice(0, 8)) console.log(`  |${l}|`);
  for (const l of data.slice(0, 12)) console.log(`  |${l}|`);
  // Lines mentioning Long Eaton, Nottingham or Derby by CRS, to follow a known example.
  for (const l of data.filter((l) => /\b(LGE|DBY|NOT|SHF|MAN|LEI|NUN)\b/.test(l)).slice(0, 12)) console.log(`  ~|${l}|`);
}
