/**
 * Maintenance & repairs — the priority queue + status board + detail view,
 * recreating the VISUAL design of the prototype's pages-maintenance.jsx but
 * bound to the REAL API:
 *
 *   - the work list comes from GET /api/maintenance (frontmatter + a single
 *     Markdown `body`, NOT the prototype's separate note/steps[] mock);
 *   - the overdue/due rollup AND the inventory tasks that surface in the queue
 *     come from GET /api/derived (server-computed against the real clock) — we do
 *     NOT reimplement the prototype's hardcoded-2024 daysUntil math;
 *   - cross-links use the SPA's `?focus=` convention: a source trip ->
 *     /trips?focus=, a suggested vendor -> /vendors?focus=, an inventory queue
 *     task -> /inventory?focus=, and (owner-only) a cost -> /costs?focus=.
 *
 * COST REDACTION DEGRADES GRACEFULLY: monetary `costEst` is stripped server-side
 * for crew/guest, so when it is absent we render NO cost row, NO cost cross-link,
 * and omit the "Est. outstanding" rollup stat entirely — never a blank/$NaN cost.
 *
 * Reuses the shared app.css classes (.page/.card/.grid/.badge/.row-card/.chip/
 * .sec-head/.stat-*) and the foundation atoms; one small co-located module sheet
 * (MaintenancePage.module.css) holds the two view-toggle/step bits that have no
 * global class. The shared src/ui/styles/app.css is owned by the foundation.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon.js';
import { StatusBadge, Stat, SectionHead, Badge, type BadgeTone } from '../components/atoms.js';
import { api } from '../lib/api.js';
import { fmtDate, fmtDateShort, fmtMoney } from '../lib/format.js';
import type { MaintenanceRec, VendorRec, Derived, MaintStatus, InventoryTask } from '../lib/types.js';
import styles from './MaintenancePage.module.css';

/* ---------------------------------------------------------------- body parse */

interface ParsedBody {
  /** Narrative prose before the first "## Steps" (or "## How to fix it") heading. */
  narrative: string;
  /** Checklist items parsed from "- [ ]" / "- [x]" lines, with their done flag. */
  steps: { text: string; done: boolean }[];
}

/** Split a record body into its narrative + the steps checklist. The real
 *  records carry one Markdown `body`; the prototype had a synthetic steps[].
 *  We treat any "- [ ]"/"- [x]" line as a step (wherever it sits), and the prose
 *  before the first checklist line / "## Steps" heading as the narrative. */
function parseBody(body: string): ParsedBody {
  const lines = body.split('\n');
  const steps: { text: string; done: boolean }[] = [];
  const narrativeLines: string[] = [];
  let seenSteps = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = /^\s*[-*]\s*\[( |x|X)\]\s+(.*)$/.exec(line);
    if (m) {
      seenSteps = true;
      steps.push({ text: m[2]!.trim(), done: m[1]!.toLowerCase() === 'x' });
      continue;
    }
    // A "## Steps"/"## How to fix it" heading starts the steps block; drop it.
    if (/^\s*#{1,6}\s+(steps|how to fix)/i.test(line)) {
      seenSteps = true;
      continue;
    }
    if (!seenSteps) narrativeLines.push(raw);
  }
  return { narrative: narrativeLines.join('\n').trim(), steps };
}

/** photos/<name>.jpg in a record resolves to the GET /photos/:name route. */
function photoUrl(ref: string): string {
  return ref.startsWith('/') ? ref : `/${ref}`;
}

/* --------------------------------------------------------------- urgency meta */

const STATUS_LABEL: Record<MaintStatus, string> = {
  overdue: 'Overdue',
  due: 'Due soon',
  scheduled: 'Scheduled',
  done: 'Done',
};

/* ------------------------------------------------------------- queue task model */

type QueueSource = 'maint' | 'inventory';

interface QueueTask {
  key: string;
  source: QueueSource;
  /** maintenance id, or inventory id for an inventory task. */
  refId: string;
  tone: 'overdue' | 'due' | 'scheduled';
  title: string;
  system: string;
  due?: string;
  note: string;
  priority: number;
  costEst?: number;
}

const INV_KIND_LABEL: Record<InventoryTask['kind'], string> = {
  inspect: 'Inspection due',
  service: 'Service due',
  expires: 'Expires',
};

function daysFromToday(due: string | undefined, now: Date): number | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

