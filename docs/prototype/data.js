/* ============================================================
   Valkyrie — Ship's Log sample data
   1985 Catalina 25. Realistic mockup content (no real saving).
   Exposed as window.DATA
   ============================================================ */
window.DATA = {
  boat: {
    name: "Valkyrie",
    model: "Catalina 25",
    year: 1985,
    rig: "Masthead sloop",
    hin: "CTYK1985L485",
    sailNumber: "4187",
    loa: "25 ft 0 in",
    lwl: "22 ft 2 in",
    beam: "8 ft 0 in",
    draft: "4 ft 0 in (fin keel)",
    displacement: "4,550 lb",
    ballast: "1,900 lb",
    sailArea: "261 sq ft",
    engine: "Tohatsu 9.8 HP 4-stroke outboard",
    fuel: "Gasoline · 3.2 gal portable tank",
    hailingPort: "Mariner's Cove",
    homePort: "Mariner's Cove Marina · Slip C-14",
    lat: "41\u00B029.6\u2032 N",
    lon: "082\u00B011.3\u2032 W",
    owner: "The crew of Valkyrie",
    since: "Spring 2023",
    blurb: "Valkyrie is a 1985 Catalina 25 \u2014 a proper little project boat that floats, sails, and gets a touch better every single day. She's an honest, forgiving day-sailor: stable, simple, and happiest with a light crew and a steady breeze.",
    tagline: "She floats, she sails, and she gets better every day."
  },

  /* House rules shown on the welcome page */
  rules: [
    { icon: "shoe", title: "Soft soles only", text: "Non-marking, light-colored soles or bare feet on deck. Black soles leave scuffs we can't get out, and heels punch right through gelcoat \u2014 so leave the heels on the dock." },
    { icon: "shirt", title: "Dress for the water, not the dock", text: "Layers you can move in, a hat, and sunglasses with a strap. It's always cooler and brighter on the water than it looks from shore. Bring a windbreaker even on warm days." },
    { icon: "bottle", title: "Bring a share for the boat", text: "Drinks are welcome aboard. The tradition is simple: bring a little extra to share with the boat and her crew \u2014 it's about generosity afloat, not topping anyone up. A cold six-pack or a thermos of something hot both count." },
    { icon: "heart", title: "Feeling off? Speak up early", text: "Seasickness is no big deal and nothing to be embarrassed about \u2014 it happens to seasoned sailors too. The sooner you say something, the faster we can change course, ease the motion, or get you to the rail or to shore. There is zero shame in it." }
  ],

  expect: [
    { title: "A relaxed pace", text: "This is a day-sailor, not a race boat. We go where the wind is friendly, anchor for lunch, and are usually back at the slip before sunset." },
    { title: "You'll be asked to help (a little)", text: "Hauling a line or holding a course is part of the fun. No experience needed \u2014 we'll show you everything and you can do as much or as little as you like." },
    { title: "Close quarters", text: "She's 25 feet. Pack light, soft bags only (no hard suitcases), and expect to share a small, cozy cockpit with good company." },
    { title: "Weather calls the shots", text: "We watch the forecast closely and will reschedule for wind, storms, or no wind at all. Safety and fun come before any plan on the calendar." }
  ],

  bring: [
    "Soft-soled, light shoes (or bare feet)",
    "Sunscreen, hat & strapped sunglasses",
    "A light windbreaker or layer",
    "Water bottle",
    "A share of drinks for the boat",
    "Any meds you might need (incl. for seasickness)"
  ],

  safety: [
    "Life jackets for everyone, sized and aboard",
    "Briefing before we leave the slip \u2014 head, lines, and the \u2018what-ifs\u2019",
    "VHF radio, flares, and first-aid kit aboard",
    "Skipper has final say on weather and plan"
  ],

  trips: [
    {
      id: "t-2024-06-22",
      title: "Shakedown to Gull Point",
      date: "2024-06-22",
      durationHrs: 5.5,
      distanceNm: 11.4,
      engineHrs: 1.2,
      sky: "Sunny, high cirrus",
      wind: "SW 10\u201314 kt",
      seas: "1 ft chop",
      tempF: 74,
      crew: ["Skipper", "Dana R.", "Marco P."],
      waypoints: [
        { name: "Mariner's Cove Marina", type: "depart", time: "10:15", note: "Motored out of the fairway, sails up past the breakwater." },
        { name: "Channel Marker R\u20142", type: "mark", time: "10:40", note: "Bore away onto a beam reach, killed the engine here." },
        { name: "Gull Point anchorage", type: "anchor", time: "12:20", note: "Anchored in 9 ft over sand for lunch. Good holding." },
        { name: "Mariner's Cove Marina", type: "arrive", time: "15:45", note: "Close reach home, docked under sail to the slip." }
      ],
      summary: "First proper sail of the season. She handled the building afternoon breeze beautifully on a reach. New crew got hands-on with the jib sheets and loved it. Anchor set first try.",
      findings: [
        { text: "Jib halyard is frayed just below the shackle \u2014 a few broken strands. Watch it / replace before next sail.", severity: "high", maintId: "m-jib-halyard" },
        { text: "Cabin lights flickering on the port side \u2014 likely a loose ground.", severity: "med", maintId: "m-cabin-light" }
      ],
      photoCount: 6
    },
    {
      id: "t-2024-07-06",
      title: "Sunset cruise with the Hendersons",
      date: "2024-07-06",
      durationHrs: 3.0,
      distanceNm: 6.1,
      engineHrs: 0.8,
      sky: "Clear, golden evening",
      wind: "W 6\u20139 kt",
      seas: "Calm",
      tempF: 71,
      crew: ["Skipper", "Jo Henderson", "Paul Henderson", "Dana R."],
      waypoints: [
        { name: "Mariner's Cove Marina", type: "depart", time: "18:30", note: "Easy departure, light air, full main and genoa." },
        { name: "West Shoal", type: "mark", time: "19:25", note: "Drifted along the shoal watching the sun go down." },
        { name: "Mariner's Cove Marina", type: "arrive", time: "21:30", note: "Motored the last stretch in after dark, nav lights on." }
      ],
      summary: "Gentle evening sail. First-timers aboard \u2014 calm water made for a perfect introduction. Cracked the cabin lights issue (see findings) on the way in.",
      findings: [
        { text: "Confirmed port cabin light ground is corroded at the panel. Same item from 6/22.", severity: "med", maintId: "m-cabin-light" }
      ],
      photoCount: 9
    },
    {
      id: "t-2024-07-20",
      title: "Solo bay loop",
      date: "2024-07-20",
      durationHrs: 4.0,
      distanceNm: 9.0,
      engineHrs: 0.5,
      sky: "Partly cloudy",
      wind: "NW 12\u201316 kt, gusty",
      seas: "1\u20132 ft",
      tempF: 69,
      crew: ["Skipper"],
      waypoints: [
        { name: "Mariner's Cove Marina", type: "depart", time: "09:00", note: "Single-reefed the main at the dock given the forecast." },
        { name: "North Buoy N\u20144", type: "mark", time: "10:10", note: "Beat upwind in a building breeze. Boat felt great reefed." },
        { name: "Mariner's Cove Marina", type: "arrive", time: "13:00", note: "Quick run home. Noticed water in the bilge on return." }
      ],
      summary: "Spirited solo sail to test reefing and self-tacking. She balances nicely with one reef in. Found some water in the bilge afterward \u2014 tracing the source.",
      findings: [
        { text: "Standing water in the bilge after a dry week \u2014 suspect the port stanchion base is leaking at the deck.", severity: "med", maintId: "m-stanchion" },
        { text: "Bilge pump float switch is sluggish to trigger.", severity: "low", maintId: "m-bilge-switch" }
      ],
      photoCount: 3
    },
    {
      id: "t-2024-08-10",
      title: "Lunch hop to Cedar Island",
      date: "2024-08-10",
      durationHrs: 6.0,
      distanceNm: 14.2,
      engineHrs: 1.0,
      sky: "Hazy sun",
      wind: "S 8\u201312 kt",
      seas: "1 ft",
      tempF: 78,
      crew: ["Skipper", "Dana R.", "Marco P.", "Lena K."],
      waypoints: [
        { name: "Mariner's Cove Marina", type: "depart", time: "10:00", note: "Light southerly, lazy start." },
        { name: "Channel Marker R\u20142", type: "mark", time: "10:35", note: "" },
        { name: "Cedar Island cove", type: "anchor", time: "12:15", note: "Rafted up, swam, grilled on the rail." },
        { name: "Mariner's Cove Marina", type: "arrive", time: "16:00", note: "Long reach home in fading breeze." }
      ],
      summary: "Best day of the summer so far. Full crew, calm anchorage, great food. New zinc held up fine. Engine ran a little warm at idle \u2014 keeping an eye on it.",
      findings: [
        { text: "Outboard ran warm at low idle on the way home \u2014 check water pump impeller / telltale flow.", severity: "high", maintId: "m-impeller" }
      ],
      photoCount: 12
    }
  ],

  maintenance: [
    { id: "m-jib-halyard", title: "Replace frayed jib halyard", system: "Rigging", status: "overdue", priority: 1,
      opened: "2024-06-22", due: "2024-06-30", costEst: 95, vendorId: "v-sailloft", fromTripId: "t-2024-06-22",
      note: "Several broken strands just below the shackle splice. Do not sail on it again \u2014 a halyard failure drops the headsail and can foul the prop. Replace with 5/16\u2033 low-stretch line.",
      steps: [
        "Measure old halyard end-to-end before removing (approx. 60 ft).",
        "Tape the new line to the old at the masthead sheave and feed it through.",
        "Re-tie or splice the shackle; whip the bitter end.",
        "Re-mark the rope clutch bite point."
      ],
      photoCount: 2 },
    { id: "m-impeller", title: "Inspect outboard water-pump impeller", system: "Engine", status: "overdue", priority: 2,
      opened: "2024-08-10", due: "2024-08-18", costEst: 60, vendorId: "v-outboard", fromTripId: "t-2024-08-10",
      note: "Engine ran warm at idle and telltale flow looked weak. Most likely a worn impeller \u2014 cheap part, easy to do, but overdue at this engine age. Check thermostat if symptoms persist.",
      steps: [
        "Confirm weak telltale stream at fast idle in the slip.",
        "Drop the lower unit, pull the pump housing.",
        "Replace impeller + gasket kit; lube and reassemble.",
        "Run and verify strong telltale flow."
      ],
      photoCount: 1 },
    { id: "m-stanchion", title: "Re-bed leaking port stanchion base", system: "Deck & hull", status: "due", priority: 3,
      opened: "2024-07-20", due: "2024-09-01", costEst: 40, vendorId: null, fromTripId: "t-2024-07-20",
      note: "Water in the bilge traced to the port midships stanchion. Backing plate bolts likely weeping. Re-bed with butyl tape; inspect core around the holes for softness while it's open.",
      steps: [
        "Remove stanchion base bolts, lift base.",
        "Clean old sealant; check core for moisture.",
        "Re-bed with butyl tape, snug \u2014 do not over-torque.",
        "Wet-test with a hose after curing."
      ],
      photoCount: 0 },
    { id: "m-zinc", title: "Replace sacrificial zinc anode", system: "Underwater", status: "due", priority: 4,
      opened: "2024-08-12", due: "2024-09-15", costEst: 25, vendorId: "v-diving", fromTripId: null,
      note: "Routine. Current zinc is ~40% wasted at last dive. Swap on the next bottom check so we don't run it past half.",
      steps: ["Schedule diver or pull at next haul.", "Swap zinc, snug the fastener.", "Log condition of old zinc."],
      photoCount: 0 },
    { id: "m-cabin-light", title: "Fix port cabin light ground", system: "Electrical", status: "scheduled", priority: 5,
      opened: "2024-06-22", due: "2024-09-20", costEst: 0, vendorId: null, fromTripId: "t-2024-07-06",
      note: "Corroded ground at the panel makes the port cabin lights flicker. Clean the terminal, add dielectric grease, re-crimp the ring terminal.",
      steps: ["Kill the battery switch.", "Pull and clean the ground ring at the panel.", "Re-crimp + dielectric grease.", "Test both cabin circuits."],
      photoCount: 0 },
    { id: "m-bilge-switch", title: "Replace bilge pump float switch", system: "Plumbing", status: "scheduled", priority: 6,
      opened: "2024-07-20", due: "2024-10-01", costEst: 35, vendorId: "v-harbor", fromTripId: "t-2024-07-20",
      note: "Float switch is slow to trigger. Replace with a new electronic/float switch and tidy the wiring on a fused circuit.",
      steps: [], photoCount: 0 },
    { id: "m-battery", title: "Installed new Group 24 battery", system: "Electrical", status: "done", priority: 0,
      opened: "2024-05-18", due: "2024-05-20", completed: "2024-05-19", costEst: 140, vendorId: "v-harbor", fromTripId: null,
      note: "Old battery wouldn't hold a charge over the winter. New deep-cycle Group 24 installed and load-tested. Good to go.",
      steps: [], photoCount: 1 },
    { id: "m-fuelbulb", title: "Replaced fuel line primer bulb", system: "Engine", status: "done", priority: 0,
      opened: "2024-06-01", due: "2024-06-05", completed: "2024-06-03", costEst: 18, vendorId: "v-harbor", fromTripId: null,
      note: "Old primer bulb had a crack and wouldn't hold pressure. New bulb + hose clamps. Engine starts on the first or second pull now.",
      steps: [], photoCount: 0 }
  ],

  costs: [
    { id: "c1", date: "2024-05-19", category: "Part replacement", item: "Group 24 deep-cycle battery", amount: 139.99, vendorId: "v-harbor", maintId: "m-battery" },
    { id: "c2", date: "2024-06-03", category: "Part replacement", item: "Fuel primer bulb + clamps", amount: 17.40, vendorId: "v-harbor", maintId: "m-fuelbulb" },
    { id: "c3", date: "2024-06-10", category: "Consumable", item: "Outboard 4-stroke oil (2 qt)", amount: 22.80, vendorId: "v-harbor", maintId: null },
    { id: "c4", date: "2024-06-15", category: "Enhancement", item: "Cockpit cushions (foam + cover)", amount: 210.00, vendorId: "v-sailloft", maintId: null },
    { id: "c5", date: "2024-06-22", category: "Consumable", item: "Fuel \u2014 6 gal gasoline", amount: 24.60, vendorId: null, maintId: null },
    { id: "c6", date: "2024-07-01", category: "Slip & mooring", item: "Summer slip fee \u2014 July", amount: 185.00, vendorId: null, maintId: null },
    { id: "c7", date: "2024-07-12", category: "Consumable", item: "Sacrificial zinc anode", amount: 23.50, vendorId: "v-diving", maintId: "m-zinc" },
    { id: "c8", date: "2024-07-12", category: "Service & labor", item: "Bottom inspection dive", amount: 75.00, vendorId: "v-diving", maintId: null },
    { id: "c9", date: "2024-07-28", category: "Enhancement", item: "LED tri-color masthead light", amount: 96.00, vendorId: "v-harbor", maintId: null },
    { id: "c10", date: "2024-08-01", category: "Slip & mooring", item: "Summer slip fee \u2014 August", amount: 185.00, vendorId: null, maintId: null },
    { id: "c11", date: "2024-08-05", category: "Consumable", item: "Bottom paint touch-up kit", amount: 41.20, vendorId: "v-harbor", maintId: null },
    { id: "c12", date: "2024-08-10", category: "Consumable", item: "Fuel \u2014 5 gal gasoline", amount: 20.10, vendorId: null, maintId: null },
    { id: "c13", date: "2024-08-20", category: "Part replacement", item: "Water-pump impeller kit", amount: 32.00, vendorId: "v-outboard", maintId: "m-impeller" }
  ],

  vendors: [
    { id: "v-harbor", name: "Harbor Marine Supply", type: "Chandlery", phone: "(555) 412-0099", email: "orders@harbormarine.example", location: "Dockside Plaza, Mariner's Cove", note: "Walk-in chandlery. Good for hardware, paint, oil, electrical bits. Will order anything overnight.", services: ["Hardware & fittings", "Paint & consumables", "Electrical", "Special orders"] },
    { id: "v-outboard", name: "The Outboard Doctor", type: "Engine service", phone: "(555) 771-3322", email: "mike@outboarddoctor.example", location: "Mobile \u2014 comes to the slip", note: "Mike services 2- and 4-stroke outboards on the dock. Quick on impellers, carbs, and winterizing.", services: ["Outboard repair", "Winterizing", "Impeller / water pump", "Carb & fuel system"] },
    { id: "v-diving", name: "Bottom Line Diving", type: "Hull & underwater", phone: "(555) 209-8814", email: "dispatch@bottomline.example", location: "Mariner's Cove Marina", note: "Monthly hull cleaning, zinc swaps, prop checks, and lost-item recovery. Book a week ahead in season.", services: ["Hull cleaning", "Zinc replacement", "Prop & running gear", "Inspection"] },
    { id: "v-sailloft", name: "Cove Sail & Canvas Loft", type: "Sails & canvas", phone: "(555) 660-4471", email: "loft@covesail.example", location: "Old Net Shed, Mariner's Cove", note: "Sail repair, new canvas, cushions, and rigging line. Friendly about small one-off jobs.", services: ["Sail repair", "Canvas & covers", "Cushions", "Running rigging"] }
  ],

  manuals: [
    { id: "man-c25", title: "Catalina 25 Owner's Manual", kind: "boat", year: 1985, pages: 48,
      summary: "The original owner's handbook for the Catalina 25 \u2014 systems, rigging, and care.",
      sections: [
        { title: "Specifications & dimensions", summary: "LOA, draft, ballast, sail areas, and tankage." },
        { title: "Standing & running rigging", summary: "Mast stepping, tuning the rig, halyard and sheet runs, reefing." },
        { title: "Hull, deck & keel", summary: "Fin vs. swing keel, through-hulls, bedding deck hardware." },
        { title: "Electrical system", summary: "Panel, battery, nav lights, and wiring diagram." },
        { title: "Plumbing & bilge", summary: "Head, sink, bilge pump, and seacock locations." },
        { title: "Trailering & launching", summary: "Mast raising, ramp procedure, and tie-down points." }
      ] },
    { id: "man-tohatsu", title: "Tohatsu 9.8 HP 4-Stroke Manual", kind: "engine", year: 2019, pages: 64,
      summary: "Operation and maintenance for the outboard \u2014 starting, fuel, and service intervals.",
      sections: [
        { title: "Starting & shutdown", summary: "Cold-start choke procedure, warm restart, and emergency stop." },
        { title: "Fuel & oil", summary: "Recommended fuel, oil type and capacity, fuel system priming." },
        { title: "Routine maintenance", summary: "Service intervals: impeller, gear oil, spark plug, anode." },
        { title: "Winterizing & storage", summary: "Fogging, fuel stabilizer, draining, and lay-up." },
        { title: "Troubleshooting", summary: "Won't start, runs warm, rough idle \u2014 quick diagnostics." }
      ] }
  ],

  quickref: [
    { id: "qr-start", title: "Engine start procedure", icon: "engine", steps: ["Fuel valve open, vent open", "Squeeze primer bulb firm", "Choke out (cold), throttle to start", "Pull / key to start; choke in as it warms", "Confirm telltale water stream"] },
    { id: "qr-reef", title: "Tuck in a reef", icon: "sail", steps: ["Head up, ease the main", "Lower halyard to the reef mark", "Hook the tack cringle, re-tension halyard", "Winch in the reef clew line", "Trim and bear away"] },
    { id: "qr-mob", title: "Man overboard", icon: "life", steps: ["Shout \u2018MOB\u2019, point, keep eyes on them", "Throw flotation immediately", "Hit MOB on the GPS / note position", "Turn back \u2014 figure-8 or quick-stop", "Approach from downwind, engine ready"] },
    { id: "qr-anchor", title: "Anchoring", icon: "anchor", steps: ["Pick sand/mud, check depth & swing", "Head into wind, stop the boat", "Lower (don't throw) the anchor", "Pay out 5:1 to 7:1 scope", "Back down gently to set; take a bearing"] }
  ]
};

