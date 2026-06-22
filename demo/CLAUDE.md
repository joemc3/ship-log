# CLAUDE.md — read me first

**You are in a DATA repo, not an app.** This folder holds one boat's log book for
a **Ship's Log** deployment — the private data half of a **two-repo system**.
Understand this before doing anything:

- **This repo (your `<boat>-log`)** — the boat's data only: `boat.yaml`, `trips/`,
  `maintenance/`, `costs/`, `inventory/`, `vendors/`, `manuals/`, `photos/`, and
  the optional `conditions.md`. Plain Markdown with YAML frontmatter, **one record
  per file**, and **git is the source of truth** — there is no database and no
  server in here.
- **The app repo (`github.com/joemc3/ship-log`)** — the open-source "Ship's Log"
  web app (TypeScript). It is *code only, no boat data*. It clones THIS repo,
  serves it to owner / crew / guest roles, and is the only thing that writes back
  to it through the app. You never touch the app repo from here, and you never
  call its API.

**How your edits reach the boat:** you work on this git clone — edit files,
`git commit`, `git push`. The running app pulls on a timer and converges. That is
the whole loop; there is no other channel.

**Before you change anything, read these two files — they are the contract:**

- **`AGENTS.md`** — ground rules, file layout, and the research-and-write workflow.
- **`SCHEMA.md`** — every field, the id/slug rules, the cross-link table, and the
  owner-only cost rules. The app's loader **fails loud** — one invalid record and
  it refuses to start — so match the schema exactly.

**The rule worth repeating up front:** costs are **owner-only**, redacted
server-side for crew and guests. Never put a dollar amount in any crew-facing
field (a trip body, a finding, a maintenance body). Money lives *only* in a
`costs/` record's `amount` or in `maintenance.costEst`.

**Skills in this repo** (`.claude/skills/`): **`complete-trip`** finishes a
half-written trip log (research → narrative → linked maintenance item);
**`update-conditions`** refreshes `conditions.md` (weather + tides). Use them when
the task fits.

**Note on collaborators:** a cheap Hermes agent also writes into this repo (often
from dictation) and makes mistakes. Part of the job is reviewing and finishing its
entries — verify its findings against what actually happened rather than trusting
them.
