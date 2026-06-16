# SCHEMA.md — the Ship's Log data model

This is the contract every record in this data repo must satisfy. It mirrors the
app's Zod schemas exactly (`src/data/schema.ts` in the app repo); a drift-guard
test checks this document against the code descriptor, so what you read here is
what the app actually enforces on load. When you (or Cowork) author or edit a
record by hand, match this and the app will accept it; break it and the loader
**fails loud** — it validates every record and refuses to start on a bad one.

This file is authored canonically in `data-template/SCHEMA.md` and byte-copied to
`demo/SCHEMA.md`; do not edit one copy without the other (a test enforces it).

---

## How records are stored

- **One file per record**, Markdown with a YAML frontmatter block between `---`
  fences. Structured fields go in the frontmatter; free narrative goes in the
  body below the closing fence.
- A record lives in its collection's directory, named `<id>.md`. The
  collection directory is also the REST path segment in the app.
- `boat.yaml` and `quickref.yaml` are **YAML singletons** at the repo root, not
  per-record collections.
- The loader scans only the collection directories below. Anything under
  `examples/` is **never loaded** — those are commented, copy-me templates.

| Collection   | Directory      | Id prefix | Id slug source field |
| ------------ | -------------- | --------- | -------------------- |
| trip         | `trips/`       | `t-`      | `date`               |
| maintenance  | `maintenance/` | `m-`      | `title`              |
| cost         | `costs/`       | `c-`      | `item`               |
| vendor       | `vendors/`     | `v-`      | `name`               |
| inventory    | `inventory/`   | `inv-`    | `name`               |
| manual       | `manuals/`     | `man-`    | `title`              |
| quickref     | `quickref.yaml` (singleton list) | `qr-` | `title` (hand-set) |
| boat         | `boat.yaml` (singleton)          | — (no id) | —          |

Dates everywhere are **`isoDate`**: a bare `YYYY-MM-DD` string that must be a
**real calendar date**. `2026-02-30` or `2026-13-01` are rejected. Keep them
quoted-free in YAML (the parser keeps them as strings, not `Date` objects).

---

## ID rules

IDs are **normally derived server-side** when a record is created through the app
— you rarely type one. But Cowork authors files directly in the clone, so author
the id to match exactly what the app would have produced, and name the file
`<id>.md`:

- **trips:** `t-<date>`, e.g. a trip on 2026-06-14 → `t-2026-06-14`. If that id is
  already taken (two trips the same day), append a numeric suffix: the second is
  `t-2026-06-14-2`, the third `t-2026-06-14-3`, and so on.
- **everything else:** `<prefix><slug-of-source-field>`:
  - maintenance → `m-` + slug of `title`
  - cost → `c-` + slug of `item`
  - vendor → `v-` + slug of `name`
  - inventory → `inv-` + slug of `name`
  - manual → `man-` + slug of `title`
  - On collision, append `-2`, `-3`, … just like trips.
- **quickref cards:** `qr-<slug>`, hand-set inside `quickref.yaml` (not derived).

**Slugify rule** (exactly what the app does): lowercase the source; turn runs of
whitespace and underscores into a single `-`; drop every character that is not
`a-z`, `0-9`, or `-`; collapse repeated `-`; trim leading/trailing `-`. If the
result is empty (e.g. a title of only punctuation), the app refuses to derive an
id — give the record a real `title`/`name`/`item`.

Example: a maintenance `title: "Replace jib halyard (chafe!)"` →
`m-replace-jib-halyard-chafe`.

---

## Cross-links

Some fields point at another record by its id. **Every cross-link that is set
must resolve to a real record of the target collection** — the loader checks link
integrity and **broken links are reported** (a dangling reference is flagged, not
silently ignored). The full set of cross-links:

| From record  | Field              | Must point at a … |
| ------------ | ------------------ | ----------------- |
| trip         | `findings[].maintId` | maintenance id (`m-…`) |
| maintenance  | `vendorId`         | vendor id (`v-…`) |
| maintenance  | `fromTripId`       | trip id (`t-…`)   |
| cost         | `vendorId`         | vendor id (`v-…`) |
| cost         | `maintId`          | maintenance id (`m-…`) |

A cross-link field may be **omitted** (it is always optional) — a finding with no
linked maintenance item yet is fine. But if you set it, the target must exist.
When you create the linked record in the same pass, create the target first (or
in the same commit) so the link is never dangling at load time.

---

## Money is owner-only — never echo it

