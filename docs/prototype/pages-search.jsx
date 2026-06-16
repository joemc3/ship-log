/* ============================================================
   Search — dedicated page: free text + faceted lookups
   (crew, places, purchases, vendors)
   ============================================================ */
const { useState, useEffect, useRef, useMemo } = React;

/* ---- custom dropdown ---- */
function Picker({ value, onChange, options, placeholder, icon, width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative", width: width || "100%", maxWidth: width || 280 }}>
      <button className={`picker-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {icon && <span style={{ color: "var(--brass-deep)", flex: "0 0 auto" }}><Icon name={icon} s={16} /></span>}
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel ? "var(--ink-800)" : "var(--ink-tint)" }}>
          {sel ? sel.label : placeholder}
        </span>
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(90deg)", color: "var(--ink-tint)", flex: "0 0 auto", transition: "transform .15s" }}>
          <Icon name={open ? "close" : "chevron"} s={open ? 15 : 14} />
        </span>
      </button>
      {open && (
        <div className="picker-menu">
          {value && (
            <button className="picker-opt clear" onClick={() => { onChange(""); setOpen(false); }}>
              <span className="muted">Clear selection</span>
            </button>
          )}
          {options.map((o) => (
            <button key={o.value} className={`picker-opt${o.value === value ? " sel" : ""}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.sub && <span className="muted tiny mono">{o.sub}</span>}
              {o.value === value && <span style={{ color: "var(--brass-deep)" }}><Icon name="check" s={15} /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const initials = (name) => name === "Skipper" ? "SK" : name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Avatar({ name, s = 40 }) {
  return (
    <span style={{ flex: "0 0 auto", width: s, height: s, borderRadius: "50%", background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: s * 0.34, fontWeight: 500, letterSpacing: "0.02em" }}>
      {name === "Skipper" ? <Icon name="helm" s={s * 0.5} /> : initials(name)}
    </span>
  );
}

function FindRow({ icon, title, sub, right, onClick }) {
  return (
    <button className="find-row" onClick={onClick}>
      <span style={{ color: "var(--brass-deep)", flex: "0 0 auto" }}><Icon name={icon} s={18} /></span>
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink-800)" }}>{title}</div>
        {sub && <div className="muted tiny" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
      <span style={{ color: "var(--ink-tint)", flex: "0 0 auto" }}><Icon name="arrowRight" s={16} /></span>
    </button>
  );
}

/* ---- free-text results ---- */
function TextResults({ q, onGo }) {
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const words = term.split(/\s+/);
    return window.SEARCH_INDEX
      .map((it) => {
        let score = 0;
        words.forEach((w) => { if (it.title.toLowerCase().includes(w)) score += 3; if (it.blob.includes(w)) score += 1; });
        return { it, score };
      })
      .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 20).map((r) => r.it);
  }, [q]);

  if (!q.trim()) return null;
  if (results.length === 0) return <div className="muted" style={{ padding: "18px 4px" }}>Nothing aboard matches “{q}”.</div>;

  const grouped = {};
  results.forEach((r) => { (grouped[r.cat] = grouped[r.cat] || []).push(r); });
  return (
    <div style={{ marginTop: 6 }}>
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{cat} · {items.length}</div>
          <div className="card" style={{ overflow: "hidden" }}>
            {items.map((it) => (
              <FindRow key={it.cat + it.ref} icon={it.icon} title={it.title} sub={it.sub} onClick={() => onGo(it.page, it.ref)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchPage({ pulse, onGo }) {
  const D = window.DATA;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("crew");
  const [crew, setCrew] = useState("");
  const [place, setPlace] = useState("");
  const [cat, setCat] = useState("");
  const [item, setItem] = useState("");
  const [vendor, setVendor] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, [pulse]);

  /* facet data */
  const people = useMemo(() => {
    const map = {};
    D.trips.forEach((t) => t.crew.forEach((c) => {
      map[c] = map[c] || { name: c, trips: [] };
      map[c].trips.push(t);
    }));
    return Object.values(map).map((p) => ({
      ...p,
      count: p.trips.length,
      last: p.trips.map((t) => t.date).sort().slice(-1)[0],
      nm: p.trips.reduce((s, t) => s + t.distanceNm, 0)
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, []);

  const places = useMemo(() => {
    const map = {};
    D.trips.forEach((t) => {
      const uniq = new Set(t.waypoints.map((w) => w.name));
      uniq.forEach((name) => {
        if (/marina/i.test(name)) return; // skip home base
        map[name] = map[name] || { name, trips: [] };
        map[name].trips.push(t);
      });
    });
    return Object.values(map).map((p) => ({
      ...p, count: p.trips.length, last: p.trips.map((t) => t.date).sort().slice(-1)[0]
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, []);

  const cats = Object.keys(window.CATEGORY_META);
  const purchaseList = useMemo(() => {
    let list = D.costs.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (cat) list = list.filter((c) => c.category === cat);
    return list;
  }, [cat]);

  const selPerson = people.find((p) => p.name === crew);
  const selPlace = places.find((p) => p.name === place);
  const selItem = D.costs.find((c) => c.id === item);
  const selVendor = D.vendors.find((v) => v.id === vendor);

  const tripSub = (t) => `${fmtDate(t.date)} · ${t.distanceNm} nm · ${t.crew.length} aboard`;

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">Find anything aboard</span>
          <h1 className="page-title">Search</h1>
          <p className="page-lead">Search every log, repair, cost, manual and vendor — or look things up by crew member, place, purchase, or vendor.</p>
        </div>

        {/* free text */}
        <div className="card card-pad" style={{ padding: 18 }}>
          <div className="flex items-center gap-12" style={{ background: "var(--paper-2)", border: "1px solid var(--line-strong)", borderRadius: 30, padding: "11px 18px" }}>
            <span style={{ color: "var(--brass-deep)" }}><Icon name="search" s={20} /></span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trips, repairs, costs, manuals, vendors…"
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-sans)", fontSize: 16, color: "var(--ink-900)" }} />
            {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-tint)" }}><Icon name="close" s={18} /></button>}
          </div>
          {!q && (
            <div className="flex wrap gap-8" style={{ marginTop: 12 }}>
              <span className="muted tiny" style={{ alignSelf: "center" }}>Try:</span>
              {["frayed halyard", "Gull Point", "impeller", "zinc", "slip fee"].map((s) => (
                <button key={s} className="chip" style={{ cursor: "pointer" }} onClick={() => setQ(s)}>{s}</button>
              ))}
            </div>
          )}
          <TextResults q={q} onGo={onGo} />
        </div>

        {/* faceted */}
        <div className="sec-head" style={{ marginTop: 30 }}>
          <span style={{ color: "var(--brass-deep)" }}><Icon name="layers" s={20} /></span>
          <h2>Look it up</h2>
          <span className="sec-rule"></span>
        </div>

        <div className="flex wrap gap-8" style={{ marginBottom: 18 }}>
          {[["crew", "By crew", "crew"], ["places", "By place", "pin"], ["purchases", "By purchase", "coins"], ["vendors", "By vendor", "store"]].map(([k, label, ico]) => (
            <button key={k} onClick={() => setTab(k)} className={"facet-tab" + (tab === k ? " on" : "")}>
              <Icon name={ico} s={16} />{label}
            </button>
          ))}
        </div>

        {/* CREW */}
        {tab === "crew" && (
          <div>
            <Picker value={crew} onChange={setCrew} icon="crew" placeholder="Choose a crew member…" width={300}
              options={people.map((p) => ({ value: p.name, label: p.name, sub: `${p.count} trip${p.count > 1 ? "s" : ""}` }))} />
            {!crew && (
              <div className="grid g-3" style={{ marginTop: 16 }}>
                {people.map((p) => (
                  <button key={p.name} className="person-card" onClick={() => setCrew(p.name)}>
                    <Avatar name={p.name} s={38} />
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{p.name}</div>
                      <div className="muted tiny">{p.count} trip{p.count > 1 ? "s" : ""} · last {fmtDateShort(p.last)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selPerson && (
              <div style={{ marginTop: 18 }}>
                <div className="card card-pad" style={{ display: "flex", gap: 16, alignItems: "center", background: "var(--paper-2)" }}>
                  <Avatar name={selPerson.name} s={54} />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: 22 }}>{selPerson.name}</h3>
                    <div className="muted" style={{ fontSize: 14, marginTop: 3 }}>
                      Aboard {selPerson.count} time{selPerson.count > 1 ? "s" : ""} · last sailed {fmtDate(selPerson.last)} · {selPerson.nm.toFixed(1)} nm logged together
                    </div>
                  </div>
                </div>
                <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Trips aboard</div>
                <div className="card" style={{ overflow: "hidden" }}>
                  {selPerson.trips.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                    <FindRow key={t.id} icon="log" title={t.title} sub={tripSub(t)}
                      right={<span className="chip tiny" style={{ marginRight: 8 }}><Icon name="wind" s={13} />{t.wind.split(" ").slice(0, 2).join(" ")}</span>}
                      onClick={() => onGo("logs", t.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PLACES */}
        {tab === "places" && (
          <div>
            <Picker value={place} onChange={setPlace} icon="pin" placeholder="Choose a place…" width={300}
              options={places.map((p) => ({ value: p.name, label: p.name, sub: `${p.count}×` }))} />
            {!place && (
              <div className="grid g-3" style={{ marginTop: 16 }}>
                {places.map((p) => (
                  <button key={p.name} className="person-card" onClick={() => setPlace(p.name)}>
                    <span style={{ color: "var(--brass-deep)", flex: "0 0 auto" }}><Icon name="pin" s={22} /></span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{p.name}</div>
                      <div className="muted tiny">visited {p.count}×</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selPlace && (
              <div style={{ marginTop: 18 }}>
                <div className="card card-pad" style={{ display: "flex", gap: 14, alignItems: "center", background: "var(--paper-2)" }}>
                  <span style={{ width: 50, height: 50, borderRadius: 14, background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name="pin" s={26} /></span>
                  <div>
                    <h3 style={{ fontSize: 21 }}>{selPlace.name}</h3>
                    <div className="muted" style={{ fontSize: 14, marginTop: 3 }}>
                      Yes — we've been here {selPlace.count} time{selPlace.count > 1 ? "s" : ""}. Last visit {fmtDate(selPlace.last)}.
                    </div>
                  </div>
                </div>
                <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Trips that stopped here</div>
                <div className="card" style={{ overflow: "hidden" }}>
                  {selPlace.trips.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                    <FindRow key={t.id} icon="log" title={t.title} sub={tripSub(t)} onClick={() => onGo("logs", t.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PURCHASES */}
        {tab === "purchases" && (
          <div>
            <div className="flex wrap gap-12">
              <Picker value={cat} onChange={(v) => { setCat(v); setItem(""); }} icon="layers" placeholder="Any category" width={240}
                options={cats.map((c) => ({ value: c, label: c }))} />
              <Picker value={item} onChange={setItem} icon="coins" placeholder="Pick a purchase…" width={320}
                options={purchaseList.map((c) => ({ value: c.id, label: c.item, sub: fmtMoney(c.amount) }))} />
            </div>

            {selItem ? (
              <div className="card card-pad" style={{ marginTop: 18 }}>
                <div className="flex items-center" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <span className="flex items-center gap-8 tiny" style={{ color: "var(--ink-600)" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: window.CATEGORY_META[selItem.category].color }}></span>{selItem.category}
                    </span>
                    <h3 style={{ fontSize: 23, marginTop: 8 }}>{selItem.item}</h3>
                  </div>
                  <div className="stat-value" style={{ fontSize: 30 }}>{fmtMoney(selItem.amount)}</div>
                </div>
                <hr className="hairline" style={{ margin: "16px 0" }} />
                <div className="grid g-3" style={{ gap: 16 }}>
                  <div><div className="stat-label">Purchased</div><div className="mono" style={{ marginTop: 4, color: "var(--ink-800)" }}>{fmtDate(selItem.date)}</div></div>
                  <div><div className="stat-label">From</div><div className="mono" style={{ marginTop: 4, color: "var(--ink-800)" }}>{selItem.vendorId ? vendorById(selItem.vendorId).name : "—"}</div></div>
                  <div><div className="stat-label">Category</div><div className="mono" style={{ marginTop: 4, color: "var(--ink-800)" }}>{selItem.category}</div></div>
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => onGo("costs", selItem.id)}><Icon name="coins" s={15} />Open in ledger<Icon name="arrowRight" s={14} /></button>
              </div>
            ) : (
              <div style={{ marginTop: 18 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{cat ? `${cat} · ${purchaseList.length}` : `All purchases · ${purchaseList.length}`}</div>
                <div className="card" style={{ overflow: "hidden" }}>
                  {purchaseList.map((c) => (
                    <FindRow key={c.id} icon="coins" title={c.item}
                      sub={`${fmtDate(c.date)} · ${c.vendorId ? vendorById(c.vendorId).name : "—"}`}
                      right={<span className="mono" style={{ marginRight: 10, color: "var(--ink-800)" }}>{fmtMoney(c.amount)}</span>}
                      onClick={() => setItem(c.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VENDORS */}
        {tab === "vendors" && (
          <div>
            <Picker value={vendor} onChange={setVendor} icon="store" placeholder="Choose a vendor…" width={300}
              options={D.vendors.map((v) => ({ value: v.id, label: v.name, sub: v.type }))} />
            {!vendor && (
              <div className="grid g-2" style={{ marginTop: 16 }}>
                {D.vendors.map((v) => (
                  <button key={v.id} className="person-card" onClick={() => setVendor(v.id)}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name="store" s={20} /></span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{v.name}</div>
                      <div className="muted tiny">{v.type}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selVendor && (() => {
              const buys = D.costs.filter((c) => c.vendorId === selVendor.id).sort((a, b) => b.date.localeCompare(a.date));
              const jobs = D.maintenance.filter((m) => m.vendorId === selVendor.id);
              const spent = buys.reduce((s, c) => s + c.amount, 0);
              return (
                <div style={{ marginTop: 18 }}>
                  <div className="card card-pad" style={{ background: "var(--paper-2)" }}>
                    <div className="flex items-center gap-16">
                      <span style={{ width: 50, height: 50, borderRadius: 14, background: "var(--ink-700)", color: "var(--brass-bright)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name="store" s={26} /></span>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: 21 }}>{selVendor.name}</h3>
                        <div className="muted tiny" style={{ marginTop: 2 }}>{selVendor.type} · {selVendor.location}</div>
                      </div>
                      <div style={{ textAlign: "right" }}><div className="stat-label">Spent</div><div className="stat-value sm">{fmtMoney0(spent)}</div></div>
                    </div>
                    <div className="flex wrap gap-8" style={{ marginTop: 14 }}>
                      <span className="chip tiny"><Icon name="phone" s={13} />{selVendor.phone}</span>
                      <span className="chip tiny"><Icon name="mail" s={13} />{selVendor.email}</span>
                    </div>
                  </div>
                  {buys.length > 0 && (<>
                    <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Purchases · {buys.length}</div>
                    <div className="card" style={{ overflow: "hidden" }}>
                      {buys.map((c) => (
                        <FindRow key={c.id} icon="coins" title={c.item} sub={fmtDate(c.date)}
                          right={<span className="mono" style={{ marginRight: 10, color: "var(--ink-800)" }}>{fmtMoney(c.amount)}</span>}
                          onClick={() => onGo("costs", c.id)} />
                      ))}
                    </div>
                  </>)}
                  {jobs.length > 0 && (<>
                    <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Jobs · {jobs.length}</div>
                    <div className="card" style={{ overflow: "hidden" }}>
                      {jobs.map((m) => (
                        <FindRow key={m.id} icon="wrench" title={m.title} sub={m.system}
                          right={<span style={{ marginRight: 8 }}><StatusBadge status={m.status} /></span>}
                          onClick={() => onGo("maintenance", m.id)} />
                      ))}
                    </div>
                  </>)}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

window.SearchPage = SearchPage;
