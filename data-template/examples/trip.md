<!--
EXAMPLE — trip record. Copy into ../trips/ as `t-YYYY-MM-DD.md`, then UNCOMMENT
the frontmatter (the block between the --- fences) and fill it in.

Files in this examples/ dir are NEVER loaded by the app — they exist only to
show the shape. Records live one-per-file directly in trips/.

id: derived server-side as `t-<date>` (collisions get -2, -3, …). If you author
by hand, match that: `t-2026-06-14`. The filename is `<id>.md`.

Required: id, date (a real YYYY-MM-DD calendar date). Everything else optional.
waypoints[].type is one of: depart | anchor | arrive | waypoint.
findings[].severity is one of: low | medium | high (optional).
findings[].maintId must point at a real maintenance id (m-…) if set.
photos[] are `photos/<file>.jpg` paths. The body below the frontmatter is the
free Markdown trip narrative.
-->

<!--
---
id: t-2026-06-14
title: Shakedown sail
date: 2026-06-14
durationHrs: 3.5
distanceNm: 8.2
engineHrs: 0.5
sky: Clear
wind: SW 8-12 kt
seas: light chop
tempF: 68
crew: [Skipper, First Mate]
waypoints:
  - { name: Home Marina, type: depart, time: "10:00" }
  - { name: The Point, type: waypoint, time: "11:30", note: "Hove-to for lunch." }
  - { name: Home Marina, type: arrive, time: "13:30" }
findings:
  - { text: "Jib halyard showing chafe at the masthead.", severity: medium, maintId: m-jib-halyard }
photos: [photos/t-2026-06-14-reach.jpg]
---

A short shakedown after winter lay-up. Motored out of the fairway, hoisted in
the bay, and reached to The Point and back. Noted chafe on the jib halyard —
squawked it for the maintenance list.
-->
