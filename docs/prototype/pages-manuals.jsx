/* ============================================================
   Owner's manuals + quick reference cards
   ============================================================ */
const { useState, useEffect } = React;

function ManualCard({ man, focus }) {
  const [open, setOpen] = useState(focus || false);
  const kindMeta = { boat: { ico: "helm", label: "Boat" }, engine: { ico: "engine", label: "Engine" } };
  const k = kindMeta[man.kind] || kindMeta.boat;
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="flex gap-16" style={{ padding: 20, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div style={{ flex: "0 0 auto", width: 54, height: 70, borderRadius: 6, background: "linear-gradient(150deg, var(--ink-700), var(--ink-900))", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)", border: "1px solid rgba(0,0,0,0.3)" }}>
          <Icon name={k.ico} s={26} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
            <span className="badge plain">{k.label}</span>
            <span className="muted mono tiny">{man.pages} pp · {man.year}</span>
          </div>
          <h3 style={{ fontSize: 19, marginTop: 8 }}>{man.title}</h3>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 0 }}>{man.summary}</p>
        </div>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", color: "var(--ink-tint)" }}><Icon name="chevron" s={18} /></span>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--line)", background: "var(--paper-2)", padding: "8px 20px 16px" }}>
          {man.sections.map((s, i) => (
            <div key={i} className="flex items-center gap-12 manual-sec" style={{ padding: "11px 8px", borderRadius: 8, cursor: "pointer" }}>
              <span className="mono tiny" style={{ color: "var(--brass-deep)", width: 24 }}>{String(i + 1).padStart(2, "0")}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-800)" }}>{s.title}</div>
                <div className="muted tiny">{s.summary}</div>
              </div>
              <Icon name="chevron" s={15} />
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5, padding: "6px 12px" }}><Icon name="download" s={14} />Download PDF</button>
        </div>
      )}
    </div>
  );
}

function ManualsPage({ focusId, clearFocus }) {
  useEffect(() => { if (focusId) clearFocus && clearFocus(); }, [focusId]);
  const focusedManual = focusId && window.DATA.manuals.find((m) => m.id === focusId);
  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <span className="eyebrow">Know your boat</span>
          <h1 className="page-title">Owner's manuals</h1>
          <p className="page-lead">The books for Valkyrie and her outboard, plus quick-reference cards for the procedures you reach for most.</p>
        </div>

        <SectionHead icon="book" title="Manuals" />
        <div className="stack">
          {window.DATA.manuals.map((m) => <ManualCard key={m.id} man={m} focus={focusedManual && focusedManual.id === m.id} />)}
        </div>

        <div style={{ marginTop: 32 }}>
          <SectionHead icon="info" title="Quick reference" />
          <div className="grid g-2">
            {window.DATA.quickref.map((q) => (
              <div key={q.id} className="card card-pad">
                <div className="flex items-center gap-12" style={{ marginBottom: 12 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--paper-2)", border: "1px solid var(--line)", color: "var(--brass-deep)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={q.icon} s={20} /></span>
                  <h3 style={{ fontSize: 17 }}>{q.title}</h3>
                </div>
                <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                  {q.steps.map((s, i) => (
                    <li key={i} className="flex gap-12" style={{ padding: "6px 0", alignItems: "flex-start" }}>
                      <span className="mono tiny" style={{ color: "var(--brass)", flex: "0 0 auto", width: 18 }}>{i + 1}</span>
                      <span style={{ fontSize: 13.5, color: "var(--ink-700)" }}>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`.manual-sec:hover{ background:var(--paper); }`}</style>
    </div>
  );
}

window.ManualsPage = ManualsPage;
