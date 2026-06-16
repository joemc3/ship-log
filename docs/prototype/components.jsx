/* ============================================================
   Shared helpers + UI atoms + Search overlay
   ============================================================ */
const D = window.DATA;
const { useState, useEffect, useRef, useMemo } = React;

/* ---------- helpers ---------- */
const fmtMoney = (n, c = true) =>
  (c ? "$" : "") + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney0 = (n) => "$" + Math.round(n).toLocaleString("en-US");
const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtDateShort = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const daysUntil = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date(2024, 7, 22); // "today" anchored to the sample season
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
};
const vendorById = (id) => D.vendors.find((v) => v.id === id);
const maintById = (id) => D.maintenance.find((m) => m.id === id);
const tripById = (id) => D.trips.find((t) => t.id === id);

const STATUS = {
  overdue: { label: "Overdue", cls: "overdue" },
  due: { label: "Due soon", cls: "due" },
  scheduled: { label: "Scheduled", cls: "scheduled" },
  done: { label: "Done", cls: "done" }
};
const sevLabel = { high: { t: "High", c: "overdue" }, med: { t: "Medium", c: "due" }, low: { t: "Low", c: "scheduled" } };

const CATEGORY_META = {
  "Part replacement": { color: "#B23A33", icon: "wrench" },
  "Enhancement": { color: "#3C7B74", icon: "bolt" },
  "Consumable": { color: "#C0842A", icon: "drop" },
  "Service & labor": { color: "#3C6E8E", icon: "crew" },
  "Slip & mooring": { color: "#8A5A36", icon: "anchor" }
};

/* ---------- inventory ---------- */
const INV_CATEGORIES = [
  { key: "safety", label: "Safety gear", icon: "life" },
  { key: "tanks", label: "Tanks & consumables", icon: "drop" },
  { key: "soft", label: "Comfort & soft goods", icon: "sail" },
  { key: "tackle", label: "Ground tackle", icon: "anchor" },
  { key: "spares", label: "Spares & tools", icon: "wrench" },
  { key: "electronics", label: "Electronics", icon: "bolt" }
];
const invCatLabel = (k) => (INV_CATEGORIES.find((c) => c.key === k) || { label: k }).label;
const invCatMeta = (k) => INV_CATEGORIES.find((c) => c.key === k) || { label: k, icon: "box" };

const TONE_ORDER = { overdue: 0, due: 1, good: 2 };
const TONE_BADGE = { overdue: "overdue", due: "due", good: "done" };

function invStatus(item) {
  const c = [];
  if (item.expires) { const d = daysUntil(item.expires); if (d < 0) c.push({ tone: "overdue", label: `Expired ${fmtDateShort(item.expires)}` }); else if (d <= 90) c.push({ tone: "due", label: `Expires ${fmtDateShort(item.expires)}` }); else c.push({ tone: "good", label: `Valid to ${fmtDateShort(item.expires)}` }); }
  if (item.service) { const d = daysUntil(item.service.next); if (d < 0) c.push({ tone: "overdue", label: `${item.service.task} overdue` }); else if (d <= 45) c.push({ tone: "due", label: `${item.service.task} due` }); else c.push({ tone: "good", label: "Up to date" }); }
  if (item.inspect) { const d = daysUntil(item.inspect.next); if (d < 0) c.push({ tone: "overdue", label: "Inspection overdue" }); else if (d <= 30) c.push({ tone: "due", label: "Inspect soon" }); else c.push({ tone: "good", label: "Inspected" }); }
  if (item.level) { if (item.level === "low" || item.level === "empty") c.push({ tone: "due", label: item.level === "empty" ? "Empty" : "Low" }); else c.push({ tone: "good", label: item.level === "full" ? "Full" : "OK" }); }
  if (item.condition) { if (item.condition === "attention") c.push({ tone: "overdue", label: "Needs attention" }); else if (item.condition === "fair") c.push({ tone: "due", label: "Fair condition" }); else c.push({ tone: "good", label: "Good condition" }); }
  if (item.count) { if (item.count.low) c.push({ tone: "due", label: "Low / out of stock" }); else c.push({ tone: "good", label: "In stock" }); }
  if (!c.length) c.push({ tone: "good", label: "OK" });
  c.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  return c[0];
}

