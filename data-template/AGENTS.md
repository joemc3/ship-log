# AGENTS.md — Ship's Log data repo (Cowork entry point)

You are working in a **boat's log book**, stored as a git repo. This file is your
orientation: what the repo is, where things live, the ground rules, and the
research-and-write workflow you run when finishing a log entry. Read it before you
touch anything. For exact per-field detail (types, required vs optional, enums),
read `SCHEMA.md` — this file points at it rather than duplicating it.

> You are operating on a **git clone of the data repo**, never through the boat's
> web app. There is no API and no server here — your edits are plain files, and
> **git is the source of truth**. The running app pulls your pushes on a timer.

## 1. What this repo is

- A git-backed log book for one boat: trips sailed, maintenance done and due,
  inventory, vendors, manuals, and (owner-only) costs.
- **One record per file**, Markdown with a YAML **frontmatter** block at the top
  and a free-text **body** below it. Structured fields go in the frontmatter; the
  human narrative goes in the body.
- **Git is the source of truth.** Every change is a commit. There is no database.
  History *is* the log — write clear commits and push when you are done.
- The same files feed a small web app with three roles (owner, crew, guest). The
  app **redacts cost data server-side for crew and guests**, so what you write
  has real privacy consequences (see ground rule 3 below).

## 2. File layout

At the repo root:

- `boat.yaml` — the singleton boat config: identity, specs, and the welcome-page
  briefing (rules, what-to-expect, what-to-bring, safety). This is the one file a
  new owner edits to make the log theirs. **No money ever lives here.**
- `quickref.yaml` — short cheat-sheet cards (reefing, MOB, VHF distress…). Each is
  `{ id: qr-<slug>, title, body? }`. An empty list is valid.
- `photos/` — compressed images referenced by `photos:` arrays in records. Drop a
  photo here and reference it by its `photos/<file>.jpg` path.
- `examples/` — one commented worked example per collection. The app **never**
  loads `examples/`; it is documentation only. Copy a file out of here to start a
  new record.

The six record collections, one directory each:

| Directory | Holds | Id prefix |
| --- | --- | --- |
| `trips/` | Logged sails / outings | `t-` (`t-YYYY-MM-DD`) |
| `maintenance/` | Jobs: done, due, scheduled, overdue | `m-` |
| `costs/` | Spend records — **owner-only** | `c-` |
| `vendors/` | Contacts: yards, lofts, riggers | `v-` |
| `inventory/` | Gear, spares, safety equipment | `inv-` |
| `manuals/` | Manual metadata (and the real PDF/text) | `man-` |

Each directory name is also the app's URL path and its data key — they are one and
the same, so never rename a directory. See `SCHEMA.md` for every field of every
collection, the id rules, and the cross-link table.

## 3. Ground rules

1. **Partial entries are first-class.** A record does not need to be complete to be
   committed. A trip may be a date and a paragraph of body text with no waypoints,
   no findings, no numbers — that is a perfectly valid trip. Capture what is real;
   leave the rest blank. The only hard requirements are the few fields `SCHEMA.md`
   marks *required* (e.g. a trip needs an `id` and a real `date`; a maintenance
   item needs an `id`, `title`, and `status`).

2. **Never invent measurements or specs.** Do not fabricate a distance, an engine
   hour, a wind speed, a part number, or a dimension you do not actually know.
   Leave the field out, or note the unknown in the body ("distance not logged").
   A blank field is honest; a guessed number corrupts the log. The same goes for
   the boat's specs and for any figure you would otherwise "round to look right."

3. **Costs are owner-sensitive — keep money out of crew-facing narrative.** The
   entire `costs/` collection is owner-only, and `maintenance.costEst` is a money
   field; the app **redacts** both for crew and guests. So:
   - Put dollar amounts only where the schema puts them: a `costs/` record's
     `amount`, or `maintenance.costEst`. Never anywhere else.
   - **Do NOT write a dollar amount into a trip narrative, a finding, or a
     maintenance body** — those are read by crew, and redaction cannot reach prose.
     "Replaced the jib halyard" belongs in the trip; "$92.50 for the new line"
     belongs only in a `costs/` record's `amount`.
   - When in doubt, record the spend as a `costs/` record and cross-link it; never
     leak the number into a crew-readable field.

