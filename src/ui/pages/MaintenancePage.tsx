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
import {
  RecordForm,
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  SelectField,
  type SelectOption,
  buildPayload,
} from '../components/forms/index.js';
import { api } from '../lib/api.js';
import { useSession } from '../state/session.js';
import { fmtDate, fmtDateShort, fmtMoney } from '../lib/format.js';
import type { MaintenanceRec, VendorRec, TripRec, Derived, MaintStatus, InventoryTask } from '../lib/types.js';
import styles from './MaintenancePage.module.css';

/** Today as an ISO YYYY-MM-DD (for defaulting the "completed" date). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'due', label: 'Due soon' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'done', label: 'Done' },
];

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

/* ============================================================ mark-complete op */

/** The crew + owner "mark complete" control: a button that reveals an inline
 *  panel with an optional completed-date (defaults to today) + a note, then POSTs
 *  /api/maintenance/:id/complete. It is a narrow op that can NEVER touch costEst —
 *  no cost field is ever rendered here. Hidden in demo by the caller. */
function MaintComplete({ item, onDone }: { item: MaintenanceRec; onDone: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-brass"
        style={{ justifyContent: 'center' }}
        onClick={() => setOpen(true)}
      >
        <Icon name="check" s={16} />Mark complete
      </button>
    );
  }

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.completeMaintenance(item.id, {
        completed: completed || todayIso(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not mark this complete.');
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad" data-testid="complete-panel">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Mark complete</div>
      {error && (
        <div className="muted tiny" role="alert" style={{ color: 'var(--sig-overdue)', marginBottom: 10 }}>{error}</div>
      )}
      <DateField label="Completed on" value={completed} onChange={setCompleted} />
      <TextAreaField
        label="Note"
        value={note}
        onChange={setNote}
        rows={3}
        placeholder="What was done (optional)"
      />
      <div className="flex gap-8" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-brass" disabled={busy} onClick={() => void submit()}>
          <Icon name="check" s={16} />{busy ? 'Saving…' : 'Confirm complete'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ============================================================ delete control */

/** Owner-only delete with a two-step confirm guarding the destructive op. */
function MaintDelete({ item, onDeleted }: { item: MaintenanceRec; onDeleted: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMaintenance(item.id);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete this item.');
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ justifyContent: 'center', color: 'var(--sig-overdue)' }}
        onClick={() => setConfirming(true)}
      >
        <Icon name="close" s={16} />Delete item
      </button>
    );
  }

  return (
    <div className="card card-pad" data-testid="delete-panel" style={{ borderColor: 'var(--sig-overdue)' }}>
      <div className="muted tiny" style={{ marginBottom: 10, color: 'var(--ink-700)' }}>
        Delete this maintenance item? This cannot be undone.
      </div>
      {error && (
        <div className="muted tiny" role="alert" style={{ color: 'var(--sig-overdue)', marginBottom: 10 }}>{error}</div>
      )}
      <div className="flex gap-8">
        <button
          type="button"
          className="btn btn-brass"
          style={{ background: 'var(--sig-overdue)', borderColor: 'var(--sig-overdue)' }}
          disabled={busy}
          onClick={() => void remove()}
        >
          <Icon name="close" s={16} />{busy ? 'Deleting…' : 'Confirm delete'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ============================================================ create / edit form */

interface MaintFormState {
  title: string;
  system: string;
  status: string;
  priority: string;
  opened: string;
  due: string;
  costEst: string;
  vendorId: string;
  fromTripId: string;
  body: string;
}

function toFormState(item?: MaintenanceRec): MaintFormState {
  return {
    title: item?.title ?? '',
    system: item?.system ?? '',
    status: item?.status ?? 'scheduled',
    priority: item?.priority !== undefined ? String(item.priority) : '',
    opened: item?.opened ?? '',
    due: item?.due ?? '',
    costEst: item?.costEst !== undefined && item?.costEst !== null ? String(item.costEst) : '',
    vendorId: item?.vendorId ?? '',
    fromTripId: item?.fromTripId ?? '',
    body: item?.body ?? '',
  };
}

/** Owner-only create/edit form. It exposes the full maintenance shape, INCLUDING
 *  the monetary costEst input and the vendor + source-trip pickers — affordances
 *  crew never sees (the caller renders this for owner only; the API 403s crew). */
function MaintForm({
  item,
  vendors,
  trips,
  onSaved,
  onCancel,
}: {
  item?: MaintenanceRec;
  vendors: VendorRec[];
  trips: TripRec[];
  onSaved: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [s, setS] = useState<MaintFormState>(() => toFormState(item));
  const set = <K extends keyof MaintFormState>(k: K, v: MaintFormState[K]): void =>
    setS((prev) => ({ ...prev, [k]: v }));

  const vendorOptions: SelectOption[] = vendors.map((v) => ({ value: v.id, label: v.name }));
  const tripOptions: SelectOption[] = trips
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ value: t.id, label: t.title ?? fmtDate(t.date) }));

  const submit = async (): Promise<void> => {
    const payload = buildPayload(
      {
        title: s.title,
        system: s.system,
        status: s.status,
        priority: s.priority,
        opened: s.opened,
        due: s.due,
        costEst: s.costEst,
        vendorId: s.vendorId,
        fromTripId: s.fromTripId,
        body: s.body,
      },
      { numbers: ['priority', 'costEst'] },
    );
    // `status` is required by the schema; buildPayload would omit it only if blank,
    // and the select always carries a valid enum, so it is always present here.
    if (item) await api.updateMaintenance(item.id, payload);
    else await api.createMaintenance(payload);
    onSaved();
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 720 }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />{item ? 'Back to item' : 'Work list'}
        </button>
        <div className="card card-pad">
          <RecordForm
            eyebrow={item ? 'Edit maintenance item' : 'New maintenance item'}
            title={item ? (item.title || 'Edit item') : 'Add to the work list'}
            onSubmit={submit}
            onCancel={onCancel}
          >
            <TextField label="Title" required value={s.title} onChange={(v) => set('title', v)} placeholder="What needs doing" />
            <TextField label="System" value={s.system} onChange={(v) => set('system', v)} placeholder="Engine, Hull, Electronics…" />
            <SelectField label="Status" value={s.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} placeholder="Scheduled" />
            <NumberField label="Priority" value={s.priority} onChange={(v) => set('priority', v)} min={1} step={1} hint="Lower numbers rise to the top of the queue." />
            <DateField label="Opened" value={s.opened} onChange={(v) => set('opened', v)} />
            <DateField label="Due" value={s.due} onChange={(v) => set('due', v)} />
            {/* costEst is OWNER-ONLY — this whole form is owner-gated by the caller. */}
            <NumberField label="Estimated cost" value={s.costEst} onChange={(v) => set('costEst', v)} min={0} step="0.01" hint="Visible to the owner only." />
            <SelectField label="Vendor" value={s.vendorId} onChange={(v) => set('vendorId', v)} options={vendorOptions} placeholder="— No vendor —" />
            <SelectField label="Source trip" value={s.fromTripId} onChange={(v) => set('fromTripId', v)} options={tripOptions} placeholder="— Not from a trip —" />
            <TextAreaField label="Notes & steps" value={s.body} onChange={(v) => set('body', v)} placeholder={'What’s going on, and a "- [ ]" checklist of steps.'} />
          </RecordForm>
        </div>
      </div>
    </div>
  );
}

/* ============================================================== detail view */

function MaintDetail({
  item,
  vendor,
  onBack,
  canComplete,
  canManage,
  onChanged,
  onEdit,
  onDeleted,
}: {
  item: MaintenanceRec;
  vendor: VendorRec | undefined;
  onBack: () => void;
  /** Crew + owner (not demo): may mark the item complete. */
  canComplete: boolean;
  /** Owner only (not demo): may full-edit + delete. */
  canManage: boolean;
  /** Refresh the dataset after a mark-complete. */
  onChanged: () => void;
  /** Open the owner edit form. */
  onEdit: () => void;
  /** After a delete: refresh + return to the list. */
  onDeleted: () => void;
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

            {/* Mark complete — crew + owner, only on a not-done item, hidden in demo. */}
            {canComplete && item.status !== 'done' && (
              <MaintComplete item={item} onDone={onChanged} />
            )}

            {/* Full edit + delete — owner only, hidden in demo. costEst lives behind
                this owner gate; crew never sees an edit/delete affordance. */}
            {canManage && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'center' }}
                  onClick={onEdit}
                >
                  <Icon name="wrench" s={16} />Edit item
                </button>
                <MaintDelete item={item} onDeleted={onDeleted} />
              </>
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
  const { isOwner, isCrew, demo } = useSession();

  // Write capabilities. All writes are denyInDemo server-side, so the UI hides
  // every affordance in demo. Crew may mark complete + create/edit trips elsewhere;
  // here crew gets ONLY mark-complete. Owner gets the full create/edit/delete.
  const canComplete = (isOwner || isCrew) && !demo;
  const canManage = isOwner && !demo;

  const [items, setItems] = useState<MaintenanceRec[] | null>(null);
  const [vendors, setVendors] = useState<VendorRec[]>([]);
  const [trips, setTrips] = useState<TripRec[]>([]);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('queue');
  // Owner create/edit form mode: 'create', or an item being edited.
  const [formMode, setFormMode] = useState<'create' | { editId: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const now = useMemo(() => new Date(), []);

  const reload = (): void => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([
      api.maintenance(),
      api.derived(),
      api.vendors().catch(() => [] as VendorRec[]),
      // Trips power the owner's "source trip" picker; crew/guest never reach the form.
      api.trips().catch(() => [] as TripRec[]),
    ])
      .then(([m, d, v, t]) => {
        if (!alive) return;
        setItems(m);
        setDerived(d);
        setVendors(v);
        setTrips(t);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load maintenance');
      });
    return () => { alive = false; };
  }, [reloadKey]);

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

  // Owner create form (list-level "Add item").
  if (formMode === 'create' && canManage) {
    return (
      <MaintForm
        vendors={vendors}
        trips={trips}
        onSaved={() => { setFormMode(null); reload(); }}
        onCancel={() => setFormMode(null)}
      />
    );
  }

  // Owner edit form for the open item.
  if (formMode && formMode !== 'create' && canManage && open) {
    return (
      <MaintForm
        item={open}
        vendors={vendors}
        trips={trips}
        onSaved={() => { setFormMode(null); reload(); }}
        onCancel={() => setFormMode(null)}
      />
    );
  }

  if (open) {
    return (
      <MaintDetail
        item={open}
        vendor={openVendor}
        onBack={back}
        canComplete={canComplete}
        canManage={canManage}
        onChanged={reload}
        onEdit={() => setFormMode({ editId: open.id })}
        onDeleted={() => { reload(); back(); }}
      />
    );
  }

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
          {/* Add item — owner only (full create, incl. costEst), hidden in demo. */}
          {canManage && (
            <button className="btn btn-brass" onClick={() => setFormMode('create')}>
              <Icon name="plus" s={16} />Add item
            </button>
          )}
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