function invTasks() {
  const out = [];
  const add = (it, tone, due, title) => out.push({ id: `invtask-${it.id}`, title, system: invCatLabel(it.category), tone, due, costEst: it.costEst || 0, note: it.note, source: "inventory", invId: it.id });
  window.DATA.inventory.forEach((it) => {
    if (it.expires) { const d = daysUntil(it.expires); if (d < 0) add(it, "overdue", it.expires, `Replace expired ${it.name.toLowerCase()}`); else if (d <= 90) add(it, "due", it.expires, `Replace ${it.name.toLowerCase()} \u2014 expiring`); }
    else if (it.service) { const d = daysUntil(it.service.next); if (d < 0) add(it, "overdue", it.service.next, it.service.task); else if (d <= 45) add(it, "due", it.service.next, it.service.task); }
    else if (it.inspect) { const d = daysUntil(it.inspect.next); if (d < 0) add(it, "overdue", it.inspect.next, `Inspect ${it.name.toLowerCase()}`); else if (d <= 14) add(it, "due", it.inspect.next, `Inspect ${it.name.toLowerCase()}`); }
  });
  return out;
}

/* ---------- atoms ---------- */
const StatusBadge = ({ status }) => {
  const s = STATUS[status];
  return <span className={`badge ${s.cls}`}><span className="dot"></span>{s.label}</span>;
};

const Photo = ({ label, h = 160, parchment = false, icon = "camera", style }) => (
  <div className={`photo${parchment ? " parchment" : ""}`} style={{ height: h, ...style }}>
    <span className="photo-ico"><Icon name={icon} s={26} /></span>
    {label && <span className="photo-tag">{label}</span>}
  </div>
);

const Stat = ({ label, value, sm }) => (
  <div>
    <div className="stat-label">{label}</div>
    <div className={`stat-value${sm ? " sm" : ""}`}>{value}</div>
  </div>
);

const SectionHead = ({ icon, title, action }) => (
  <div className="sec-head">
    {icon && <span style={{ color: "var(--brass-deep)" }}><Icon name={icon} s={20} /></span>}
    <h2>{title}</h2>
    <span className="sec-rule"></span>
    {action}
  </div>
);

const WeatherRow = ({ trip }) => (
  <div className="flex wrap gap-8">
    <span className="chip"><Icon name="wind" s={15} />{trip.wind}</span>
    <span className="chip"><Icon name="waves" s={15} />{trip.seas}</span>
    <span className="chip"><Icon name="sun" s={15} />{trip.sky}</span>
    <span className="chip"><Icon name="thermo" s={15} />{trip.tempF}°F</span>
  </div>
);

/* ---------- Search overlay ---------- */
function buildIndex() {
  const idx = [];
  D.trips.forEach((t) => idx.push({
    cat: "Trip logs", page: "logs", ref: t.id, icon: "log",
    title: t.title, sub: `${fmtDate(t.date)} · ${t.crew.length} aboard · ${t.distanceNm} nm`,
    blob: [t.title, t.summary, t.crew.join(" "), t.wind, t.sky, ...t.waypoints.map(w => w.name + " " + w.note), ...t.findings.map(f => f.text)].join(" ").toLowerCase()
  }));
  D.maintenance.forEach((m) => idx.push({
    cat: "Maintenance", page: "maintenance", ref: m.id, icon: "wrench",
    title: m.title, sub: `${m.system} · ${STATUS[m.status].label}`,
    blob: [m.title, m.system, m.note, m.status, ...(m.steps || [])].join(" ").toLowerCase()
  }));
  D.costs.forEach((c) => idx.push({
    cat: "Costs", page: "costs", ref: c.id, icon: "coins",
    title: c.item, sub: `${c.category} · ${fmtDate(c.date)} · ${fmtMoney(c.amount)}`,
    blob: [c.item, c.category, c.note || ""].join(" ").toLowerCase()
  }));
  D.vendors.forEach((v) => idx.push({
    cat: "Vendors", page: "vendors", ref: v.id, icon: "store",
    title: v.name, sub: `${v.type} · ${v.location}`,
    blob: [v.name, v.type, v.note, v.services.join(" ")].join(" ").toLowerCase()
  }));
  D.manuals.forEach((man) => {
    idx.push({ cat: "Manuals", page: "manuals", ref: man.id, icon: "book", title: man.title, sub: man.summary,
      blob: [man.title, man.summary, ...man.sections.map(s => s.title + " " + s.summary)].join(" ").toLowerCase() });
  });
  D.quickref.forEach((q) => idx.push({
    cat: "Manuals", page: "manuals", ref: q.id, icon: "info", title: q.title, sub: "Quick reference card",
    blob: [q.title, ...q.steps].join(" ").toLowerCase()
  }));
  (D.inventory || []).forEach((it) => idx.push({
    cat: "Inventory", page: "inventory", ref: it.id, icon: "box",
    title: it.name, sub: `${invCatLabel(it.category)} · ${it.location || ""}`,
    blob: [it.name, it.note, it.location, invCatLabel(it.category), it.service && it.service.task].join(" ").toLowerCase()
  }));
  return idx;
}
const SEARCH_INDEX = buildIndex();

