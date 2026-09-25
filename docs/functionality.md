# Valid Trains Finder: how the app works

This document describes everything the web app does, from the user's point of view and in terms of the rules it applies. Keep it up to date: every pull request that changes what the app does or how it decides validity updates this file too.

## What it is for

You pick a route and a date and choose a walk-up ticket. The app lists the trains you could take, and marks each one as valid or not valid for that ticket, with the reason. It runs entirely in your browser, using data files built from the Rail Delivery Group timetable, fares and routeing guide feeds.

This is not an official National Rail service. Times come from the planned timetable, and validity is worked out from published data, so always check before you travel.

## Installing and offline use

The app is a Progressive Web App, so it can be installed from the browser to a phone's home screen or a computer. Its name is "Valid Trains Finder" ("Valid Trains" on the home screen).

After the first visit, the app itself works offline. Data files (timetables, fares and routeing) are cached as they are used, so a route and day you have already searched also works offline.

## Searching

### Stations

- **From** and **To** accept a station name or its three-letter code (for example "Long Eaton" or "LGE").
- Suggestions are ranked as follows:
  1. An exact code match.
  2. Names that start with what you typed.
  3. Names with a word that starts with it.
  4. Names that contain it.
- Use the arrow keys and Enter to pick a suggestion, or Escape to close the list.
- The **⇅** button swaps From and To.

### Date

