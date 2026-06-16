<!--
EXAMPLE — cost record. Copy into ../costs/ as `c-<slug>.md`, then UNCOMMENT the
frontmatter and fill it in. NEVER loaded from here.

OWNER-ONLY COLLECTION: the entire costs collection is owner-only. Every cost
record (and the `amount` field) is redacted server-side so crew/guest never see
it. Do not reference money from a crew-facing trip or maintenance narrative.

id: derived server-side as `c-<slug-of-item>` (collisions get -2, -3, …).
Required: id, date (real YYYY-MM-DD), item, amount (a number — the money field).

Cross-links (each must resolve if set):
  vendorId → a vendor id (v-…)
  maintId  → the maintenance id (m-…) this spend was for
Cost records usually have no body.
-->

<!--
---
id: c-jib-halyard
date: 2026-06-20
category: Rigging
item: New jib halyard line + shackle splice
amount: 92.5       # OWNER-ONLY money field — redacted for crew/guest
vendorId: v-sailloft
maintId: m-jib-halyard
---
-->
