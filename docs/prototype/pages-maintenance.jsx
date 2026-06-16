/* ============================================================
   Maintenance & repairs — priority queue + status board + detail
   ============================================================ */
const { useState, useEffect } = React;

function urgencyMeta(m) {
  if (m.status === "done") return { tone: "done", text: "Completed", days: null };
  const d = daysUntil(m.due);
  if (m.status === "overdue" || d < 0) return { tone: "overdue", text: d < 0 ? `${Math.abs(d)} days overdue` : "Overdue", days: d };
  if (d <= 14) return { tone: "due", text: `Due in ${d} days`, days: d };
  return { tone: "scheduled", text: `Due ${fmtDateShort(m.due)}`, days: d };
}

function MaintDetail({ item, onBack, onOpenTrip }) {
  const [done, setDone] = useState({});
  const v = item.vendorId && vendorById(item.vendorId);
  const trip = item.fromTripId && tripById(item.fromTripId);
  const u = urgencyMeta(item);
  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 980 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18 }}><Icon name="arrowLeft" s={16} />Work list</button>

        <div className="flex items-center gap-12" style={{ flexWrap: "wrap" }}>
          <StatusBadge status={item.status} />
          <span className="chip tiny"><Icon name="layers" s={14} />{item.system}</span>
          {item.status !== "done" && <span className={`badge ${u.tone}`}><span className="dot"></span>{u.text}</span>}
        </div>
        <h1 className="page-title" style={{ marginTop: 12 }}>{item.title}</h1>

        <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", marginTop: 22, alignItems: "start" }}>
          <div className="stack">
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 10 }}>What's going on</div>
              <p style={{ fontSize: 15.5, color: "var(--ink-700)", margin: 0 }}>{item.note}</p>
            </div>

            {item.steps && item.steps.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="check" title="How to fix it" />
                <div className="stack">
                  {item.steps.map((s, i) => (
                    <label key={i} className="flex gap-12" style={{ alignItems: "flex-start", cursor: "pointer" }}>
                      <button onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}
                        style={{ flex: "0 0 auto", width: 24, height: 24, borderRadius: 6, border: "1.6px solid var(--line-strong)", background: done[i] ? "var(--patina)" : "var(--paper)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginTop: 1 }}>
                        {done[i] && <Icon name="check" s={15} />}
                      </button>
                      <span style={{ fontSize: 14.5, color: done[i] ? "var(--ink-tint)" : "var(--ink-800)", textDecoration: done[i] ? "line-through" : "none", paddingTop: 2 }}>
                        <span className="mono" style={{ color: "var(--brass-deep)", marginRight: 8 }}>{i + 1}</span>{s}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="muted tiny" style={{ marginTop: 14, fontStyle: "italic" }}>
                  Tip: snap a photo of the problem and Cowork can draft these steps for you. Check them off as you go.
                </p>
              </div>
            )}

            {item.photoCount > 0 && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Photos · {item.photoCount}</div>
                <div className="grid g-3" style={{ gap: 8 }}>
                  {Array.from({ length: item.photoCount }).map((_, i) => <Photo key={i} h={96} label="" icon="camera" />)}
                </div>
              </div>
            )}
          </div>

          <div className="stack">
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Details</div>
              <div className="stack" style={{ gap: 0 }}>
                {[
                  ["Status", STATUS[item.status].label],
                  ["System", item.system],
                  ["Opened", fmtDate(item.opened)],
                  [item.status === "done" ? "Completed" : "Due", fmtDate(item.completed || item.due)],
                  ["Est. cost", item.costEst ? fmtMoney(item.costEst) : "—"]
                ].map(([k, val], i) => (
                  <div key={k} className="flex items-center" style={{ justifyContent: "space-between", padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                    <span className="muted tiny">{k}</span>
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink-800)" }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {v && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 10 }}>Suggested vendor</div>
                <div style={{ fontWeight: 600, color: "var(--ink-800)" }}>{v.name}</div>
                <div className="muted tiny" style={{ marginTop: 2 }}>{v.type}</div>
                <div className="flex gap-8 mt-8"><span className="chip tiny"><Icon name="phone" s={13} />{v.phone}</span></div>
              </div>
            )}

            {trip && (
              <div className="card card-pad" style={{ cursor: "pointer" }} onClick={() => onOpenTrip(trip.id)}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Found on</div>
                <div className="flex items-center" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{trip.title}</div>
                    <div className="muted tiny">{fmtDate(trip.date)}</div>
                  </div>
                  <Icon name="arrowRight" s={16} />
                </div>
              </div>
            )}

            {item.status !== "done" && (
              <button className="btn btn-brass" style={{ justifyContent: "center" }}><Icon name="check" s={16} />Mark complete</button>
            )}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 760px){ .page-wrap .grid[style*="1.4fr 1fr"]{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

function taskDueLabel(t) {
  const d = daysUntil(t.due);
  if (t.tone === "overdue") return d < 0 ? `${Math.abs(d)} days overdue` : "Overdue";
  if (t.tone === "due") return d >= 0 ? `Due in ${d} days` : "Due";
  return `Due ${fmtDateShort(t.due)}`;
}

function QueueRow({ task, rank, onClick }) {
  return (
    <div className="row-card" onClick={onClick}>
      <span className="mono" style={{ fontSize: 22, color: "var(--brass)", width: 30, flex: "0 0 auto", textAlign: "center" }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: "var(--ink-800)" }}>{task.title}</span>
          <span className="chip tiny"><Icon name={task.source === "inventory" ? "box" : "layers"} s={13} />{task.system}</span>
          {task.source === "inventory" && <span className="chip tiny" style={{ color: "var(--brass-deep)" }}>Inventory</span>}
        </div>
        <div className="muted tiny" style={{ marginTop: 4 }}>{(task.note || "").slice(0, 96)}…</div>
      </div>
      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
        <span className={`badge ${task.tone}`}><span className="dot"></span>{taskDueLabel(task)}</span>
        <div className="mono tiny muted" style={{ marginTop: 6 }}>{task.costEst ? `est. ${fmtMoney0(task.costEst)}` : ""}</div>
      </div>
      <Icon name="chevron" s={16} />
    </div>
  );
}

function BoardColumn({ title, tone, tasks, onOpen }) {
  return (
    <div>
      <div className="flex items-center gap-8" style={{ marginBottom: 10 }}>
        <span className={`badge ${tone}`}><span className="dot"></span>{title}</span>
        <span className="muted mono tiny">{tasks.length}</span>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {tasks.length === 0 && <div className="muted tiny" style={{ padding: "10px 0" }}>Nothing here — all clear.</div>}
        {tasks.map((t) => (
          <div key={t.id} className="card card-pad" style={{ padding: 14, cursor: "pointer" }} onClick={() => onOpen(t)}>
            <div style={{ fontWeight: 600, color: "var(--ink-800)", fontSize: 14.5 }}>{t.title}</div>
            <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 10, gap: 8 }}>
              <span className="chip tiny"><Icon name={t.source === "inventory" ? "box" : "layers"} s={13} />{t.system}</span>
              <span className="mono tiny" style={{ color: "var(--ink-tint)" }}>{tone === "done" ? (t.completed ? fmtDateShort(t.completed) : "done") : taskDueLabel(t)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaintenancePage({ focusId, clearFocus, onOpenTrip, onOpenInventory }) {
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("queue");
  useEffect(() => { if (focusId) { setOpenId(focusId); clearFocus && clearFocus(); } }, [focusId]);

  const items = window.DATA.maintenance;
  const open = openId && maintById(openId);
  if (open) return <MaintDetail item={open} onBack={() => setOpenId(null)} onOpenTrip={onOpenTrip} />;

  const realActive = items.filter((m) => m.status !== "done").map((m) => ({
    id: m.id, title: m.title, system: m.system, tone: m.status, due: m.due,
    costEst: m.costEst, note: m.note, source: "maint", priority: m.priority
  }));
  const invT = invTasks().map((t) => ({ ...t, priority: t.tone === "overdue" ? 0 : 5 }));
  const all = [...realActive, ...invT];
  const fromInv = invT.length;

  const openTask = (t) => { if (t.source === "inventory") { onOpenInventory && onOpenInventory(t.invId); } else { setOpenId(t.id); } };

  const toneOrder = { overdue: 0, due: 1, scheduled: 2 };
  const queue = [...all].sort((a, b) => (toneOrder[a.tone] - toneOrder[b.tone]) || (((a.priority == null ? 5 : a.priority)) - ((b.priority == null ? 5 : b.priority))) || (a.due || "").localeCompare(b.due || ""));

  const byTone = (tn) => all.filter((t) => t.tone === tn);
  const doneTasks = items.filter((m) => m.status === "done").map((m) => ({ id: m.id, title: m.title, system: m.system, source: "maint", completed: m.completed }));
  const counts = { overdue: byTone("overdue").length, due: byTone("due").length, scheduled: byTone("scheduled").length };
  const estOutstanding = all.reduce((s, t) => s + (t.costEst || 0), 0);

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">Keep her shipshape</span>
          <h1 className="page-title">Repairs & maintenance</h1>
          <p className="page-lead">Everything Valkyrie needs, in priority order — overdue work first, then what's coming due. Repairs from trip logs sit alongside expiring safety gear and tank servicing pulled in from inventory.</p>
        </div>

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad" style={{ borderTop: "3px solid var(--sig-overdue)" }}><Stat label="Overdue" value={counts.overdue} sm /></div>
          <div className="card card-pad" style={{ borderTop: "3px solid var(--sig-due)" }}><Stat label="Due soon" value={counts.due} sm /></div>
          <div className="card card-pad" style={{ borderTop: "3px solid var(--sig-scheduled)" }}><Stat label="Scheduled" value={counts.scheduled} sm /></div>
          <div className="card card-pad"><Stat label="Est. outstanding" value={fmtMoney0(estOutstanding)} sm /></div>
        </div>

        <div className="flex items-center" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
          <div className="flex" style={{ background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: 30, padding: 4 }}>
            {[["queue", "Priority queue", "log"], ["board", "Status board", "layers"]].map(([k, label, ico]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ display: "flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer", borderRadius: 24, padding: "7px 15px", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13, background: view === k ? "var(--ink-700)" : "transparent", color: view === k ? "#fff" : "var(--ink-600)" }}>
                <Icon name={ico} s={15} />{label}
              </button>
            ))}
          </div>
          <button className="btn btn-brass"><Icon name="plus" s={16} />Add item</button>
        </div>

        {view === "queue" && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="flex items-center" style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", background: "var(--paper-2)", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span className="eyebrow">Next up — work the list top to bottom</span>
              {fromInv > 0 && <span className="muted tiny flex items-center gap-8"><Icon name="box" s={13} />{fromInv} pulled from inventory &amp; safety</span>}
            </div>
            {queue.map((t, i) => <QueueRow key={t.id} task={t} rank={i + 1} onClick={() => openTask(t)} />)}
          </div>
        )}

        {view === "board" && (
          <div className="grid g-4" style={{ alignItems: "start" }}>
            <BoardColumn title="Overdue" tone="overdue" tasks={byTone("overdue")} onOpen={openTask} />
            <BoardColumn title="Due soon" tone="due" tasks={byTone("due")} onOpen={openTask} />
            <BoardColumn title="Scheduled" tone="scheduled" tasks={byTone("scheduled")} onOpen={openTask} />
            <BoardColumn title="Done" tone="done" tasks={doneTasks} onOpen={openTask} />
          </div>
        )}
      </div>
    </div>
  );
}

window.MaintenancePage = MaintenancePage;
