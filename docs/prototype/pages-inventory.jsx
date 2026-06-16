/* ============================================================
   Inventory — what's aboard & is it ready
   Ready-to-sail panel + category sections + expandable detail
   ============================================================ */
const { useState, useEffect } = React;

const TONE_TEXT = { overdue: "var(--sig-overdue)", due: "var(--sig-due)", good: "var(--sig-good)" };
const TONE_ICON = { overdue: "alert", due: "clock", good: "check" };

function invFacts(it) {
  const f = [];
  f.push(["Location", it.location || "—"]);
  if (it.qty) f.push(["Quantity", it.qty]);
  if (it.count) f.push(["In stock", String(it.count.qty)]);
  if (it.expires) f.push(["Expires", fmtDate(it.expires)]);
  if (it.inspect) { if (it.inspect.last) f.push(["Last inspected", fmtDate(it.inspect.last)]); f.push(["Next inspection", fmtDate(it.inspect.next)]); if (it.inspect.every) f.push(["Interval", "every " + it.inspect.every]); }
  if (it.service) { f.push(["Service task", it.service.task]); if (it.service.last) f.push(["Last done", fmtDate(it.service.last)]); f.push(["Next due", fmtDate(it.service.next)]); if (it.service.every) f.push(["Interval", "every " + it.service.every]); }
  if (it.level) f.push(["Level", it.level === "ok" ? "OK" : it.level.charAt(0).toUpperCase() + it.level.slice(1)]);
  if (it.condition) f.push(["Condition", it.condition.charAt(0).toUpperCase() + it.condition.slice(1)]);
  return f;
}

