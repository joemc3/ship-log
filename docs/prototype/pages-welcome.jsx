/* ============================================================
   Welcome / About — the shareable public page
   ============================================================ */
const B = window.DATA.boat;

function SpecTable() {
  const specs = [
    ["Make & model", `${B.year} ${B.model}`],
    ["Rig", B.rig],
    ["Length overall", B.loa],
    ["Waterline", B.lwl],
    ["Beam", B.beam],
    ["Draft", B.draft],
    ["Displacement", B.displacement],
    ["Ballast", B.ballast],
    ["Sail area", B.sailArea],
    ["Auxiliary", B.engine],
    ["Sail number", `#${B.sailNumber}`],
    ["Hailing port", B.hailingPort]
  ];
  return (
    <div className="card card-pad">
      <div className="eyebrow" style={{ marginBottom: 14 }}>Ship's particulars</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "var(--line)", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--line)" }}>
        {specs.map(([k, v]) => (
          <div key={k} style={{ background: "var(--paper)", padding: "11px 13px" }}>
            <div className="stat-label" style={{ fontSize: 9.5 }}>{k}</div>
            <div className="mono" style={{ fontSize: 13.5, color: "var(--ink-800)", marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WelcomePage({ onShare }) {
  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1080 }}>

        {/* HERO */}
        <div style={{ position: "relative", borderRadius: "var(--r-xl)", overflow: "hidden", background: "linear-gradient(155deg, var(--ink-700), var(--ink-900))", color: "var(--parchment)", boxShadow: "var(--shadow-md)", border: "1px solid rgba(0,0,0,0.3)" }}>
          {/* compass watermark */}
          <div style={{ position: "absolute", right: -60, top: -40, color: "var(--brass-bright)", opacity: 0.12, pointerEvents: "none" }}>
            <CompassRose s={360} sw={1} />
          </div>
          {/* depth contour lines */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.1 }} preserveAspectRatio="none">
            <path d="M-20 80 Q 300 40 700 110 T 1400 90" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
            <path d="M-20 150 Q 350 110 720 180 T 1400 160" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
            <path d="M-20 230 Q 300 190 700 260 T 1400 240" fill="none" stroke="#C99B4E" strokeWidth="1.2" />
          </svg>

          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 24, padding: "40px 40px 36px" }} className="hero-grid">
            <div>
              <div className="eyebrow on-ink">Welcome aboard · You're invited to sail</div>
              <h1 style={{ color: "#fff", fontSize: "clamp(48px, 8vw, 76px)", lineHeight: 0.95, marginTop: 14, letterSpacing: "0.01em" }}>{B.name}</h1>
              <div className="flex items-center gap-12" style={{ marginTop: 14, flexWrap: "wrap" }}>
                <span className="badge plain" style={{ background: "rgba(242,232,213,0.12)", color: "var(--parchment)", borderColor: "rgba(242,232,213,0.2)" }}>{B.year} {B.model}</span>
                <span className="coord" style={{ fontSize: 13, color: "var(--brass-bright)" }}>{B.lat} · {B.lon}</span>
              </div>
              <p style={{ color: "rgba(242,232,213,0.92)", fontSize: 18, maxWidth: "44ch", marginTop: 18, fontFamily: "var(--font-display)", fontStyle: "italic" }}>
                “{B.tagline}”
              </p>
              <div className="flex gap-12" style={{ marginTop: 22, flexWrap: "wrap" }}>
                <button className="btn btn-brass" onClick={onShare}><Icon name="share" s={16} />Share this page</button>
                <span className="btn btn-ghost" style={{ color: "var(--parchment)", borderColor: "rgba(242,232,213,0.25)" }}><Icon name="pin" s={16} />{B.homePort}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <Photo label="Valkyrie under sail — drop a photo here" h={260} style={{ width: "100%", border: "1px solid rgba(242,232,213,0.2)" }} />
            </div>
          </div>
        </div>

        {/* QUICK STATS STRIP */}
        <div className="grid g-4" style={{ marginTop: 18 }}>
          {[["Length", "25 ft"], ["Crew aboard", "Up to 5"], ["Best in", "8–14 kt"], ["Home", B.hailingPort]].map(([l, v]) => (
            <div key={l} className="card card-pad" style={{ textAlign: "left" }}><Stat label={l} value={v} sm /></div>
          ))}
        </div>

        {/* ABOUT + SPECS */}
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 28, alignItems: "start" }}>
          <div>
            <SectionHead icon="helm" title="About Valkyrie" />
            <p style={{ fontSize: 16.5, color: "var(--ink-700)" }}>{B.blurb}</p>
            <p style={{ fontSize: 15.5, color: "var(--ink-600)", marginTop: 12 }}>
              She's been in our hands since {B.since}. Like any boat her age she's a labor of love — every season she gets a little stronger, a little prettier, and a little more ready for a long day on the water with friends.
            </p>
            <div className="card card-pad" style={{ marginTop: 18, background: "var(--paper-2)", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ color: "var(--brass-deep)", flex: "0 0 auto" }}><Icon name="pin" s={22} /></span>
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink-800)" }}>Where she lives</div>
                <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{B.homePort}</div>
                <div className="coord" style={{ fontSize: 12.5, color: "var(--brass-deep)", marginTop: 6 }}>{B.lat}  {B.lon}</div>
              </div>
            </div>
          </div>
          <SpecTable />
        </div>

        {/* HOUSE RULES */}
        <div style={{ marginTop: 36 }}>
          <SectionHead icon="flag" title="A few things before you step aboard" />
          <p className="muted" style={{ marginTop: -8, marginBottom: 16, maxWidth: "70ch" }}>
            None of this is meant to be fussy — it's just how we keep Valkyrie happy and everyone safe and comfortable. If you've never sailed before, don't worry about a thing: we'll walk you through it all.
          </p>
          <div className="grid g-2">
            {window.DATA.rules.map((r) => (
              <div key={r.title} className="card card-pad" style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: "0 0 auto", width: 46, height: 46, borderRadius: 12, background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={r.icon} s={24} />
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--ink-900)" }}>{r.title}</div>
                  <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* WHAT TO EXPECT */}
        <div style={{ marginTop: 36 }}>
          <SectionHead icon="helm" title="What to expect on the water" />
          <div className="grid g-2">
            {window.DATA.expect.map((e, i) => (
              <div key={e.title} className="flex gap-12" style={{ alignItems: "flex-start", padding: "4px 0" }}>
                <span className="mono" style={{ color: "var(--brass)", fontSize: 22, lineHeight: 1, flex: "0 0 auto", width: 34 }}>0{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink-800)" }}>{e.title}</div>
                  <p className="muted" style={{ fontSize: 14, marginTop: 3 }}>{e.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* BRING + SAFETY */}
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 32 }}>
          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Pack a soft bag with</div>
            <div className="stack">
              {window.DATA.bring.map((b) => (
                <div key={b} className="flex items-center gap-12">
                  <span style={{ color: "var(--patina)" }}><Icon name="check" s={18} /></span>
                  <span style={{ fontSize: 14.5, color: "var(--ink-700)" }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card card-pad" style={{ background: "var(--ink-800)", color: "var(--parchment)", border: "1px solid rgba(0,0,0,0.3)" }}>
            <div className="eyebrow on-ink" style={{ marginBottom: 12 }}>Safety always wins</div>
            <div className="stack">
              {window.DATA.safety.map((s) => (
                <div key={s} className="flex items-center gap-12">
                  <span style={{ color: "var(--brass-bright)" }}><Icon name="life" s={18} /></span>
                  <span style={{ fontSize: 14.5, color: "rgba(242,232,213,0.92)" }}>{s}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 13.5, color: "rgba(242,232,213,0.7)", marginTop: 16, fontStyle: "italic", fontFamily: "var(--font-display)" }}>
              Feeling queasy is normal and nothing to be shy about — tell us early and we'll sort it out fast.
            </p>
          </div>
        </div>

        {/* GALLERY */}
        <div style={{ marginTop: 36 }}>
          <SectionHead icon="camera" title="Aboard Valkyrie" />
          <div className="grid g-4">
            <Photo label="At the slip" h={150} />
            <Photo label="Cockpit" h={150} />
            <Photo label="Gull Point" h={150} />
            <Photo label="Golden hour" h={150} />
          </div>
        </div>

        {/* CLOSING */}
        <div className="card card-pad" style={{ marginTop: 32, textAlign: "center", padding: "34px 24px", background: "var(--paper-2)" }}>
          <div style={{ display: "inline-flex", color: "var(--brass)" }}><CompassRose s={42} /></div>
          <h3 style={{ fontSize: 24, marginTop: 12 }}>We can't wait to have you aboard</h3>
          <p className="muted" style={{ maxWidth: "52ch", margin: "8px auto 0" }}>
            Questions before the big day? Just ask. Otherwise, wear soft soles, bring a layer and a share for the boat, and come ready for a relaxed day of wind and water.
          </p>
          <div className="coord" style={{ marginTop: 16, fontSize: 12.5, color: "var(--brass-deep)" }}>FAIR WINDS · {B.name.toUpperCase()} · {B.lat} {B.lon}</div>
        </div>

      </div>
      <style>{`@media (max-width: 760px){ .hero-grid{ grid-template-columns:1fr !important; } .hero-grid .photo{ height:180px !important; } }
        @media (max-width: 720px){ .page-wrap .grid[style*="1fr 1fr"]{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

window.WelcomePage = WelcomePage;
