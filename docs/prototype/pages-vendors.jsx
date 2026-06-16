/* ============================================================
   Vendors directory
   ============================================================ */
const { useEffect } = React;

function VendorsPage({ focusId, clearFocus, onOpenMaint }) {
  useEffect(() => { if (focusId) clearFocus && clearFocus(); }, [focusId]);
  const vendors = window.DATA.vendors;

  const jobsFor = (vid) => window.DATA.maintenance.filter((m) => m.vendorId === vid && m.status !== "done");

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">Valkyrie's little black book</span>
          <h1 className="page-title">Vendors & services</h1>
          <p className="page-lead">The people who keep her sailing — chandlery, engine, diver, and sail loft. Add anyone new as you find them.</p>
        </div>

        <SectionHead icon="store" title="Directory" action={<button className="btn btn-brass"><Icon name="plus" s={16} />Add vendor</button>} />
        <div className="grid g-2">
          {vendors.map((v) => {
            const jobs = jobsFor(v.id);
            return (
              <div key={v.id} className="card card-pad" style={{ display: "flex", flexDirection: "column" }} id={v.id}>
                <div className="flex items-center gap-12">
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name="store" s={22} /></span>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: 18, lineHeight: 1.15 }}>{v.name}</h3>
                    <div className="muted tiny" style={{ marginTop: 3 }}>{v.type}</div>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 14, marginTop: 12, marginBottom: 12 }}>{v.note}</p>
                <div className="flex wrap gap-8" style={{ marginBottom: 14 }}>
                  {v.services.map((s) => <span key={s} className="chip tiny">{s}</span>)}
                </div>
                <div className="stack" style={{ gap: 8, marginTop: "auto" }}>
                  <div className="flex items-center gap-12">
                    <span className="muted" style={{ color: "var(--brass-deep)" }}><Icon name="phone" s={15} /></span>
                    <span className="mono tiny" style={{ color: "var(--ink-700)" }}>{v.phone}</span>
                  </div>
                  <div className="flex items-center gap-12">
                    <span className="muted" style={{ color: "var(--brass-deep)" }}><Icon name="mail" s={15} /></span>
                    <span className="mono tiny" style={{ color: "var(--ink-700)" }}>{v.email}</span>
                  </div>
                  <div className="flex items-center gap-12">
                    <span className="muted" style={{ color: "var(--brass-deep)" }}><Icon name="pin" s={15} /></span>
                    <span className="tiny" style={{ color: "var(--ink-700)" }}>{v.location}</span>
                  </div>
                </div>
                {jobs.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>Open jobs for them</div>
                    {jobs.map((j) => (
                      <button key={j.id} className="flex items-center gap-8 vendor-job" onClick={() => onOpenMaint(j.id)}
                        style={{ width: "100%", textAlign: "left", border: "none", background: "var(--paper-2)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", marginBottom: 6 }}>
                        <span className={`badge ${STATUS[j.status].cls}`} style={{ flex: "0 0 auto" }}><span className="dot"></span></span>
                        <span style={{ fontSize: 13, color: "var(--ink-700)", flex: 1 }}>{j.title}</span>
                        <Icon name="arrowRight" s={14} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="card card-pad" style={{ marginTop: 22, textAlign: "center", padding: "26px", borderStyle: "dashed", background: "transparent" }}>
          <div className="muted" style={{ display: "inline-flex", marginBottom: 8 }}><Icon name="plus" s={24} /></div>
          <div style={{ fontWeight: 600, color: "var(--ink-700)" }}>Add a new vendor</div>
          <p className="muted tiny" style={{ maxWidth: "40ch", margin: "4px auto 0" }}>Riggers, surveyors, haul-out yards, electronics — keep them all here so the next job is one tap away.</p>
        </div>
      </div>
      <style>{`.vendor-job:hover{ background:var(--paper); }`}</style>
    </div>
  );
}

window.VendorsPage = VendorsPage;