- **Date** defaults to today (UK time).
- Only dates that have timetable data can be searched. This is 12 weeks (84 days) from when the data was last built. With weekly builds, that means at least 11 weeks ahead. Outside that range, the app says which dates are available.
- Dates further ahead show the planned timetable. Engineering-work changes are usually published about 12 weeks ahead, so times may still change for the furthest dates.
- **Return date** is optional. Leave it empty to search one way. Set it to also find journeys back from the destination on that date (see [Return trips](#return-trips)). It must be on or after the outward date and within the same range; the **✕** button clears it.
- **Find trains** is enabled once both stations are chosen, they are different, and the dates are in range.

### Recent routes

The last five routes you searched are listed under **Recent**. Tapping one searches it again for the chosen date. They are stored only in your browser.

## Journeys

The app lists every journey that leaves the origin on the chosen date (00:00 to 23:59). Each journey shows:

- Departure and arrival times, and the journey's duration.
- Whether it is direct ("Direct, non-stop" or "Direct, N stops") or how many changes it has and where ("1 change at Derby").
- The train operators, plus "Bus" when any part is a replacement or scheduled bus. Operator names come from a list in the app, or from the fares data's operator list for an operator the app doesn't know yet; an operator in neither is shown by its two-letter code.
- A validity badge when a ticket is chosen (see below).

Tap a journey to expand it. The expanded view shows each train's operator and its calls with times and planned platforms ("Plat 4A", where the timetable gives one), and "Change at X, N min to change" between trains. When the journey is today, each train also has a **Live times** link, which opens National Rail's live departures between the stations where you board and leave that train.

Tick **Direct trains only** to hide journeys with changes. It is off by default, and the app remembers your choice for later searches until the page is reloaded. The summary line then counts direct journeys only ("2 direct journeys"). If there are no direct trains that day, the app says so and suggests unticking the option.

### How journeys are found

- **Every direct train** between the two stations is listed.
- **Journeys with changes** are found by searching the day's timetable for the earliest arrival from each departure time through the day. The search uses these limits:
  - At most **3 trains**, which means up to two changes.
  - At least the station's **minimum connection time** to change trains, from the timetable's station list (for example 6 minutes at Derby, 10 at Manchester Piccadilly and 15 at London King's Cross). Stations without one use 5 minutes.
  - At most **12 hours** for the whole journey.
- A journey with changes is left out when another journey leaves no earlier, arrives no later, and has no more changes.
- The search runs in the background (a Web Worker), so the page stays responsive.

Current limits:

- Journeys that continue past midnight into the next day's timetable are not found.
- Very long journeys (for example Penzance to Inverness) may find nothing, because of the 3-train and 12-hour limits.
- The few operator-specific connection times some stations publish (for example between two Southern trains at Clapham Junction) are not used; the station's general time applies.
- Walking or Underground links between separate stations (for example across London) are not used, so a journey never changes between two different stations.

## Tickets

When fares data is available, a ticket panel appears above the journeys.

### Choosing a ticket

- **Outward / Return** (in a one-way search) chooses which way you are travelling.
  - **Outward** offers tickets bought at the origin, for travel from the origin to the destination.
  - **Return** offers return tickets bought at the destination. Their return half brings you back along this route.
- The ticket list shows only walk-up tickets: **Anytime**, **Off-Peak** and **Super Off-Peak**. It includes singles, returns and day tickets, in standard and first class. Advance tickets are not included.
- Each option shows the ticket's name, its price and its route. The route is shown when it isn't "Any permitted", for example "LNER ONLY" or "VIA SHEFFIELD".
- Standard class is listed first, then singles before returns, then Super Off-Peak, Off-Peak and Anytime, and then by price.
- Where the same ticket is priced at several levels (station, fare group, cluster), the most specific price is used.
- The app remembers the last ticket type you chose and picks it again after a new search, if it is on offer.
- **Any ticket (show all trains)** turns validity checking off.

Once a ticket is chosen, the panel shows:

- The ticket's time restriction in words, or "No time restrictions" if it has none.
- The ticket's rules from the fares data: how long the return half lasts ("Return within 1 month", "Return the same day") and whether a break of journey (stopping off part way and continuing later) is allowed.
- **Show valid trains only**, which is on by default. Untick it to see every journey, with the invalid ones marked.

The summary line reads "N of M journeys valid".

### Return trips

With a return date, the results have two tabs, **Out** and **Back**, each with its date. Back lists journeys from the destination to the origin on the return date. The Outward/Return choice described above is replaced by these tabs.

- On **Out**, you choose a ticket bought at the origin, single or return, as for a one-way search.
- On **Back**, if the Out ticket is a return, its return half is used and checked against the return direction's restrictions. The panel says so, with no ticket to choose.
- If the Out ticket is a single, or no ticket is chosen, Back offers singles bought at the destination instead.
- The return half must be used within the ticket's return period, counting from the outward date. For example, a day return must come back the same day, and an Off-Peak Return within a month. A period in months ends the day before the same date that many months later. When the return date is outside the period, every journey back is marked not valid, with the last (or first) date the return half can be used.
- Tickets without a return period in the fares data are not checked this way.

### How validity is decided

A journey is valid for a ticket only if it passes all of these checks, in this order. The first check that fails gives the reason shown on the journey.

1. **Operators named in the ticket's route.** Routes such as "LNER ONLY" allow only those operators' trains, and routes such as "NOT HEATHROW EXP" exclude them. Every train in the journey must be allowed. The app reads the many ways the fares data writes operator names ("EMR-ONLY", "S W RAILWAY ONLY", "TP HT GW ONLY"), including names from the fares data's operator list.
   - When a route says "ONLY" or "NOT" but the app can't read the names, and the routeing guide has no data for that route either, the app can't check it. The journey then shows as valid with the note "The app can't check this ticket's route (…); check before you travel".
   - Reason shown: "this ticket is LNER only (the 09:05 is Lumo)" or "this ticket is not valid on …".
2. **Permitted route** (from the National Routeing Guide), described in the next section.
   - Reasons shown: "changing at X and Y is not a permitted route for this ticket", or "doesn't go the way the ticket's route (VIA SHEFFIELD) requires" when the journey misses a place or operator the ticket's route names.
3. **Time restrictions** (the restriction code on the fare, for example Off-Peak codes). A restriction applies only on the dates and days of the week it covers.
   - **Listed trains.** A restriction can list specific trains as not valid (reason: "the 07:12 from X is excluded for this ticket"). Or it can list trains as valid whatever the time, in which case those trains skip the time checks.
   - **Time windows.** A window bans departing from, arriving at, or passing through a station between two times. Where no station is given, departures are checked at the origin and arrivals at the destination. A window may apply only to certain operators or dates.
     - Reason shown: "departs Long Eaton at 07:40 (restricted 00:00–09:29)".
   - Every train in a journey with changes is checked, not only the first.
   - The outward and return directions use their own rules.

If a fare's restriction code can't be found, the journey is shown as valid with the note "check before you travel".

## Permitted routes (National Routeing Guide)

A ticket without a named route ("Any permitted") is valid only on permitted routes. The app follows the routeing guide data feed specification (RSPS5047):

1. **A single train** (no changes) is always permitted.
2. **Near-shortest routes.** A journey no more than **3 miles** longer than the shortest route by rail is permitted.
3. **Local journeys.** When the origin and destination share a routeing point, the journey is permitted if it is one of the following:
   - the shortest route, give or take 3 miles;
   - the shortest route with a detour only through stations in the same station group as one on it;
   - through trains that change only at the shared routeing point, where that is the shortest way via any of the shared routeing points.
4. **Longer journeys** must pass all of these tests:
   - It must reach a routeing point for the origin (the ORP) and later one for the destination (the DRP).
   - Getting to the ORP, and on from the DRP, must follow the local rules above.
   - Between the ORP and DRP, the journey must not pass any station twice (except within a station group). The places it passes must follow one of the permitted sequences of routeing guide maps, in order.
   - A "via London" permitted route is checked as two halves, either side of the London station group.
5. **Routes named on the ticket.** Many fares name places the journey must pass or avoid ("VIA SHEFFIELD", "NOT VIA LONDON"), or operators that must or mustn't be used. "London" means any station in the London group or listed as a London station.
   - The journey must pass every required place, or one of them where the route allows a choice, and must avoid every excluded place.
   - A station group counts as a place: any station in the group counts.
   - Places passed without stopping count.
   - When a routed journey fails the permitted-route rules as a whole, it is split at the places it is routed via. It is permitted if each part is.

### How the app follows the journey

- The timetable lists only the stations where a train stops. The app fills in the stations it passes by following the shortest track between stops.
- Where the map draws a station on a short spur and the train doesn't double back there, the spur is ignored.
- Stops that aren't on the routeing guide map are passed over. For example, Tamworth High Level is drawn as Tamworth.
- Bus legs count as no distance.

### What the permitted-route check does not do yet

These gaps mean a journey is sometimes marked not valid when it is in fact allowed, or the other way round:

- **Checks that need the 1996 baseline fares.**
  - Whether the ORP or DRP is appropriate for the journey.
  - Doublebacks through the origin or destination.
- **Easements.** These are the published exceptions that allow or forbid specific routes.
- **Special cases.** Sleeper services, Thameslink and London Underground across London, and zonal (Travelcard) fares.
- **Missing track data.** When the routeing guide has no track data for part of a journey, the app can't check the route and treats it as permitted.

## Data and updates

- The **Deploy** workflow rebuilds the data every Monday at 03:30 UTC and on every change to the app. It uses the latest timetable, fares and routeing guide feeds.
- Before publishing, the build checks the data looks complete. It needs a typical day to have at least 15,000 trains and every day at least 5,000 (except Christmas Day and Boxing Day). It also needs at least 2,000 stations and 1,000 station connection times, the Anytime Single and Return ticket types, at least 2,000 fares files and 100 restriction codes, and at least 200 routeing points and 100 fare routes. If any check fails, nothing is published, so the app keeps the last good data, and GitHub reports the run as failed.
- The build also warns, without stopping, about operators with no name and about ticket routes naming operators it can't read. The warnings show on the workflow run's page, and the fix is to add the names to `src/lib/operators.ts`.
- The footer shows when the timetable data was last updated.
- The footer also carries the credit "Contains data from National Rail Enquiries" and the not-official disclaimer.
- If the fares or routeing data can't be loaded, the app still lists trains. It shows no ticket panel, or skips the permitted-route check.
