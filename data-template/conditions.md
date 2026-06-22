---
# Conditions feed for the all-access Conditions page (weather + tides).
# Pick ONE source:
#   source: api    -> the app fetches live weather (Open-Meteo) + tides (NOAA, US only)
#   source: agent  -> a Cowork/Hermes agent fills weather+tides on a cron (see
#                     .claude/skills/update-conditions). Works worldwide.
source: api
location:
  label: "Home port"      # human-readable area shown on the page
  lat: 0.0                 # decimal degrees; drives the weather fetch
  lon: 0.0
tides:
  # Curated NOAA CO-OPS station ids, nearest first. Look stations up at
  # https://tidesandcurrents.noaa.gov/  (US only). Mark the nearest primary: true.
  stations: []
    # - { id: "0000000", name: "Nearest station", area: "Home Harbor", primary: true }
    # - { id: "0000001", name: "Up the river",   area: "North River" }
# In agent mode the agent ALSO writes weather.periods and tides.predictions here;
# in api mode leave them out — the server fills them. Full worked agent-mode
# example: see SCHEMA.md (Conditions section).
---

<!-- Optional free-text "conditions note" (rendered as Markdown on the page). -->
