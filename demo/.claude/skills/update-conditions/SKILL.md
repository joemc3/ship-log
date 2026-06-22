---
name: update-conditions
description: Use on a schedule (a cron the owner sets) to refresh the boat's Conditions feed — rewrite conditions.md with current marine weather and tide predictions for the boat's location and curated stations, then commit and push. Operates only on a git clone of the data repo, never the running app's API.
---

# update-conditions

Keep `conditions.md` fresh so the app's all-access **Conditions** page shows
current marine weather and tides. The app pulls your push on its sync timer —
you only edit files + commit/push; never call an app API endpoint.

## When this runs

On whatever cron the owner schedules (e.g. every 3–6 hours). Each run is one
refresh of `conditions.md` in the data-repo clone.

## Steps

1. **Read `conditions.md`** for `location` (lat/lon + label) and the curated
   `tides.stations` list. If `source` is not already `agent`, set it to `agent`
   (you are now the filler).
2. **Get the marine weather** for `location` out ~48 hours from any source you
   trust (NWS marine zone text, Open-Meteo, etc.). Fill `weather.summary`,
   `weather.source`, `weather.asOf` (now, ISO-8601 Z), and `weather.periods[]`
   (`time`, and any of `windDir`, `windKt`, `gustKt`, `tempF`, `seasFt`, `sky`,
   `precipPct`). 3-hour spacing is plenty.
3. **Get tide predictions** (high/low) out ~48 hours for EACH station id in
   `tides.stations`. NOAA CO-OPS works for US stations; use a regional source
   elsewhere. Fill `tides.predictions` keyed by station id with `{ type: H|L,
   time (ISO Z), heightFt }`.
4. **Optionally** write a short prose note in the body (a one-paragraph "what to
   expect on the water"). It renders as Markdown.
5. **Validate** the field shapes against `SCHEMA.md` (Conditions section) — the
   app fails loud on an invalid `conditions.md`.
6. **Commit & push** just `conditions.md` with a message like
   `chore(conditions): refresh weather + tides`.

## Rules

- Edit files in the clone only; do NOT hit the app's REST API.
- `lat`/`lon` are decimal degrees; all times are ISO-8601 with a `Z`.
- Keep the curated station list as the owner set it — refresh predictions, don't
  reshuffle the stations unless asked.
- Conditions has NO cost data; never paste cost/owner-sensitive figures here.