The **entire `cost` collection is owner-only**, and `maintenance.costEst` is a
monetary field. These are the registered monetary fields:

- `maintenance.costEst`
- the whole `costs/` collection (every cost record, including its `amount`)

The app **redacts these server-side** for the `crew` and `guest` roles — they are
stripped from responses and from the search index, not merely hidden in the UI.
For Cowork this means: **never echo a dollar amount, a `costEst`, or any cost
record into a crew-facing narrative** (a trip body, a maintenance body, a
finding). If you research a repair cost, keep it in the owner-only cost record;
do not write "this will run about $300" into the trip log the crew reads. When
you add any new cost-bearing field, it must be registered as monetary in the same
change.

---

## Collections, field by field

Legend: **required** fields must be present; everything else is optional. `date`
columns are `isoDate` (`YYYY-MM-DD`, real calendar date).

### trip — `trips/t-<date>.md`

| Field         | Type                     | Req | Notes |
| ------------- | ------------------------ | --- | ----- |
| `id`          | string                   | yes | `t-<date>` (`-2`/`-3` on collision) |
| `date`        | isoDate                  | yes | the trip date; also the id source |
| `title`       | string                   | no  | |
| `durationHrs` | number                   | no  | hours underway |
| `distanceNm`  | number                   | no  | distance in nautical miles |
| `engineHrs`   | number                   | no  | engine hours run |
| `sky`         | string                   | no  | |
| `wind`        | string                   | no  | |
| `seas`        | string                   | no  | |
| `tempF`       | number                   | no  | |
| `crew`        | string[]                 | no  | crew names |
| `waypoints`   | waypoint[]               | no  | see below |
| `findings`    | finding[]                | no  | see below |
| `photos`      | string[]                 | no  | `photos/<id>-NN.jpg` paths |

**waypoint** (each item of `waypoints[]`): `name` (string, required), `type`
(enum, required) one of **`depart` | `anchor` | `arrive` | `waypoint`**, `time`
(string, optional), `note` (string, optional).

**finding** (each item of `findings[]`): `text` (string, required), `severity`
(enum, optional) one of **`low` | `medium` | `high`**, `maintId` (optional,
cross-link → maintenance).

The trip **body** is the free-form narrative — often the *only* content a
half-written entry has. Completing that narrative (and the photos/findings around
it) is the core Cowork job.

### maintenance — `maintenance/m-<slug-of-title>.md`

| Field        | Type                  | Req | Notes |
| ------------ | --------------------- | --- | ----- |
| `id`         | string                | yes | `m-<slug-of-title>` |
| `title`      | string                | yes | id source |
| `status`     | enum                  | yes | **`overdue` \| `due` \| `scheduled` \| `done`** |
| `system`     | string                | no  | e.g. Rigging, Engine, Electrical |
| `priority`   | integer               | no  | whole number |
| `opened`     | isoDate               | no  | |
| `due`        | isoDate               | no  | |
| `completed`  | isoDate \| null       | no  | date completed, or `null` |
| `costEst`    | number — **MONETARY** | no  | **owner-only**; redacted for crew/guest |
| `vendorId`   | string                | no  | cross-link → vendor (`v-…`) |
| `fromTripId` | string                | no  | cross-link → trip (`t-…`) |
| `photos`     | string[]              | no  | `photos/<id>-NN.jpg` paths |

`completed` may be the literal `null` (job not done) or a real date. The body is
the work narrative / checklist. **`costEst` is a money field — never surface it to
crew.**

### cost — `costs/c-<slug-of-item>.md` — OWNER-ONLY COLLECTION

| Field      | Type                  | Req | Notes |
| ---------- | --------------------- | --- | ----- |
| `id`       | string                | yes | `c-<slug-of-item>` |
| `date`     | isoDate               | yes | |
| `item`     | string                | yes | id source |
| `amount`   | number — **MONETARY** | yes | the money figure |
| `category` | string                | no  | |
| `vendorId` | string                | no  | cross-link → vendor (`v-…`) |
| `maintId`  | string                | no  | cross-link → maintenance (`m-…`) |

**Every cost record is owner-only** and redacted server-side for crew/guest. Cost
records usually have no body. Do not reference a cost record's money from any
crew-facing narrative.

### vendor — `vendors/v-<slug-of-name>.md`

| Field      | Type     | Req | Notes |
| ---------- | -------- | --- | ----- |
| `id`       | string   | yes | `v-<slug-of-name>` |
| `name`     | string   | yes | id source |
| `phone`    | string   | no  | |
| `email`    | string   | no  | |
| `address`  | string   | no  | |
| `url`      | string   | no  | |
| `services` | string[] | no  | free list of services offered |

