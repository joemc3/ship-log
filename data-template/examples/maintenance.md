<!--
EXAMPLE — maintenance record. Copy into ../maintenance/ as `m-<slug>.md`, then
UNCOMMENT the frontmatter and fill it in. NEVER loaded from here.

id: derived server-side as `m-<slug-of-title>` (collisions get -2, -3, …).
Required: id, title, status. status is one of: overdue | due | scheduled | done.

OWNER-SENSITIVE: `costEst` is a money field. It is redacted server-side for
crew/guest and must never appear in a crew-facing trip narrative. Leave it off
unless you are the owner tracking budget.

Cross-links (each must resolve if set):
  vendorId   → a vendor id (v-…)
  fromTripId → the trip id (t-…) this job came out of
completed: a date or null. opened/due/completed are real YYYY-MM-DD dates.
photos[] are `photos/<file>.jpg` paths. Body = the work narrative / checklist.
-->

<!--
---
id: m-jib-halyard
title: Replace jib halyard (chafe at masthead)
system: Rigging
status: scheduled
priority: 2
opened: 2026-06-14
due: 2026-07-15
completed: null
costEst: 90        # OWNER-ONLY money field — redacted for crew/guest
vendorId: v-sailloft
fromTripId: t-2026-06-14
photos:
  - photos/m-jib-halyard-fray.jpg
---

Halyard is chafing where it exits the masthead sheave. Replace with new line and
re-splice the shackle.

## Steps
- [ ] Measure and order new halyard.
- [ ] Run a messenger, rove the new line.
- [ ] Splice the shackle, re-lead to the winch.
-->
