# Valid Trains Finder (UK)

A Progressive Web App that shows which trains a UK rail ticket (Anytime, Off-Peak or
Super Off-Peak) is valid on, for a chosen route and date. It runs entirely in the
browser against data files built weekly from the Rail Delivery Group timetable and
fares feeds.

Contains data from National Rail Enquiries. This is not an official service; always
check before you travel.

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
npm run data:build -- 2026-10-05 7   # writes data/site/, prints per-day sizes
```

`data/` is ignored by git. The RSPS feed specifications are confidential and must not
be committed (`specs/` and `*.pdf` are ignored).