Body = free notes about the vendor.

### inventory — `inventory/inv-<slug-of-name>.md`

| Field       | Type     | Req | Notes |
| ----------- | -------- | --- | ----- |
| `id`        | string   | yes | `inv-<slug-of-name>` |
| `name`      | string   | yes | id source |
| `category`  | string   | no  | |
| `location`  | string   | no  | where it lives aboard |
| `count`     | number   | no  | quantity on hand |
| `level`     | string   | no  | stock level |
| `condition` | string   | no  | state, e.g. charged, good |
| `inspect`   | isoDate  | no  | next inspection due |
| `service`   | isoDate  | no  | next service due |
| `expires`   | isoDate  | no  | expiry date |
| `photos`    | string[] | no  | `photos/<id>-NN.jpg` paths |

The three date fields — **`inspect`, `service`, `expires`** — drive the
dashboard's derived "needs attention" tasks (see Derived logic). Body = where it
lives and how to check it.

### manual — `manuals/man-<slug-of-title>.md`

| Field      | Type        | Req | Notes |
| ---------- | ----------- | --- | ----- |
| `id`       | string      | yes | `man-<slug-of-title>` |
| `title`    | string      | yes | id source |
| `kind`     | string      | no  | e.g. engine, rigging, electrical |
| `file`     | string      | no  | repo-relative path to a PDF/text file, e.g. `manuals/engine.pdf` |
| `sections` | section[]   | no  | quick index into the body / `file` |

**section** (each item of `sections[]`): `title` (string, required), `anchor`
(string, optional). An `anchor` matches a `{#anchor}` heading in the Markdown
body so the UI can deep-link.

Manuals **may also hold the real manual text or a PDF** alongside the record:
drop the file in `manuals/` and point `file:` at it (e.g. `manuals/engine.pdf`).
Cowork can read that file to **research a fix against the actual manual** rather
than guessing.

---

## Singletons

### boat.yaml

The one file a new owner edits to make the app theirs. `name` is **required**;
everything else is optional.

| Field         | Type                              | Req | Notes |
| ------------- | --------------------------------- | --- | ----- |
| `name`        | string                            | yes | vessel name, shown everywhere |
| `make`        | string                            | no  | builder |
| `model`       | string                            | no  | quote numeric-looking values |
| `year`        | number                            | no  | build year (a number, not a string) |
| `hailingPort` | string                            | no  | |
| `specs`       | record<string, string \| number> | no  | free key/value specs (loa, beam, draft, engine, …) |
| `welcome`     | object                            | no  | crew/guest welcome-page content |

`welcome` holds: `rules` (string[]), `whatToExpect` (string), `whatToBring`
(string[]), `safety` (string) — all optional. **No money ever lives in
`boat.yaml`.**

### quickref.yaml

A YAML **list** of short cheat-sheet cards. An empty list (or a missing file) is
valid. Each card: `id` (`qr-<slug>`, required), `title` (string, required),
`body` (string, optional).

---

## Photos convention

Photos live in `photos/` at the repo root as compressed JPEGs. A record references
them by **repo-relative path** in its `photos[]` array, named
**`photos/<id>-NN.jpg`** — the owning record's id plus a two-digit sequence, e.g.
`photos/t-2026-06-14-01.jpg`, `photos/m-jib-halyard-01.jpg`. When the app ingests
an upload it compresses (longest edge ≤ 2048 px, JPEG) and content-addresses the
file; when Cowork adds a photo by hand, drop the JPEG in `photos/`, keep it
reasonably small, and reference it with the same path convention. Because the
photos are in the repo, Cowork sees the images directly in the clone — look at
them when completing a trip entry.

---

## Derived logic (what the app computes; do not store it)

These are **computed at read time** from the fields above — never write them into
a record:

- **Inventory tasks.** Each inventory `inspect`, `service`, and `expires` date
  produces a task: **overdue** if the date is in the past, **due** if it falls
  within the next **30** days (the due window), otherwise nothing.
- **Maintenance attention.** Maintenance whose `status` is **`overdue`** or
  **`due`** counts toward the dashboard's attention rollup / badge.
- **Search** runs across all collections — but the owner-only/monetary data is
  redacted out of the crew/guest haystack, so a crew search can never surface a
  cost or a `costEst`.

"Today" is the real current date. Keep `due`/`expires`/`inspect`/`service` dates
honest and the derived views take care of themselves.
