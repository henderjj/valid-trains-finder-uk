# Valid Trains Finder (UK)

A Progressive Web App that shows which trains a UK rail ticket (Anytime, Off-Peak or Super Off-Peak) is valid on, for a chosen route and date. It runs entirely in the browser against data files built weekly from the Rail Delivery Group timetable and fares feeds.

Contains data from National Rail Enquiries. This is not an official service; always check before you travel.

See [docs/functionality.md](docs/functionality.md) for everything the app does and the rules it uses to decide which trains a ticket is valid on.

## Development

```sh
npm install
npm run dev        # start the app
npm test           # unit tests
npm run typecheck
```

## Data pipeline

```sh
export NRDP_USERNAME=... NRDP_PASSWORD=...
npm run data:download -- timetable   # saves data/raw/timetable.zip
npm run data:build -- 2026-10-05 7   # writes public/data/, prints per-day sizes
npm run dev                          # the app now reads the local data
```

`data/` and `public/data/` are ignored by git. The RSPS feed specifications are confidential and must not be committed (`specs/` and `*.pdf` are ignored).

## Deployment

The **Deploy** workflow runs on every push to `main` (and by hand from the Actions tab). It also runs every Monday at 03:30 UTC. It downloads the timetable, fares and routeing guide, builds 12 weeks (84 days) of data plus the app, checks the data looks complete, and publishes both to GitHub Pages. If a check fails the run fails and the site keeps its last good data; warnings (such as an operator with no name) show on the run's page. Pages must be enabled once under **Settings → Pages → Source: GitHub Actions**.
