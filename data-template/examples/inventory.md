<!--
EXAMPLE — inventory record. Copy into ../inventory/ as `inv-<slug>.md`, then
UNCOMMENT the frontmatter and fill it in. NEVER loaded from here.

id: derived server-side as `inv-<slug-of-name>` (collisions get -2, -3, …).
Required: id, name. Everything else optional.

The date fields drive the dashboard's "due" views (real YYYY-MM-DD dates):
  inspect → next inspection due
  service → next service due
  expires → expiry date (flares, fire extinguishers, EPIRB battery, …)
count/level/condition describe stock and state. photos[] are `photos/…` paths.
Body = where it lives and how to check it.
-->

<!--
---
id: inv-fire-ext
name: Fire extinguisher (companionway)
category: Safety
location: Companionway steps, port side
count: 1
condition: charged
inspect: 2027-01-01
expires: 2031-01-01
photos:
  - photos/inv-fire-ext.jpg
---

5-lb ABC dry-chemical extinguisher by the companionway steps. Monthly visual
check (pin, seal, gauge). Annual inspection tag due at the inspect date.
-->
