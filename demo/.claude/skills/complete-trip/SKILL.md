---
name: complete-trip
description: Use when finishing a half-written trip log in a Ship's Log data repo — read the sparse trip and its photos, research the issue against the web and the boat's own manuals, write the trip narrative, open or update the linked maintenance item with a two-way cross-link, then commit and push. Operates only on a git clone of the data repo, never through the running app's API.
---

# Complete a half-written trip

A crew member typed a few lines into a trip and dropped in some photos on the way
back to the dock. Your job is to finish that log entry: write the narrative,
research and record any problem it surfaced, and open the maintenance follow-up —
then commit and push.

> **You work on a git clone of the DATA repo. There is no app and no API here.**
> Edit plain files, `git commit`, `git push`. **Never** call the running web
> app's REST API to make changes — the app pulls your pushes on a timer. This
> skill is runtime-agnostic: it works invoked as a Cowork skill or run by hand as
> a `/complete-trip` slash-command.

This skill encodes the workflow; it does **not** restate the data model. The
authoritative rules for ids, slugs, cross-links, enums, required fields, and the
owner-only **monetary** tags live in `SCHEMA.md` (and the conventions in
`AGENTS.md`). Read them; cite them; do not duplicate them here.

## Steps

### 1. Load the conventions first

Before touching anything, read **`AGENTS.md`** (the repo's ground rules and file
layout), then **`SCHEMA.md`** (every field, the id/slug rules, the cross-link
table, and the monetary tags). Everything below assumes you have. If they
disagree with this skill, they win.

### 2. Locate the target trip and view its photos

Find the half-written trip under `trips/` (`t-<date>.md`). Read its frontmatter
and body. For each path in its `photos[]`, **open the image in `photos/` and
actually look at it** — the photos usually show the thing the entry is about (a
frayed halyard, a weak exhaust stream, a fitting). What you see drives what you
write; never describe a photo you have not viewed.

### 3. Research the fix — web AND the boat's own manuals

If the entry surfaced a problem, research the fix two ways:

- **Web** for general technique and parts.
- **This boat's own docs:** `grep` the `manuals/` directory (the `man-…` records
  and any real PDF/text alongside them) **and** `quickref.yaml` for the relevant
  system (engine, rigging, electrical…). The manuals are there precisely so you
  research against *this* boat's gear, not a generic one. Prefer what the boat's
  manual says over a generic web answer when they differ.

### 4. Write the trip narrative into the body

Write what actually happened into the trip **body** (below the frontmatter
fence): conditions, route, what was noticed. Then fill in the structured
frontmatter fields **you have evidence for** (waypoints, `distanceNm`,
`engineHrs`, `crew`, `wind`…). Hard rules:

- **Leave unknowns blank.** A partial entry is valid (see `AGENTS.md`). Do not
  invent a distance, an engine hour, a wind speed, or a measurement you do not
  know. A blank field is honest; a guessed number corrupts the log.
- **Never surface cost in crew-facing prose.** The trip body and findings are
  read by crew, and the app's redaction cannot reach prose. Keep every dollar
  amount / `costEst` out of the narrative — put money only where `SCHEMA.md`'s
  **monetary** rules allow it (a `costs/` record's `amount`, or
  `maintenance.costEst`), and only if you are the owner tracking budget.

### 5. Open or update the linked maintenance item (two-way cross-link)

If the trip surfaced a problem, make sure a maintenance record exists for it:

- **Create or update** `maintenance/<id>.md`. Derive the id the way `SCHEMA.md`
  says (`m-` + slug of the `title`; suffix `-2`/`-3` on collision); name the file
  `<id>.md`. Set the fields you know: `status` (`overdue`/`due`/`scheduled`/
  `done`), `system`, `priority`, `opened`, `due`. Put the work plan / research
  notes in the body. Only add `costEst` if you are the owner — it is a monetary
  field (see `SCHEMA.md`).
- **Wire BOTH directions so each link resolves** (per the `SCHEMA.md` cross-link
  table): on the maintenance record set `fromTripId: <trip id>`; on the trip's
  finding set `maintId: <maintenance id>` (and a `severity`). Create the
  maintenance record in the **same pass/commit** as the trip edit so the link is
  never dangling at load time.

### 6. Validate locally (if the app is checked out alongside)

If you have the app repo checked out next to the data clone, run its loader /
tests against the data dir to validate before committing (the loader **fails
loud** — it validates every record and refuses to start on a bad one). If you do
**not** have the app, you cannot run it from the data clone — that is fine: rely
on the app's fail-loud loader at its next pull, and self-check that the YAML
parses, dates are real `YYYY-MM-DD`, enum values are spelled exactly as
`SCHEMA.md` lists, and every cross-link you set points at a real id.

### 7. Commit and push

`git add` the trip, the maintenance record, and any new photos **together**, then
`git commit` with a clear, present-tense message that names the record id (e.g.
`trip(t-2026-06-14): write narrative + open raw-water impeller follow-up`). Then
`git push` so the app picks it up on its next pull. If you changed a convention
or the field set, update `AGENTS.md` / `SCHEMA.md` in the **same** commit.

## Done when

- The trip body reads as a real narrative; only evidence-supported fields are
  filled; no fabricated numbers; no money in any crew-facing field.
- The problem has a maintenance record, linked **both** ways (`fromTripId` ⇄
  `findings[].maintId`), and every cross-link resolves.
- Everything is committed and pushed on the **git clone** — you never called the
  running app's API.