function InvRow({ item, open, onToggle, onOpenCost }) {
  const st = invStatus(item);
  const cls = st.tone === "good" ? "done" : st.tone;
  return (
    <div style={{ borderTop: "1px solid var(--line)" }}>
      <div className="find-row" onClick={onToggle} style={{ background: open ? "var(--paper-2)" : "var(--paper)" }}>
        <span style={{ color: TONE_TEXT[st.tone], flex: "0 0 auto" }}><Icon name={TONE_ICON[st.tone]} s={17} /></span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink-800)" }}>{item.name}</span>
            {item.required && <span className="chip tiny" style={{ color: "var(--brass-deep)" }}><Icon name="life" s={12} />Required</span>}
          </div>
          <div className="muted tiny" style={{ marginTop: 2 }}>{item.location}{item.qty ? ` · ${item.qty}` : ""}</div>
        </div>
        <span className={`badge ${cls}`} style={{ marginRight: 4 }}><span className="dot"></span>{st.label}</span>
        <span style={{ color: "var(--ink-tint)", flex: "0 0 auto", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Icon name="chevron" s={16} /></span>
      </div>
      {open && (
        <div style={{ padding: "4px 18px 18px 47px", background: "var(--paper-2)" }}>
          <p style={{ fontSize: 14, color: "var(--ink-700)", margin: "0 0 14px" }}>{item.note}</p>
          <div className="grid g-3" style={{ gap: 12 }}>
            {invFacts(item).map(([k, v]) => (
              <div key={k}><div className="stat-label" style={{ fontSize: 9.5 }}>{k}</div><div className="mono" style={{ fontSize: 13, color: "var(--ink-800)", marginTop: 3 }}>{v}</div></div>
            ))}
          </div>
          {item.photoCount > 0 && (
            <div className="flex gap-8" style={{ marginTop: 14 }}>
              {Array.from({ length: Math.min(3, item.photoCount) }).map((_, i) => <Photo key={i} h={70} style={{ width: 100 }} label="" />)}
            </div>
          )}
          <div className="flex wrap gap-8" style={{ marginTop: 14 }}>
            {(item.expires || item.count || item.level) && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={(e) => { e.stopPropagation(); onOpenCost(); }}><Icon name="coins" s={14} />Log replacement</button>}
            {item.inspect && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={(e) => e.stopPropagation()}><Icon name="check" s={14} />Mark inspected</button>}
            {item.service && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={(e) => e.stopPropagation()}><Icon name="check" s={14} />Mark serviced</button>}
            <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={(e) => e.stopPropagation()}><Icon name="camera" s={14} />Add photo</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadyPanel({ onOpenItem }) {
  const required = window.DATA.inventory.filter((it) => it.required);
  const rows = required.map((it) => ({ it, st: invStatus(it) }));
  const fails = rows.filter((r) => r.st.tone === "overdue");
  const warns = rows.filter((r) => r.st.tone === "due");
  const overall = fails.length ? "fail" : warns.length ? "warn" : "ready";
  const meta = {
    ready: { color: "var(--sig-good)", bg: "var(--sig-good-bg)", icon: "check", head: "Ready to sail", sub: "All required safety gear is aboard and in date." },
    warn: { color: "var(--sig-due)", bg: "var(--sig-due-bg)", icon: "clock", head: "Nearly ready", sub: `${warns.length} item${warns.length > 1 ? "s" : ""} coming due — fine to sail, but top them up soon.` },
    fail: { color: "var(--sig-overdue)", bg: "var(--sig-overdue-bg)", icon: "alert", head: "Attention needed before guests", sub: `${fails.length} required item${fails.length > 1 ? "s" : ""} need${fails.length > 1 ? "" : "s"} sorting, plus ${warns.length} coming due.` }
  }[overall];

  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 24 }}>
      <div className="flex items-center gap-16" style={{ padding: "18px 20px", background: meta.bg, borderBottom: "1px solid var(--line)" }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: meta.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name={meta.icon} s={28} /></span>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ color: meta.color }}>Ready to sail?</div>
          <h3 style={{ fontSize: 22, marginTop: 2 }}>{meta.head}</h3>
          <div className="muted" style={{ fontSize: 14, marginTop: 3 }}>{meta.sub}</div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div className="stat-value" style={{ fontSize: 26, color: meta.color }}>{rows.length - fails.length - warns.length}/{rows.length}</div>
          <div className="stat-label">in date</div>
        </div>
      </div>
      <div className="grid g-3" style={{ gap: 0 }}>
        {rows.map(({ it, st }, i) => (
          <button key={it.id} onClick={() => onOpenItem(it.id)}
            className="ready-item flex items-center gap-12"
            style={{ padding: "12px 16px", borderTop: i >= 3 ? "1px solid var(--line)" : "none", borderLeft: i % 3 ? "1px solid var(--line)" : "none", background: "var(--paper)", cursor: "pointer", textAlign: "left", width: "100%" }}>
            <span style={{ color: TONE_TEXT[st.tone], flex: "0 0 auto" }}><Icon name={TONE_ICON[st.tone]} s={18} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink-800)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
              <div className="muted tiny" style={{ color: TONE_TEXT[st.tone] }}>{st.label}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function InventoryPage({ focusId, clearFocus, onOpenCost }) {
  const [openItem, setOpenItem] = useState(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  useEffect(() => { if (focusId) { setOpenItem(focusId); clearFocus && clearFocus(); } }, [focusId]);

  const inv = window.DATA.inventory;
  const attention = inv.filter((it) => invStatus(it).tone === "overdue").length;
  const coming = inv.filter((it) => invStatus(it).tone === "due").length;
  const requiredOk = inv.filter((it) => it.required && invStatus(it).tone === "good").length;
  const requiredTotal = inv.filter((it) => it.required).length;

  const toggle = (id) => setOpenItem((o) => (o === id ? null : id));

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">What's aboard &amp; is it ready</span>
          <h1 className="page-title">Inventory</h1>
          <p className="page-lead">Everything aboard Valkyrie — safety gear, tanks, soft goods, ground tackle, spares and electronics. Anything with an expiry, inspection or service date flows into the maintenance list automatically.</p>
        </div>

        <ReadyPanel onOpenItem={(id) => { setAttentionOnly(false); setOpenItem(id); window.scrollTo({ top: 0 }); }} />

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad"><Stat label="Items aboard" value={inv.length} sm /></div>
          <div className="card card-pad" style={{ borderTop: "3px solid var(--sig-overdue)" }}><Stat label="Need attention" value={attention} sm /></div>
          <div className="card card-pad" style={{ borderTop: "3px solid var(--sig-due)" }}><Stat label="Coming due" value={coming} sm /></div>
          <div className="card card-pad"><Stat label="Required in date" value={`${requiredOk}/${requiredTotal}`} sm /></div>
        </div>

        <div className="flex items-center" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div className="flex" style={{ background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: 30, padding: 4 }}>
            {[["all", "All items"], ["att", "Needs attention"]].map(([k, label]) => {
              const on = (k === "att") === attentionOnly;
              return (
                <button key={k} onClick={() => setAttentionOnly(k === "att")}
                  style={{ border: "none", cursor: "pointer", borderRadius: 24, padding: "7px 15px", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13, background: on ? "var(--ink-700)" : "transparent", color: on ? "#fff" : "var(--ink-600)" }}>
                  {label}{k === "att" && (attention + coming) > 0 ? ` (${attention + coming})` : ""}
                </button>
              );
            })}
          </div>
          <button className="btn btn-brass"><Icon name="plus" s={16} />Add item</button>
        </div>

        {INV_CATEGORIES.map((cat) => {
          let items = inv.filter((it) => it.category === cat.key);
          if (attentionOnly) items = items.filter((it) => invStatus(it).tone !== "good");
          if (items.length === 0) return null;
          return (
            <div key={cat.key} style={{ marginBottom: 26 }}>
              <SectionHead icon={cat.icon} title={cat.label} action={<span className="muted mono tiny">{items.length}</span>} />
              <div className="card" style={{ overflow: "hidden" }}>
                {items.map((it) => (
                  <InvRow key={it.id} item={it} open={openItem === it.id} onToggle={() => toggle(it.id)} onOpenCost={onOpenCost} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <style>{`.ready-item:hover{ background:var(--paper-2) !important; }`}</style>
    </div>
  );
}

window.InventoryPage = InventoryPage;
