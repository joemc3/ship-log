/* ============================================================
   Trip logs — list + detailed log entry
   ============================================================ */
const { useState, useEffect } = React;

function WaypointTrack({ waypoints }) {
  const typeIco = { depart: "anchor", arrive: "pin", mark: "flag", anchor: "anchor" };
  return (
    <div style={{ position: "relative", paddingLeft: 8 }}>
      {waypoints.map((w, i) => (
        <div key={i} className="flex gap-16" style={{ position: "relative", paddingBottom: i < waypoints.length - 1 ? 22 : 0 }}>
          {i < waypoints.length - 1 && (
            <span style={{ position: "absolute", left: 14, top: 30, bottom: -4, width: 2, background: "repeating-linear-gradient(180deg, var(--brass) 0 5px, transparent 5px 10px)" }}></span>
          )}
          <div style={{ flex: "0 0 auto", width: 30, height: 30, borderRadius: "50%", background: "var(--paper)", border: "2px solid var(--brass)", color: "var(--brass-deep)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
            <Icon name={typeIco[w.type] || "flag"} s={15} />
          </div>
          <div style={{ paddingTop: 2 }}>
            <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{w.name}</span>
              <span className="mono tiny" style={{ color: "var(--brass-deep)" }}>{w.time}</span>
            </div>
            {w.note && <p className="muted" style={{ fontSize: 13.5, marginTop: 2, marginBottom: 0 }}>{w.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TripDetail({ trip, onBack, onOpenMaint }) {
  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18 }}><Icon name="arrowLeft" s={16} />All trips</button>

        <div className="flex items-center gap-12" style={{ flexWrap: "wrap", marginBottom: 4 }}>
          <span className="eyebrow">Trip log</span>
          <span className="coord tiny" style={{ color: "var(--ink-tint)" }}>{trip.id}</span>
        </div>
        <h1 className="page-title">{trip.title}</h1>
        <div className="flex items-center gap-16" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <span className="chip"><Icon name="calendar" s={15} />{fmtDate(trip.date)}</span>
          <span className="chip"><Icon name="clock" s={15} />{trip.durationHrs} hrs</span>
          <span className="chip"><Icon name="route" s={15} />{trip.distanceNm} nm</span>
          <span className="chip"><Icon name="engine" s={15} />{trip.engineHrs} engine hrs</span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr", marginTop: 22, alignItems: "start" }}>
          {/* left: route + summary */}
          <div className="stack">
            <div className="card card-pad">
              <SectionHead icon="route" title="Route" />
              <WaypointTrack waypoints={trip.waypoints} />
            </div>
            <div className="card card-pad">
              <SectionHead icon="log" title="Log" />
              <p style={{ fontSize: 15.5, color: "var(--ink-700)", marginTop: -4 }}>{trip.summary}</p>
            </div>
            {trip.findings.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="alert" title={`Findings (${trip.findings.length})`} />
                <div className="stack">
                  {trip.findings.map((f, i) => {
                    const m = f.maintId && maintById(f.maintId);
                    return (
                      <div key={i} className="flex gap-12" style={{ alignItems: "flex-start", padding: "12px", background: "var(--paper-2)", borderRadius: "var(--r-md)", border: "1px solid var(--line)" }}>
                        <span className={`badge ${sevLabel[f.severity].c}`} style={{ flex: "0 0 auto" }}><span className="dot"></span>{sevLabel[f.severity].t}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-800)" }}>{f.text}</p>
                          {m && (
                            <button className="btn btn-ghost" style={{ marginTop: 8, padding: "5px 11px", fontSize: 12.5 }} onClick={() => onOpenMaint(m.id)}>
                              <Icon name="wrench" s={14} />{m.status === "done" ? "Resolved — view" : "On the work list"}<Icon name="arrowRight" s={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* right: conditions, crew, photos */}
          <div className="stack">
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Conditions</div>
              <div className="grid g-2" style={{ gap: 12 }}>
                <Stat label="Wind" value={trip.wind} sm />
                <Stat label="Seas" value={trip.seas} sm />
                <Stat label="Sky" value={trip.sky} sm />
                <Stat label="Air" value={`${trip.tempF}°F`} sm />
              </div>
            </div>
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Crew aboard · {trip.crew.length}</div>
              <div className="flex wrap gap-8">
                {trip.crew.map((c) => (
                  <span key={c} className="chip"><Icon name="crew" s={15} />{c}</span>
                ))}
              </div>
            </div>
            <div className="card card-pad">
              <div className="flex items-center" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <span className="eyebrow">Photos · {trip.photoCount}</span>
                <span className="muted tiny"><Icon name="camera" s={15} /></span>
              </div>
              <div className="grid g-2" style={{ gap: 8 }}>
                {Array.from({ length: Math.min(4, trip.photoCount) }).map((_, i) => (
                  <Photo key={i} h={84} label="" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 760px){ .page-wrap .grid[style*="1.3fr 1fr"]{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

function TripCard({ trip, onClick }) {
  const hi = trip.findings.filter((f) => f.severity === "high").length;
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer" }} onClick={onClick}>
      <div style={{ position: "relative" }}>
        <Photo h={132} label={`${trip.photoCount} photos`} icon="camera" />
        <div style={{ position: "absolute", top: 12, left: 12 }}>
          <span className="badge plain" style={{ background: "rgba(12,34,48,0.66)", color: "var(--parchment)", borderColor: "transparent" }}>{fmtDateShort(trip.date)}</span>
        </div>
      </div>
      <div className="card-pad" style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--ink-900)" }}>{trip.title}</div>
        <div className="flex wrap gap-8" style={{ marginTop: 10 }}>
          <span className="chip tiny"><Icon name="route" s={14} />{trip.distanceNm} nm</span>
          <span className="chip tiny"><Icon name="crew" s={14} />{trip.crew.length}</span>
          <span className="chip tiny"><Icon name="wind" s={14} />{trip.wind.split(" ").slice(0, 2).join(" ")}</span>
        </div>
        <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <span className="muted tiny">{trip.waypoints.length} waypoints</span>
          {trip.findings.length > 0 && (
            <span className={`badge ${hi ? "overdue" : "due"}`}><span className="dot"></span>{trip.findings.length} finding{trip.findings.length > 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LogsPage({ focusId, onOpenMaint, clearFocus }) {
  const [openId, setOpenId] = useState(null);
  useEffect(() => { if (focusId) { setOpenId(focusId); clearFocus && clearFocus(); } }, [focusId]);

  const trips = [...window.DATA.trips].sort((a, b) => b.date.localeCompare(a.date));
  const open = openId && tripById(openId);

  if (open) return <TripDetail trip={open} onBack={() => setOpenId(null)} onOpenMaint={onOpenMaint} />;

  const totalNm = trips.reduce((s, t) => s + t.distanceNm, 0);
  const totalHrs = trips.reduce((s, t) => s + t.durationHrs, 0);
  const allCrew = new Set(); trips.forEach((t) => t.crew.forEach((c) => c !== "Skipper" && allCrew.add(c)));

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">The ship's log</span>
          <h1 className="page-title">Trip logs</h1>
          <p className="page-lead">Every outing aboard Valkyrie — where we went, who was aboard, the conditions, and anything we noticed that needs attention.</p>
        </div>

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad"><Stat label="Trips logged" value={trips.length} sm /></div>
          <div className="card card-pad"><Stat label="Distance" value={`${totalNm.toFixed(1)} nm`} sm /></div>
          <div className="card card-pad"><Stat label="Hours afloat" value={`${totalHrs.toFixed(1)}`} sm /></div>
          <div className="card card-pad"><Stat label="Guests aboard" value={allCrew.size} sm /></div>
        </div>

        <SectionHead icon="log" title="All trips" action={<button className="btn btn-brass"><Icon name="plus" s={16} />New log</button>} />
        <div className="grid g-3">
          {trips.map((t) => <TripCard key={t.id} trip={t} onClick={() => setOpenId(t.id)} />)}
        </div>
      </div>
    </div>
  );
}

window.LogsPage = LogsPage;
