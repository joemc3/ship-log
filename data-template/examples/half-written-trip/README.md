# Worked example — a half-written trip the `complete-trip` skill finishes

This folder is a **fixture for the `complete-trip` Cowork skill** (see
`../../.claude/skills/complete-trip/SKILL.md`). It mimics the real starting
state: a crew member typed a few lines into a trip on their way back to the dock
and dropped in a photo, leaving the entry for Cowork to finish. Like everything
under `examples/`, **the app never loads this folder** — it is documentation and
a test fixture only, not a live record.

## What's here

- `t-2026-06-14.md` — the **half-written trip**. It has the bare minimum
  (`id`, `date`), a `title`, `crew`, one `photo`, and a single **finding with no
  `maintId`** (the linked maintenance item does not exist yet). The body is a
  single throwaway line. This is a *valid* trip — partial entries are first-class
  (see `AGENTS.md`) — but it is not *finished*.
- `photos/t-2026-06-14-01.jpg` — the **photo placeholder** the finding refers to.
  In a real run Cowork opens and looks at this image before writing.
- `manuals/man-engine.md` — **real reference text** for *this boat's* raw-water
  cooling and impeller service. It is here so the "research the fix against the
  boat's own `manuals/`" step has something concrete to grep and cite. (In a live
  data repo this lives in the top-level `manuals/`, not under `examples/`.)

## What a correct skill run produces

Running `complete-trip` against `t-2026-06-14` should:

1. Read `AGENTS.md` then `SCHEMA.md`, open the trip, and **look at the photo**.
2. Research the overheat: web technique **and** grep `manuals/` — the engine
   manual above points straight at a worn raw-water impeller.
3. Write a real trip **narrative** into the body (conditions, route, what was
   noticed) — **without** any dollar figure, since the crew read the trip.
4. Set the finding's `severity` and a `maintId` pointing at a new maintenance
   record, and create `maintenance/m-replace-raw-water-impeller.md` with
   `status`, `system`, `opened`, `due`, **and the two-way cross-link**:
   `fromTripId: t-2026-06-14` on the maintenance side, `maintId:
   m-replace-raw-water-impeller` on the trip finding — so both directions resolve
   (see `SCHEMA.md`'s cross-link table).
5. Commit and push on the **git clone** — never through the running app's API.

The `skill-output-contract` test (`test/data/skill-output-contract.test.ts`)
hand-builds exactly those two finished records and proves they pass the Zod
schemas, that `checkLinkIntegrity` reports zero broken links, that `deriveId`
mints the very maintenance id the skill is told to mint, and that the
maintenance record carries no monetary field (a crew-authored completion never
introduces a `costEst`).
