/* ============================================================
   Costs — categorized spend, donut, category bars, ledger
   ============================================================ */
const { useState } = React;

function Donut({ segments, total }) {
  const R = 56, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={R} fill="none" stroke="#EADFC8" strokeWidth="20" />
      {segments.map((s, i) => {
        const len = (s.value / total) * C;
        const el = <circle key={i} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="20"
          strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 75 75)" />;
        offset += len;
        return el;
      })}
      <text x="75" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#5C7C8C">TOTAL</text>
      <text x="75" y="90" textAnchor="middle" fontFamily="Spectral, serif" fontSize="22" fontWeight="600" fill="#0C2230">{fmtMoney0(total)}</text>
    </svg>
  );
}

function CostsPage() {
  const [cat, setCat] = useState("All");
  const costs = window.DATA.costs;
  const cats = Object.keys(CATEGORY_META);

  const byCat = cats.map((c) => ({
    name: c, color: CATEGORY_META[c].color, icon: CATEGORY_META[c].icon,
    value: costs.filter((x) => x.category === c).reduce((s, x) => s + x.amount, 0),
    count: costs.filter((x) => x.category === c).length
  })).sort((a, b) => b.value - a.value);

  const total = costs.reduce((s, x) => s + x.amount, 0);
  const maxCat = Math.max(...byCat.map((c) => c.value));
  const shown = (cat === "All" ? costs : costs.filter((c) => c.category === cat))
    .slice().sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">What she costs to love</span>
          <h1 className="page-title">Costs</h1>
          <p className="page-lead">Every dollar into Valkyrie, sorted by what it bought — parts, upgrades, consumables, services, and her slip.</p>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "320px 1fr", marginBottom: 24, alignItems: "stretch" }}>
          <div className="card card-pad flex items-center gap-16" style={{ justifyContent: "center" }}>
            <Donut segments={byCat} total={total} />
            <div className="stack" style={{ gap: 8 }}>
              {byCat.map((c) => (
                <div key={c.name} className="flex items-center gap-8">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flex: "0 0 auto" }}></span>
                  <span className="tiny" style={{ color: "var(--ink-700)", fontWeight: 500 }}>{c.name.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: 16 }}>By category</div>
            <div className="stack" style={{ gap: 14 }}>
              {byCat.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                    <span className="flex items-center gap-8" style={{ fontSize: 14, color: "var(--ink-700)", fontWeight: 500 }}>
                      <span style={{ color: c.color }}><Icon name={c.icon} s={16} /></span>{c.name}
                      <span className="muted tiny mono">×{c.count}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 13.5, color: "var(--ink-800)" }}>{fmtMoney(c.value)}</span>
                  </div>
                  <div className="meter"><span style={{ width: `${(c.value / maxCat) * 100}%`, background: c.color }}></span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ledger */}
        <SectionHead icon="coins" title="Ledger" action={<button className="btn btn-brass"><Icon name="plus" s={16} />Log a cost</button>} />
        <div className="flex wrap gap-8" style={{ marginBottom: 14 }}>
          {["All", ...cats].map((c) => (
            <button key={c} className="chip" onClick={() => setCat(c)}
              style={{ cursor: "pointer", background: cat === c ? "var(--ink-700)" : "var(--paper-2)", color: cat === c ? "#fff" : "var(--ink-700)", borderColor: cat === c ? "var(--ink-700)" : "var(--line)" }}>
              {c !== "All" && <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_META[c].color, display: "inline-block" }}></span>}{c}
            </button>
          ))}
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div className="flex items-center" style={{ padding: "11px 18px", background: "var(--paper-2)", borderBottom: "1px solid var(--line)" }}>
            <span className="eyebrow" style={{ flex: 1 }}>Item</span>
            <span className="eyebrow" style={{ width: 150 }}>Category</span>
            <span className="eyebrow" style={{ width: 100 }}>Date</span>
            <span className="eyebrow" style={{ width: 90, textAlign: "right" }}>Amount</span>
          </div>
          {shown.map((c, i) => {
            const v = c.vendorId && vendorById(c.vendorId);
            return (
              <div key={c.id} className="flex items-center ledger-row" style={{ padding: "13px 18px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{c.item}</div>
                  {v && <div className="muted tiny">{v.name}</div>}
                </div>
                <div style={{ width: 150 }}>
                  <span className="flex items-center gap-8 tiny" style={{ color: "var(--ink-600)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_META[c.category].color, flex: "0 0 auto" }}></span>{c.category}
                  </span>
                </div>
                <div style={{ width: 100 }} className="mono tiny muted">{fmtDateShort(c.date)}</div>
                <div style={{ width: 90, textAlign: "right" }} className="mono" >{fmtMoney(c.amount)}</div>
              </div>
            );
          })}
          <div className="flex items-center" style={{ padding: "13px 18px", borderTop: "2px solid var(--line-strong)", background: "var(--paper-2)" }}>
            <span style={{ flex: 1, fontWeight: 600, color: "var(--ink-800)" }}>{cat === "All" ? "Total to date" : `${cat} subtotal`}</span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>{fmtMoney(shown.reduce((s, x) => s + x.amount, 0))}</span>
          </div>
        </div>
      </div>
      <style>{`.ledger-row:hover{ background:var(--paper-2); }
        @media (max-width:680px){ .page-wrap .grid[style*="320px 1fr"]{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

window.CostsPage = CostsPage;
