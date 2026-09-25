// Downloads the timetable, fares and routeing feeds into data/raw/.
// The source sits behind FeedSource so it can move to the Rail Data Marketplace later.
import { mkdir, writeFile } from 'node:fs/promises';

export type Feed = 'timetable' | 'fares' | 'routeing';

export interface FeedSource {
  download(feed: Feed): Promise<Uint8Array>;
}

/** National Rail Data Portal, as documented on the Open Rail Data Wiki. */
export class NrdpSource implements FeedSource {
  private static readonly base = 'https://opendata.nationalrail.co.uk';
  private static readonly paths: Record<Feed, string> = {
    timetable: '/api/staticfeeds/3.0/timetable',
    fares: '/api/staticfeeds/2.0/fares',
    routeing: '/api/staticfeeds/2.0/routeing',
  };
  private token?: string;

  constructor(private readonly username: string, private readonly password: string) {}

  private async authenticate(): Promise<string> {
    const res = await fetch(`${NrdpSource.base}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new Error(`NRDP authentication failed: HTTP ${res.status}`);
    const { token } = (await res.json()) as { token?: string };
    if (!token) throw new Error('NRDP authentication returned no token');
    return token;
  }

  async download(feed: Feed): Promise<Uint8Array> {
    this.token ??= await this.authenticate();
    const res = await fetch(NrdpSource.base + NrdpSource.paths[feed], {
      headers: { 'X-Auth-Token': this.token },
    });
    if (!res.ok) throw new Error(`Download of ${feed} feed failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

async function main() {
  const { NRDP_USERNAME, NRDP_PASSWORD } = process.env;
  if (!NRDP_USERNAME || !NRDP_PASSWORD) {
    throw new Error('Set NRDP_USERNAME and NRDP_PASSWORD (repository secrets in CI)');
  }
  const source = new NrdpSource(NRDP_USERNAME, NRDP_PASSWORD);
  const feeds = (process.argv.slice(2) as Feed[]).filter(Boolean);
  await mkdir('data/raw', { recursive: true });
  for (const feed of feeds.length ? feeds : (['timetable', 'fares', 'routeing'] as Feed[])) {
    const bytes = await source.download(feed);
    await writeFile(`data/raw/${feed}.zip`, bytes);
    console.log(`${feed}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