function dueLabel(task: { tone: QueueTask['tone']; due?: string }, now: Date): string {
  const d = daysFromToday(task.due, now);
  if (task.tone === 'overdue') return d !== null && d < 0 ? `${Math.abs(d)} days overdue` : 'Overdue';
  if (task.tone === 'due') return d !== null && d >= 0 ? `Due in ${d} days` : 'Due soon';
  return task.due ? `Due ${fmtDateShort(task.due)}` : 'Scheduled';
}

const TONE_ORDER: Record<QueueTask['tone'], number> = { overdue: 0, due: 1, scheduled: 2 };

/* ============================================================== detail view */

function MaintDetail({
  item,
  vendor,
  onBack,
}: {
  item: MaintenanceRec;
  vendor: VendorRec | undefined;
  onBack: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const [done, setDone] = useState<Record<number, boolean>>({});
  const parsed = useMemo(() => parseBody(item.body), [item.body]);
  const now = useMemo(() => new Date(), []);

  const hasCost = item.costEst !== undefined && item.costEst !== null;
  const u = dueLabel({ tone: (item.status === 'done' ? 'scheduled' : item.status) as QueueTask['tone'], due: item.due }, now);

  // Detail rows; the cost row is omitted entirely when costEst is absent
  // (crew/guest had it stripped server-side — never render a blank cost row).
  const rows: [string, string][] = [
    ['Status', STATUS_LABEL[item.status]],
    ...(item.system ? ([['System', item.system]] as [string, string][]) : []),
    ...(item.opened ? ([['Opened', fmtDate(item.opened)]] as [string, string][]) : []),
    [item.status === 'done' ? 'Completed' : 'Due', fmtDate(item.completed ?? item.due)],
  ];

  return (
    <div className="page fade-in" data-testid="maint-detail">
      <div className="page-wrap" style={{ maxWidth: 980 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Work list
        </button>

        <div className="flex items-center gap-12 wrap">
          <StatusBadge status={item.status} />
          {item.system && (
            <span className="chip tiny"><Icon name="layers" s={14} />{item.system}</span>
          )}
          {item.status !== 'done' && (
            <Badge tone={item.status as BadgeTone}>{u}</Badge>
          )}
        </div>
        <h1 className="page-title" style={{ marginTop: 12 }}>{item.title}</h1>

        <div className={`grid ${styles.detailGrid}`} style={{ marginTop: 22, alignItems: 'start' }}>
          <div className="stack">
            {parsed.narrative && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 10 }}>What&rsquo;s going on</div>
                <p style={{ fontSize: 15.5, color: 'var(--ink-700)', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {parsed.narrative}
                </p>
              </div>
            )}

            {parsed.steps.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="check" title="How to fix it" />
                <div className="stack">
                  {parsed.steps.map((s, i) => {
                    const checked = done[i] ?? s.done;
                    return (
                      <label key={i} className={styles.step}>
                        <button
                          type="button"
                          aria-pressed={checked}
                          aria-label={`Toggle step ${i + 1}`}
                          className={`${styles.stepBox}${checked ? ` ${styles.stepBoxOn}` : ''}`}
                          onClick={() => setDone((d) => ({ ...d, [i]: !checked }))}
                        >
                          {checked && <Icon name="check" s={15} />}
                        </button>
                        <span
                          className={styles.stepText}
                          style={{
                            color: checked ? 'var(--ink-tint)' : 'var(--ink-800)',
                            textDecoration: checked ? 'line-through' : 'none',
                          }}
                        >
                          <span className="mono" style={{ color: 'var(--brass-deep)', marginRight: 8 }}>{i + 1}</span>
                          {s.text}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="muted tiny" style={{ marginTop: 14, fontStyle: 'italic' }}>
                  Tip: snap a photo of the problem and Cowork can draft these steps for you. Check them off as you go.
                </p>
              </div>
            )}

            {item.photos && item.photos.length > 0 && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Photos &middot; {item.photos.length}</div>
                <div className="grid g-3" style={{ gap: 8 }}>
                  {item.photos.map((ref) => (
                    <img
                      key={ref}
                      className={styles.photo}
                      src={photoUrl(ref)}
                      alt={`${item.title} photo`}
                      loading="lazy"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="stack">
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Details</div>
              <div className="stack" style={{ gap: 0 }}>
                {rows.map(([k, val], i) => (
                  <div
                    key={k}
                    className="flex items-center"
                    style={{ justifyContent: 'space-between', padding: '9px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}
                  >
                    <span className="muted tiny">{k}</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink-800)' }}>{val}</span>
                  </div>
                ))}
                {/* Cost row: owner-only. Absent (and so not rendered) for crew/guest. */}
                {hasCost && (
                  <div
                    className="flex items-center"
                    data-testid="detail-cost"
                    style={{ justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid var(--line)' }}
                  >
                    <span className="muted tiny">Est. cost</span>
                    <button
                      type="button"
                      data-testid="cost-link"
                      className={styles.costLink}
                      onClick={() => navigate(`/costs?focus=${encodeURIComponent(item.id)}`)}
                      title="See related costs"
                    >
                      <span className="mono" style={{ fontSize: 13 }}>{fmtMoney(item.costEst)}</span>
                      <Icon name="arrowRight" s={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {vendor && (
              <button
                type="button"
                data-testid="vendor-link"
                className={`card card-pad ${styles.linkCard}`}
                onClick={() => navigate(`/vendors?focus=${encodeURIComponent(vendor.id)}`)}
              >
                <div className="eyebrow" style={{ marginBottom: 10 }}>Suggested vendor</div>
                <div style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{vendor.name}</div>
                {vendor.services && vendor.services.length > 0 && (
                  <div className="muted tiny" style={{ marginTop: 2 }}>{vendor.services.join(' · ')}</div>
                )}
                {vendor.phone && (
                  <div className="flex gap-8" style={{ marginTop: 8 }}>
                    <span className="chip tiny"><Icon name="phone" s={13} />{vendor.phone}</span>
                  </div>
                )}
              </button>
            )}

            {item.fromTripId && (
              <button
                type="button"
                data-testid="trip-link"
                className={`card card-pad ${styles.linkCard}`}
                onClick={() => navigate(`/trips?focus=${encodeURIComponent(item.fromTripId!)}`)}
              >
                <div className="eyebrow" style={{ marginBottom: 8 }}>Found on</div>
                <div className="flex items-center" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink-800)', fontSize: 14.5 }}>View source trip log</div>
                  <Icon name="arrowRight" s={16} />
                </div>
              </button>
            )}

            {item.status !== 'done' && (
              <button
                className="btn btn-brass"
                style={{ justifyContent: 'center' }}
                disabled
                title="Marking complete arrives in a later milestone"
              >
                <Icon name="check" s={16} />Mark complete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================== queue + board */

function QueueRow({ task, rank, onOpen }: { task: QueueTask; rank: number; onOpen: () => void }): JSX.Element {
  const now = useMemo(() => new Date(), []);
  return (
    <div
      className="row-card"
      onClick={onOpen}
      data-testid={task.source === 'inventory' ? `queue-${task.refId}` : undefined}
    >
      <span className="mono" style={{ fontSize: 22, color: 'var(--brass)', width: 30, flex: '0 0 auto', textAlign: 'center' }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-8 wrap">
          <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{task.title}</span>
          <span className="chip tiny">
            <Icon name={task.source === 'inventory' ? 'box' : 'layers'} s={13} />{task.system}
          </span>
          {task.source === 'inventory' && (
            <span className="chip tiny" style={{ color: 'var(--brass-deep)' }}>Inventory</span>
          )}
        </div>
        {task.note && (
          <div className="muted tiny" style={{ marginTop: 4 }}>{task.note.slice(0, 96)}</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <Badge tone={task.tone}>{dueLabel(task, now)}</Badge>
        {task.costEst !== undefined && (
          <div className="mono tiny muted" style={{ marginTop: 6 }}>est. {fmtMoney(task.costEst)}</div>
        )}
      </div>
      {/* a button so the inventory cross-link is reachable + testable as a control */}
      <button
        type="button"
        className={styles.rowGo}
        aria-label={`Open ${task.title}`}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <Icon name="chevron" s={16} />
      </button>
    </div>
  );
}

function BoardColumn({
  title,
  tone,
  tasks,
  onOpen,
  now,
}: {
  title: string;
  tone: BadgeTone;
  tasks: { key: string; title: string; system: string; due?: string; completed?: string | null; tone: QueueTask['tone'] | 'done'; onOpen: () => void }[];
  onOpen: (key: string) => void;
  now: Date;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-8" style={{ marginBottom: 10 }}>
        <Badge tone={tone}>{title}</Badge>
        <span className="muted mono tiny">{tasks.length}</span>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {tasks.length === 0 && <div className="muted tiny" style={{ padding: '10px 0' }}>Nothing here — all clear.</div>}
        {tasks.map((t) => (
          <div key={t.key} className="card card-pad" style={{ padding: 14, cursor: 'pointer' }} onClick={() => onOpen(t.key)}>
            <div style={{ fontWeight: 600, color: 'var(--ink-800)', fontSize: 14.5 }}>{t.title}</div>
            <div className="flex items-center" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
              <span className="chip tiny"><Icon name="layers" s={13} />{t.system}</span>
              <span className="mono tiny" style={{ color: 'var(--ink-tint)' }}>
                {tone === 'done'
                  ? (t.completed ? fmtDateShort(t.completed) : 'done')
                  : dueLabel({ tone: t.tone as QueueTask['tone'], due: t.due }, now)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================== page */

type View = 'queue' | 'board';

export default function MaintenancePage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const focus = search.get('focus');
  const openId = id ?? focus ?? null;

  const [items, setItems] = useState<MaintenanceRec[] | null>(null);
  const [vendors, setVendors] = useState<VendorRec[]>([]);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('queue');
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([api.maintenance(), api.derived(), api.vendors().catch(() => [] as VendorRec[])])
      .then(([m, d, v]) => {
        if (!alive) return;
        setItems(m);
        setDerived(d);
        setVendors(v);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load maintenance');
      });
    return () => { alive = false; };
  }, []);

  const open = openId && items ? items.find((m) => m.id === openId) : undefined;
  const openVendor = open?.vendorId ? vendors.find((v) => v.id === open.vendorId) : undefined;

  // Active maintenance tasks -> queue rows.
  const maintActive = useMemo<QueueTask[]>(() => {
    if (!items) return [];
    return items
      .filter((m) => m.status !== 'done')
      .map((m) => ({
        key: `m:${m.id}`,
        source: 'maint' as const,
        refId: m.id,
        tone: m.status as QueueTask['tone'],
        title: m.title,
        system: m.system ?? 'General',
        due: m.due,
        note: parseBody(m.body).narrative,
        priority: m.priority ?? 5,
        costEst: m.costEst,
      }));
  }, [items]);

  // Inventory tasks from the server-computed derived view -> queue rows.
  const invTasks = useMemo<QueueTask[]>(() => {
    if (!derived) return [];
    return derived.inventoryTasks.map((t) => ({
      key: `inv:${t.invId}:${t.kind}`,
      source: 'inventory' as const,
      refId: t.invId,
      tone: t.status as QueueTask['tone'],
      title: t.invId,
      system: INV_KIND_LABEL[t.kind],
      due: t.date,
      note: '',
      priority: t.status === 'overdue' ? 0 : 5,
    }));
  }, [derived]);

  const all = useMemo(() => [...maintActive, ...invTasks], [maintActive, invTasks]);
  const fromInv = invTasks.length;

  const queue = useMemo(
    () =>
      [...all].sort(
        (a, b) =>
          (TONE_ORDER[a.tone] - TONE_ORDER[b.tone]) ||
          (a.priority - b.priority) ||
          (a.due ?? '').localeCompare(b.due ?? ''),
      ),
    [all],
  );

  const byTone = (tn: QueueTask['tone']): QueueTask[] => all.filter((t) => t.tone === tn);
  const counts = { overdue: byTone('overdue').length, due: byTone('due').length, scheduled: byTone('scheduled').length };

  // Est. outstanding is owner-only: it is the sum of present costEsts. When NO
  // task carries a cost (crew/guest had them stripped), we omit the stat entirely.
  const costTasks = all.filter((t) => t.costEst !== undefined);
  const hasAnyCost = costTasks.length > 0;
  const estOutstanding = costTasks.reduce((s, t) => s + (t.costEst ?? 0), 0);

  const doneItems = useMemo(() => (items ?? []).filter((m) => m.status === 'done'), [items]);

  const openTask = (t: QueueTask): void => {
    if (t.source === 'inventory') {
      navigate(`/inventory?focus=${encodeURIComponent(t.refId)}`);
    } else {
      navigate(`/maintenance/${encodeURIComponent(t.refId)}`);
    }
  };

  const back = (): void => { void navigate('/maintenance'); };

  if (error) {
    return (
      <div className="page fade-in">
        <div className="page-wrap">
          <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-tint)' }}>
            <div style={{ color: 'var(--brass-deep)', marginBottom: 8 }}><Icon name="alert" s={28} /></div>
            <div style={{ fontWeight: 600, color: 'var(--ink-700)' }}>Couldn&rsquo;t load maintenance</div>
            <div className="muted" style={{ marginTop: 4 }}>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (open) return <MaintDetail item={open} vendor={openVendor} onBack={back} />;

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">Keep her shipshape</span>
          <h1 className="page-title">Repairs &amp; maintenance</h1>
          <p className="page-lead">
            Everything she needs, in priority order — overdue work first, then what&rsquo;s coming due.
            Repairs from trip logs sit alongside expiring safety gear and servicing pulled in from inventory.
          </p>
        </div>

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad" style={{ borderTop: '3px solid var(--sig-overdue)' }} data-testid="rollup-overdue">
            <Stat label="Overdue" value={counts.overdue} sm />
          </div>
          <div className="card card-pad" style={{ borderTop: '3px solid var(--sig-due)' }} data-testid="rollup-due">
            <Stat label="Due soon" value={counts.due} sm />
          </div>
          <div className="card card-pad" style={{ borderTop: '3px solid var(--sig-scheduled)' }} data-testid="rollup-scheduled">
            <Stat label="Scheduled" value={counts.scheduled} sm />
          </div>
          {/* Est. outstanding — owner-only; omitted when no task carries a cost. */}
          {hasAnyCost && (
            <div className="card card-pad" data-testid="rollup-est">
              <Stat label="Est. outstanding" value={fmtMoney(estOutstanding)} sm />
            </div>
          )}
        </div>

        <div className="flex items-center wrap" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div className={`flex ${styles.toggle}`}>
            {([['queue', 'Priority queue', 'log'], ['board', 'Status board', 'layers']] as [View, string, IconName][]).map(
              ([k, label, ico]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  className={`${styles.toggleBtn}${view === k ? ` ${styles.toggleBtnOn}` : ''}`}
                >
                  <Icon name={ico} s={15} />{label}
                </button>
              ),
            )}
          </div>
          <button className="btn btn-brass" disabled title="Adding items arrives in a later milestone">
            <Icon name="plus" s={16} />Add item
          </button>
        </div>

        {items === null && <div className="muted" style={{ padding: '20px 0' }}>Loading the work list…</div>}

        {items !== null && view === 'queue' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              className="flex items-center wrap"
              style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)', justifyContent: 'space-between', gap: 8 }}
            >
              <span className="eyebrow">Next up — work the list top to bottom</span>
              {fromInv > 0 && (
                <span className="muted tiny flex items-center gap-8">
                  <Icon name="box" s={13} />{fromInv} pulled from inventory &amp; safety
                </span>
              )}
            </div>
            {queue.length === 0 && (
              <div className="muted" style={{ padding: '22px 18px', textAlign: 'center' }}>
                Nothing outstanding — she&rsquo;s all caught up.
              </div>
            )}
            {queue.map((t, i) => (
              <QueueRow key={t.key} task={t} rank={i + 1} onOpen={() => openTask(t)} />
            ))}
          </div>
        )}

        {items !== null && view === 'board' && (
          <div className="grid g-4" style={{ alignItems: 'start' }}>
            <BoardColumn
              title="Overdue" tone="overdue" now={now}
              tasks={byTone('overdue').map((t) => ({ key: t.key, title: t.title, system: t.system, due: t.due, tone: t.tone, onOpen: () => openTask(t) }))}
              onOpen={(key) => { const t = all.find((x) => x.key === key); if (t) openTask(t); }}
            />
            <BoardColumn
              title="Due soon" tone="due" now={now}
              tasks={byTone('due').map((t) => ({ key: t.key, title: t.title, system: t.system, due: t.due, tone: t.tone, onOpen: () => openTask(t) }))}
              onOpen={(key) => { const t = all.find((x) => x.key === key); if (t) openTask(t); }}
            />
            <BoardColumn
              title="Scheduled" tone="scheduled" now={now}
              tasks={byTone('scheduled').map((t) => ({ key: t.key, title: t.title, system: t.system, due: t.due, tone: t.tone, onOpen: () => openTask(t) }))}
              onOpen={(key) => { const t = all.find((x) => x.key === key); if (t) openTask(t); }}
            />
            <BoardColumn
              title="Done" tone="done" now={now}
              tasks={doneItems.map((m) => ({ key: `m:${m.id}`, title: m.title, system: m.system ?? 'General', completed: m.completed, tone: 'done' as const, onOpen: () => navigate(`/maintenance/${encodeURIComponent(m.id)}`) }))}
              onOpen={(key) => { const realId = key.replace(/^m:/, ''); navigate(`/maintenance/${encodeURIComponent(realId)}`); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