function SearchOverlay({ onClose, onGo }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const words = term.split(/\s+/);
    return SEARCH_INDEX
      .map((it) => {
        let score = 0;
        words.forEach((w) => {
          if (it.title.toLowerCase().includes(w)) score += 3;
          if (it.blob.includes(w)) score += 1;
        });
        return { it, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map((r) => r.it);
  }, [q]);

  useEffect(() => { setCursor(0); }, [q]);

  const grouped = useMemo(() => {
    const g = {};
    results.forEach((r) => { (g[r.cat] = g[r.cat] || []).push(r); });
    return g;
  }, [results]);

  const onKey = (e) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && results[cursor]) { onGo(results[cursor]); }
  };

  let flat = -1;
  const suggestions = ["frayed halyard", "Gull Point", "Dana", "impeller", "zinc", "slip fee"];

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search-modal fade-in" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="search-input-row">
          <span style={{ color: "var(--brass-deep)" }}><Icon name="search" s={22} /></span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search trips, repairs, costs, manuals, vendors…" />
          <span className="muted tiny mono">ESC</span>
        </div>
        <div className="search-results">
          {!q.trim() && (
            <div style={{ padding: "16px 20px" }}>
              <div className="search-cat" style={{ padding: "0 0 8px" }}>Try</div>
              <div className="flex wrap gap-8">
                {suggestions.map((s) => (
                  <button key={s} className="chip" style={{ cursor: "pointer" }} onClick={() => setQ(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {q.trim() && results.length === 0 && (
            <div style={{ padding: "26px 20px", textAlign: "center" }} className="muted">
              Nothing aboard matches “{q}”.
            </div>
          )}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <div className="search-cat">{cat}</div>
              {items.map((it) => {
                flat += 1; const my = flat;
                return (
                  <div key={it.cat + it.ref} className={`search-hit${my === cursor ? " cursor" : ""}`}
                    onMouseEnter={() => setCursor(my)} onClick={() => onGo(it)}>
                    <span className="hit-ico"><Icon name={it.icon} s={18} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="hit-title">{it.title}</div>
                      <div className="hit-sub">{it.sub}</div>
                    </div>
                    <span className="muted" style={{ marginLeft: "auto" }}><Icon name="arrowRight" s={16} /></span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="search-foot">
          <span>↑↓ to navigate</span><span>↵ to open</span><span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Share modal (welcome link) ---------- */
function ShareModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const link = "valkyrie.example/welcome";
  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: "center", paddingTop: 0 }}>
      <div className="card fade-in" style={{ width: "min(440px,92vw)", padding: 24 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-12" style={{ marginBottom: 6 }}>
          <span style={{ color: "var(--brass-deep)" }}><Icon name="share" s={22} /></span>
          <h3 style={{ fontSize: 21 }}>Share Valkyrie's welcome page</h3>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Send this link to anyone you've invited aboard. It shows the boat, the house rules, what to bring, and what to expect — perfect for first-timers.
        </p>
        <div className="flex items-center gap-8" style={{ marginTop: 14 }}>
          <div className="mono" style={{ flex: 1, padding: "11px 14px", background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", fontSize: 13, color: "var(--ink-700)" }}>{link}</div>
          <button className="btn btn-brass" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
            <Icon name={copied ? "check" : "share"} s={16} />{copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  fmtMoney, fmtMoney0, fmtDate, fmtDateShort, daysUntil,
  vendorById, maintById, tripById, STATUS, sevLabel, CATEGORY_META,
  StatusBadge, Photo, Stat, SectionHead, WeatherRow, SearchOverlay, ShareModal,
  SEARCH_INDEX,
  INV_CATEGORIES, invCatLabel, invCatMeta, invStatus, invTasks, TONE_ORDER, TONE_BADGE
});
