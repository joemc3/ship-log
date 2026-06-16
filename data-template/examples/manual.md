<!--
EXAMPLE — manual record. Copy into ../manuals/ as `man-<slug>.md`, then
UNCOMMENT the frontmatter and fill it in. NEVER loaded from here.

id: derived server-side as `man-<slug-of-title>` (collisions get -2, -3, …).
Required: id, title. Everything else optional.

`file` points at a PDF you drop alongside in manuals/ (e.g. manuals/engine.pdf).
sections[] is a list of { title, anchor? } — `anchor` matches a `{#anchor}`
heading in the body so the UI can deep-link. Body = a Markdown quick index.
-->

<!--
---
id: man-engine
title: Engine Owner's Manual
kind: engine
file: manuals/engine.pdf
sections:
  - { title: Winterizing, anchor: winterize }
  - { title: Fuel system, anchor: fuel }
---

Quick index for the engine. Keep a printed copy at the nav station.

## Winterizing {#winterize}

Drain the raw-water side and run antifreeze through the cooling loop until it
runs pink at the exhaust.

## Fuel system {#fuel}

Carry two spare primary filter elements. Bleed at the secondary filter after any
filter change or run-dry.
-->