4. **Preserve human-readable ids and existing cross-links.** Ids are meaningful
   (`m-jib-halyard`, not a random hash) and are referenced from other records.
   Do not rename or renumber an existing record's `id`, and do not break a link.
   The cross-links that must always resolve (full list in `SCHEMA.md`):
   - a trip finding's `findings[].maintId` → a `maintenance` record
   - `maintenance.vendorId` → a `vendor`; `maintenance.fromTripId` → a `trip`
   - `cost.vendorId` → a `vendor`; `cost.maintId` → a `maintenance` record

   When you add a new record, derive its id the way the app does: `t-<date>` for a
   trip; otherwise `<prefix>` + a lowercase slug of the record's title/name/item
   (e.g. `m-replace-jib-halyard`), appending `-2`, `-3`… only on a collision.

5. **Keep frontmatter valid — the app fails loud.** The loader validates every
   record on load and **refuses to start** on a single invalid one. Match the
   schema exactly: real `YYYY-MM-DD` dates (not `Today`, not a slashy format),
   numbers as numbers (not quoted), enum values spelled exactly as `SCHEMA.md`
   lists them. After editing, sanity-check the YAML parses and the dates are real.

## 4. The research-and-write workflow

This is the flow you run to finish a half-written log entry. (A skill automates it;
this is the same flow written out for hands-on use.)

1. **Read what's there.** Open the half-written trip in `trips/`. Read its body and
   frontmatter. Open every photo it references in `photos/` and look at them — they
   often show the thing the entry is about (a frayed halyard, a fitting, a sail).

2. **Research the issue — web *and* the boat's own manuals.** If the entry mentions
   a problem (chafe, a leak, an engine fault), research the fix. Use the web for
   general technique, **and** read the boat's own documentation in `manuals/` (the
   `man-…` records and any real PDF/text alongside them) for the specifics of *this*
   boat's gear. The manuals are there precisely so you can research against them.

3. **Write the trip narrative in the body.** Fill in the body with what happened —
   conditions, route, what was noticed. Add the structured fields you actually know
   (waypoints, distance, crew) and leave unknowns blank (ground rule 2). Keep money
   out of the narrative (ground rule 3).

4. **Open or refresh the linked maintenance item.** If the trip surfaced a problem,
   make sure there is a `maintenance/` record for it, and link the trip's finding to
   it with `findings[].maintId`. On the maintenance record, set `fromTripId` back to
   the trip and a sensible `status` (`overdue` / `due` / `scheduled` / `done`); add
   research notes / a steps checklist in the body. If you have a cost figure, record
   it as a `costs/` record (or `costEst`), **not** in the narrative.

5. **Commit with a clear message, then push.** Commit the record edits and any new
   photos together with a message that says what you did (see §5). Then push so the
   app picks it up on its next pull.

## 5. Commit conventions & doc upkeep

- **Commit in coherent units** with a present-tense, descriptive subject. Examples:
  `trip(t-2026-06-14): write narrative + link jib-halyard finding` ·
  `maintenance(m-jib-halyard): open from shakedown, add steps` ·
  `costs: record new halyard line + splice`. Reference the record id so history is
  searchable. Commit a record edit and the photos it references together.
- **Never** commit secrets or a `users.json`; those are app deployment state and do
  not belong in the data repo. Keep photos compressed.
- **Doc-upkeep:** if you change a convention, a directory's meaning, or the field
  set, update this `AGENTS.md` and `SCHEMA.md` in the **same** commit so the next
  agent (and the next human) is never working from stale instructions. Treat "are
  AGENTS.md and SCHEMA.md still correct?" as part of finishing the change.