/* ---- Inventory: what's aboard & is it ready ----
   category: safety | tanks | soft | tackle | spares | electronics
   tracking fields (any combination): expires, inspect{last,next,every},
   service{task,last,next,every}, level('full'|'ok'|'low'|'empty'),
   condition('good'|'fair'|'attention'), count{qty,low}
   "today" for the demo is 2024-08-22. */
window.DATA.inventory = [
  /* ---- SAFETY ---- */
  { id: "inv-pfd", name: "Life jackets (PFD Type II)", category: "safety", location: "V-berth lockers", qty: "5", required: true,
    inspect: { every: "12 mo", last: "2024-04-12", next: "2025-04-12" }, condition: "good", photoCount: 1,
    note: "Five wearable PFDs sized for adults plus one child vest. Check buckles, foam, whistles and reflective tape each spring." },
  { id: "inv-throw", name: "Throwable cushion (Type IV)", category: "safety", location: "Cockpit coaming", qty: "1", required: true,
    inspect: { every: "12 mo", last: "2024-04-12", next: "2025-04-12" }, condition: "good", photoCount: 0,
    note: "USCG-required throwable. Kept within arm's reach of the helm with the heaving line attached." },
  { id: "inv-flares", name: "Aerial flares & distress kit", category: "safety", location: "Nav station drawer", qty: "1 kit", required: true,
    expires: "2024-10-31", costEst: 48, photoCount: 1,
    note: "Visual distress signals expire 42 months from manufacture \u2014 USCG requires an in-date set aboard. Keep an expired set too as backup, but the in-date kit is what counts." },
  { id: "inv-fireext", name: "Fire extinguisher (B-I)", category: "safety", location: "Galley & lazarette", qty: "2", required: true,
    expires: "2024-06-30", costEst: 38, photoCount: 1,
    note: "Galley unit's gauge has dropped into the red and it's past the service date \u2014 replace it now. The lazarette spare is still in the green. Required aboard with a gasoline engine." },
  { id: "inv-horn", name: "Air horn (sound signal)", category: "safety", location: "Cockpit locker", qty: "1", required: true,
    level: "low", photoCount: 0,
    note: "Canned-air horn is low on pressure \u2014 grab a refill can. A backup pea-less whistle is clipped to every PFD as required." },
  { id: "inv-firstaid", name: "First-aid kit", category: "safety", location: "Quarter berth", qty: "1", required: true,
    expires: "2025-03-15", photoCount: 0,
    note: "Offshore-style kit. Restock seasickness tablets, antihistamines and check medication dates each spring." },
  { id: "inv-plb", name: "PLB (personal locator beacon)", category: "safety", location: "Skipper's grab bag", qty: "1", required: false,
    expires: "2027-05-01", condition: "good", photoCount: 0,
    note: "Registered PLB with a battery good to 2027. Self-test monthly; bring it into the cockpit on every sail." },

  /* ---- TANKS & CONSUMABLES ---- */
  { id: "inv-water", name: "Fresh-water tank", category: "tanks", location: "Under port settee", qty: "~13 gal", level: "ok", costEst: 8,
    service: { task: "Sanitize fresh-water tank", every: "6 mo", last: "2024-03-10", next: "2024-09-10" }, photoCount: 0,
    note: "Sanitize spring and fall with a dilute bleach solution, then flush thoroughly. Tank is about three-quarters full right now." },
  { id: "inv-holding", name: "Holding tank", category: "tanks", location: "Under V-berth", qty: "", costEst: 15,
    service: { task: "Pump out holding tank", every: "2 wk", last: "2024-08-05", next: "2024-08-25" }, photoCount: 0,
    note: "Pump out at the fuel dock \u2014 never discharge inshore. Getting near full; due for a pump-out within the week." },
  { id: "inv-fuel", name: "Fuel (gasoline)", category: "tanks", location: "Portable tank, lazarette", qty: "3.2 gal", level: "ok", photoCount: 0,
    note: "Portable tank for the outboard. Top off and add stabilizer if she's sitting more than a couple of weeks." },
  { id: "inv-alcohol", name: "Stove alcohol", category: "tanks", location: "Galley locker", qty: "", level: "low", photoCount: 0,
    note: "Denatured alcohol for the gimbaled stove \u2014 running low, refill before the next overnight or galley-cooked sail." },
  { id: "inv-oil", name: "Outboard oil (spare)", category: "tanks", location: "Lazarette", count: { qty: 2, low: false }, photoCount: 0,
    note: "Spare 10W-30 4-stroke oil for outboard oil changes. Two quarts aboard." },

  /* ---- COMFORT & SOFT GOODS ---- */
  { id: "inv-cabincushion", name: "Cabin cushions (V-berth & settee)", category: "soft", location: "Cabin", qty: "set", condition: "fair", photoCount: 1,
    note: "Foam is still supportive but the covers are sun-faded and one settee seam is opening. Recover when the budget allows \u2014 not urgent." },
  { id: "inv-cockpitcushion", name: "Cockpit cushions", category: "soft", location: "Cockpit", qty: "set", condition: "good", photoCount: 0,
    note: "New foam and covers (summer 2024). Rinse the salt off and stow dry to keep them nice." },
  { id: "inv-dodger", name: "Dodger / spray hood", category: "soft", location: "Companionway", qty: "1", condition: "fair", photoCount: 0,
    note: "Frame solid; zippers are stiff and the window is starting to craze. Workable for now \u2014 plan a window-panel replacement next off-season." },
  { id: "inv-main", name: "Mainsail", category: "soft", location: "On the boom (sail cover)", qty: "1", condition: "good",
    inspect: { every: "12 mo", last: "2024-03-01", next: "2025-03-01" }, photoCount: 0,
    note: "Battens, reef points and telltales in good shape. One reef tested this season and holding well." },
  { id: "inv-genoa", name: "Genoa (150%)", category: "soft", location: "Sail locker", qty: "1", condition: "good", photoCount: 0,
    note: "Foam-luff genoa with sacrificial UV strip in good order. Roller-furled and snugged when not in use." },

  /* ---- GROUND TACKLE ---- */
  { id: "inv-anchor", name: "Primary anchor (13 lb Danforth)", category: "tackle", location: "Bow locker", qty: "1", condition: "good", photoCount: 0,
    note: "Fluke-style anchor \u2014 excellent holding in the sand and mud we usually anchor in." },
  { id: "inv-rode", name: "Anchor rode (rope + chain)", category: "tackle", location: "Bow locker", qty: "150 ft", condition: "good",
    inspect: { every: "12 mo", last: "2024-05-01", next: "2025-05-01" }, photoCount: 0,
    note: "150 ft of 3-strand nylon spliced to 15 ft of chain. Check the splice and mouse the shackle each season." },
  { id: "inv-fenders", name: "Fenders", category: "tackle", location: "Lazarette", count: { qty: 4, low: false }, condition: "fair", photoCount: 0,
    note: "Four fenders aboard; one is slowly losing air but still usable. Replace it when convenient." },
  { id: "inv-docklines", name: "Dock lines", category: "tackle", location: "Cockpit lockers", count: { qty: 4 }, condition: "good", photoCount: 0,
    note: "Four spring/bow/stern lines plus chafe gear sized to the slip." },
  { id: "inv-boathook", name: "Boat hook", category: "tackle", location: "Cabin top", count: { qty: 1 }, condition: "good", photoCount: 0,
    note: "Telescoping boat hook stowed under the jacklines on the cabin top." },

  /* ---- SPARES & TOOLS ---- */
  { id: "inv-tools", name: "Tool kit", category: "spares", location: "Quarter berth", qty: "1", condition: "good", photoCount: 0,
    note: "Sockets, screwdrivers, pliers, adjustable wrenches, a multimeter and rigging tape \u2014 the basics for dockside fixes." },
  { id: "inv-impeller", name: "Spare impeller kit", category: "spares", location: "Spares box", count: { qty: 1, low: false }, photoCount: 0,
    note: "One spare water-pump impeller + gasket kit for the outboard. Carry one aboard always." },
  { id: "inv-fuelfilter", name: "Spare fuel filter", category: "spares", location: "Spares box", count: { qty: 0, low: true }, photoCount: 0,
    note: "Out of spare in-line fuel filters \u2014 pick up a couple next chandlery run." },
  { id: "inv-engspares", name: "Engine spares (plug, shear pin)", category: "spares", location: "Spares box", count: { qty: 2 }, photoCount: 0,
    note: "Spare spark plug and shear pin for the outboard, plus a length of starter cord." },
  { id: "inv-sealant", name: "Sealant & tape kit", category: "spares", location: "Lazarette", count: { qty: 1 }, condition: "good", photoCount: 0,
    note: "Butyl tape, polyurethane sealant and self-amalgamating tape for quick bedding and hose repairs." },

  /* ---- ELECTRONICS ---- */
  { id: "inv-vhf", name: "VHF radio (fixed-mount)", category: "electronics", location: "Nav station", qty: "1", condition: "good",
    inspect: { every: "12 mo", last: "2024-05-01", next: "2025-05-01" }, photoCount: 0,
    note: "DSC-capable VHF with MMSI programmed. Do an annual radio check and confirm the masthead antenna connection." },
  { id: "inv-gps", name: "Handheld GPS", category: "electronics", location: "Nav station", qty: "1", condition: "good", photoCount: 0,
    note: "Battery-powered handheld chartplotter as backup to the phone. Spare AA batteries in the drawer." },
  { id: "inv-navlights", name: "Nav lights (LED tri / anchor)", category: "electronics", location: "Masthead & stern", qty: "set", required: true, condition: "good", photoCount: 0,
    note: "New LED tri-color and anchor combo (2024). Required after dark and for anchoring \u2014 test before any evening sail." },
  { id: "inv-depth", name: "Depth sounder", category: "electronics", location: "Cockpit bulkhead", qty: "1", condition: "good", photoCount: 0,
    note: "Working depth display calibrated to the waterline. Handy for anchoring and the thin spots in the bay." },
  { id: "inv-housebatt", name: "House battery (Group 24)", category: "electronics", location: "Under settee", qty: "1", condition: "good", photoCount: 0,
    note: "New deep-cycle Group 24 (May 2024), load-tested. Keep it on the charger between sails." }
];

