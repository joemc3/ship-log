/**
 * Inventory — what's aboard & is it ready.
 *
 * Visually ported from the prototype's pages-inventory.jsx (the ready-to-sail
 * rollup, category sections, expandable item detail, photo tiles) but bound to
 * the REAL API:
 *   - the list is GET /api/inventory (WithBody<Inventory>[]) — a FLAT schema
 *     (name, category?, location?, count?, level?, condition?, inspect?/service?/
 *     expires? bare ISO dates, photos?, body), NOT the prototype's richer mock
 *     (no `required`, no nested count{qty}/inspect{last,next,every}/service{task});
 *   - the inspect/service/expires task TONE (overdue/due) comes from
 *     GET /api/derived (server-computed against the real clock) — we do NOT
 *     reimplement the prototype's hardcoded `invStatus` clock math;
 *   - photos are real `photos/<name>.jpg` refs served by the /photos route;
 *   - a cost cross-link is OWNER-ONLY (inventory itself carries no monetary
 *     field, but "log a replacement cost" reaches the owner-only Costs page);
 *     it is hidden for crew/guest, who also can never reach /costs.
 *
 * WRITES: owner-only CRUD via the shared form kit (create/edit/delete). Crew and
 * guest see a read-only page (no Add/Edit/Delete). Every write affordance is
 * hidden in demo (writes are denied server-side; the UI must not offer them).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon.js';
import { Stat, SectionHead, Badge, type BadgeTone } from '../components/atoms.js';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { useSession } from '../state/session.js';
import type { InventoryRec, Derived, InventoryTask, InventoryTaskKind } from '../lib/types.js';
import {
  RecordForm,
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  PhotoUpload,
  buildPayload,
} from '../components/forms/index.js';
import styles from './InventoryPage.module.css';

/* ---------------------------------------------------------------- helpers */

/** photos/<name>.jpg in a record resolves to the GET /photos route. */
function photoUrl(ref: string): string {
  if (/^https?:\/\//.test(ref)) return ref;
  return `/${ref.replace(/^\/+/, '')}`;
}

/** Title-case a free-text level/condition for display, leaving 'ok' as 'OK'. */
function titleCase(s: string): string {
  if (s.toLowerCase() === 'ok') return 'OK';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const INV_KIND_LABEL: Record<InventoryTaskKind, string> = {
  inspect: 'Inspection due',
  service: 'Service due',
  expires: 'Expires',
};

const TONE_ICON: Record<'overdue' | 'due' | 'good', IconName> = {
  overdue: 'alert',
  due: 'clock',
  good: 'check',
};
const TONE_TEXT: Record<'overdue' | 'due' | 'good', string> = {
  overdue: 'var(--sig-overdue)',
  due: 'var(--sig-due)',
  good: 'var(--sig-good)',
};

/** The worst (most urgent) derived task tone for an item: overdue > due > good. */
type Tone = 'overdue' | 'due' | 'good';
function itemTone(tasks: InventoryTask[]): Tone {
  if (tasks.some((t) => t.status === 'overdue')) return 'overdue';
  if (tasks.some((t) => t.status === 'due')) return 'due';
  return 'good';
}

const TONE_LABEL: Record<Tone, string> = { overdue: 'Overdue', due: 'Due soon', good: 'In date' };

/** A category bucket: the section icon + the items that belong to it. The real
 *  schema's `category` is free text, so we group on whatever value is present
 *  (falling back to "Other"), keeping section order stable + deterministic. */
const CATEGORY_ICON: Record<string, IconName> = {
  Safety: 'life',
  Rigging: 'anchor',
  Deck: 'box',
  Engine: 'engine',
  Electronics: 'bolt',
  Ground: 'anchor',
  Spares: 'wrench',
  Galley: 'bottle',
  Other: 'box',
};
function categoryIcon(cat: string): IconName {
  return CATEGORY_ICON[cat] ?? 'box';
}

/* ------------------------------------------------------------- facts table */

function itemFacts(it: InventoryRec): [string, string][] {
  const f: [string, string][] = [];
  if (it.location) f.push(['Location', it.location]);
  if (it.count !== undefined) f.push(['In stock', String(it.count)]);
  if (it.level) f.push(['Level', titleCase(it.level)]);
  if (it.condition) f.push(['Condition', titleCase(it.condition)]);
  if (it.inspect) f.push(['Next inspection', fmtDate(it.inspect)]);
  if (it.service) f.push(['Next service', fmtDate(it.service)]);
  if (it.expires) f.push(['Expires', fmtDate(it.expires)]);
  return f;
}

/* ============================================================ detail view */

function InvDetail({
  item,
  tasks,
  isOwner,
  canWrite,
  onBack,
  onEdit,
  onDelete,
}: {
  item: InventoryRec;
  tasks: InventoryTask[];
  isOwner: boolean;
  canWrite: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const tone = itemTone(tasks);
  const facts = itemFacts(item);
  const photos = item.photos ?? [];

  return (
    <div className="page fade-in" data-testid="inv-detail">
      <div className="page-wrap" style={{ maxWidth: 980 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Inventory
        </button>

        <div className="flex items-center gap-12 wrap">
          <Badge tone={tone === 'good' ? 'done' : (tone as BadgeTone)}>{TONE_LABEL[tone]}</Badge>
          {item.category && (
            <span className="chip tiny"><Icon name={categoryIcon(item.category)} s={14} />{item.category}</span>
          )}
        </div>
        <h1 className="page-title" style={{ marginTop: 12 }}>{item.name}</h1>

        <div className={`grid ${styles.detailGrid}`} style={{ marginTop: 22, alignItems: 'start' }}>
          <div className="stack">
            {item.body.trim() && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 10 }}>About this item</div>
                <p style={{ fontSize: 15.5, color: 'var(--ink-700)', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {item.body}
                </p>
              </div>
            )}

            {tasks.length > 0 && (
              <div className="card card-pad">
                <SectionHead icon="clock" title="On the maintenance list" />
                <div className="stack" style={{ gap: 10 }}>
                  {tasks.map((t) => (
                    <div
                      key={t.kind}
                      className="flex items-center"
                      style={{ justifyContent: 'space-between', gap: 8 }}
                    >
                      <span className="flex items-center gap-8">
                        <span style={{ color: TONE_TEXT[t.status === 'overdue' ? 'overdue' : 'due'] }}>
                          <Icon name={TONE_ICON[t.status === 'overdue' ? 'overdue' : 'due']} s={16} />
                        </span>
                        <span style={{ fontSize: 14.5, color: 'var(--ink-800)' }}>{INV_KIND_LABEL[t.kind]}</span>
                      </span>
                      <Badge tone={t.status as BadgeTone}>{fmtDate(t.date)}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {photos.length > 0 && (
              <div className="card card-pad">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Photos &middot; {photos.length}</div>
                <div className="grid g-3" style={{ gap: 8 }}>
                  {photos.map((ref) => (
                    <img
                      key={ref}
                      className={styles.photo}
                      src={photoUrl(ref)}
                      alt={`${item.name} photo`}
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
                {facts.map(([k, val], i) => (
                  <div
                    key={k}
                    className="flex items-center"
                    style={{ justifyContent: 'space-between', padding: '9px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}
                  >
                    <span className="muted tiny">{k}</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink-800)' }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Costs cross-link is OWNER-only: inventory carries no monetary field,
                but logging a replacement reaches the owner-only Costs page. Crew/
                guest never see it (and could not reach /costs anyway). */}
            {isOwner && (
              <button
                type="button"
                data-testid="cost-link"
                className={`card card-pad ${styles.linkCard}`}
                onClick={() => navigate(`/costs?focus=${encodeURIComponent(item.id)}`)}
              >
                <div className="eyebrow" style={{ marginBottom: 8 }}>Spending</div>
                <div className="flex items-center" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink-800)', fontSize: 14.5 }}>
                    Log a replacement cost
                  </div>
                  <Icon name="arrowRight" s={16} />
                </div>
              </button>
            )}

            {canWrite && (
              <div className="flex gap-8 wrap">
                <button className="btn btn-ghost" onClick={onEdit}>
                  <Icon name="wrench" s={16} />Edit
                </button>
                <button className="btn btn-ghost" onClick={onDelete}>
                  <Icon name="close" s={16} />Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ item row */

function InvRow({
  item,
  tone,
  onOpen,
}: {
  item: InventoryRec;
  tone: Tone;
  onOpen: () => void;
}): JSX.Element {
  return (
    <div className="find-row" onClick={onOpen} data-testid={`inv-row-${item.id}`} style={{ cursor: 'pointer' }}>
      <span style={{ color: TONE_TEXT[tone], flex: '0 0 auto' }}>
        <Icon name={TONE_ICON[tone]} s={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div className="flex items-center gap-8 wrap">
          <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-800)' }}>{item.name}</span>
        </div>
        {(item.location || item.count !== undefined) && (
          <div className="muted tiny" style={{ marginTop: 2 }}>
            {[item.location, item.count !== undefined ? `${item.count} aboard` : null].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <Badge tone={tone === 'good' ? 'done' : (tone as BadgeTone)}>{TONE_LABEL[tone]}</Badge>
      <button type="button" className={styles.rowGo} aria-label={`Open ${item.name}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        <Icon name="chevron" s={16} />
      </button>
    </div>
  );
}

/* ============================================================ create / edit form */

interface FormState {
  /** Index signature so the flat state passes straight to `buildPayload`
   *  (which takes a `Record<string, unknown>`). */
  [key: string]: string | string[];
  name: string;
  category: string;
  location: string;
  count: string;
  level: string;
  condition: string;
  inspect: string;
  service: string;
  expires: string;
  body: string;
  photos: string[];
}

function emptyForm(): FormState {
  return { name: '', category: '', location: '', count: '', level: '', condition: '', inspect: '', service: '', expires: '', body: '', photos: [] };
}

function formFromItem(it: InventoryRec): FormState {
  return {
    name: it.name,
    category: it.category ?? '',
    location: it.location ?? '',
    count: it.count !== undefined ? String(it.count) : '',
    level: it.level ?? '',
    condition: it.condition ?? '',
    inspect: it.inspect ?? '',
    service: it.service ?? '',
    expires: it.expires ?? '',
    body: it.body ?? '',
    photos: it.photos ?? [],
  };
}

function InvForm({
  initial,
  editingId,
  onCancel,
  onSaved,
}: {
  initial: FormState;
  editingId: string | null;
  onCancel: () => void;
  onSaved: (rec: InventoryRec) => void;
}): JSX.Element {
  const [state, setState] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(key: K, v: FormState[K]): void =>
    setState((s) => ({ ...s, [key]: v }));

  const submit = async (): Promise<void> => {
    const payload = buildPayload(state, { numbers: ['count'], arrays: ['photos'] });
    const rec = editingId
      ? await api.updateInventory(editingId, payload)
      : await api.createInventory(payload);
    onSaved(rec);
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 760 }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Inventory
        </button>
        <RecordForm
          eyebrow={editingId ? 'Edit item' : 'New item'}
          title={editingId ? 'Edit inventory item' : 'Add an inventory item'}
          onSubmit={submit}
          onCancel={onCancel}
        >
          <TextField label="Name" required value={state.name} onChange={(v) => set('name', v)} placeholder="e.g. Offshore flare kit" />
          <div className="grid g-2">
            <TextField label="Category" value={state.category} onChange={(v) => set('category', v)} placeholder="Safety, Rigging, Deck…" />
            <TextField label="Location" value={state.location} onChange={(v) => set('location', v)} placeholder="Cockpit locker, port" />
          </div>
          <div className="grid g-3">
            <NumberField label="In stock" value={state.count} onChange={(v) => set('count', v)} min={0} step={1} />
            <TextField label="Level" value={state.level} onChange={(v) => set('level', v)} placeholder="ok / low" />
            <TextField label="Condition" value={state.condition} onChange={(v) => set('condition', v)} placeholder="good / fair / poor" />
          </div>
          <div className="grid g-3">
            <DateField label="Next inspection" value={state.inspect} onChange={(v) => set('inspect', v)} hint="Surfaces on the maintenance list" />
            <DateField label="Next service" value={state.service} onChange={(v) => set('service', v)} />
            <DateField label="Expires" value={state.expires} onChange={(v) => set('expires', v)} />
          </div>
          <TextAreaField label="Notes" value={state.body} onChange={(v) => set('body', v)} placeholder="Anything worth remembering about this item." rows={5} />
          <PhotoUpload onUploaded={(ref) => set('photos', [...state.photos, ref])} />
          {state.photos.length > 0 && (
            <div className="muted tiny">{state.photos.length} photo{state.photos.length === 1 ? '' : 's'} attached</div>
          )}
        </RecordForm>
      </div>
    </div>
  );
}

/* ============================================================ delete confirm */

function ConfirmDelete({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onCancel} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div
        className={`card fade-in ${styles.confirmCard}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${name}`}
      >
        <div className="flex items-center gap-12" style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--sig-overdue)' }}><Icon name="alert" s={22} /></span>
          <h3 style={{ fontSize: 21 }}>Delete this item?</h3>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          “{name}” will be removed from the inventory. This can&rsquo;t be undone here.
        </p>
        <div className="flex gap-8" style={{ marginTop: 18 }}>
          <button className="btn btn-brass" onClick={() => void confirm()} disabled={busy}>
            <Icon name="close" s={16} />{busy ? 'Deleting…' : 'Delete'}
          </button>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ page */

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: string };

export default function InventoryPage(): JSX.Element {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const { isOwner, demo } = useSession();
  // Owner-only write affordances, never in demo (writes denied server-side).
  const canWrite = isOwner && !demo;

  const [items, setItems] = useState<InventoryRec[] | null>(null);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const openId = routeId ?? focusId ?? null;

  // Reload from the API (after a write). It never throws — a failure surfaces in
  // the error slot. Kept stable so the mount effect can call it once.
  const load = (): void => {
    setError(null);
    Promise.all([api.inventory(), api.derived()])
      .then(([inv, d]) => {
        setItems(inv);
        setDerived(d);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load inventory');
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tasks grouped by inventory id, from the server-computed derived view.
  const tasksById = useMemo<Record<string, InventoryTask[]>>(() => {
    const map: Record<string, InventoryTask[]> = {};
    for (const t of derived?.inventoryTasks ?? []) (map[t.invId] ??= []).push(t);
    return map;
  }, [derived]);

  const toneOf = (it: InventoryRec): Tone => itemTone(tasksById[it.id] ?? []);

  const open = openId && items ? items.find((it) => it.id === openId) : undefined;

  // Rollup counts from the derived task statuses.
  const attentionCount = (derived?.inventoryTasks ?? []).filter((t) => t.status === 'overdue').length;
  const comingCount = (derived?.inventoryTasks ?? []).filter((t) => t.status === 'due').length;

  // Group items by category, in a deterministic order.
  const grouped = useMemo(() => {
    const list = items ?? [];
    const filtered = filter === 'attention' ? list.filter((it) => toneOf(it) !== 'good') : list;
    const byCat = new Map<string, InventoryRec[]>();
    for (const it of filtered) {
      const cat = it.category && it.category.trim() ? it.category : 'Other';
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(it);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, derived, filter]);

  const onSaved = (): void => {
    setMode({ kind: 'list' });
    load();
    navigate('/inventory');
  };

  const doDelete = (delId: string): void => {
    void api
      .deleteInventory(delId)
      .then(() => {
        setConfirmDel(null);
        load();
        navigate('/inventory');
      })
      .catch((e: unknown) => {
        setConfirmDel(null);
        setError(e instanceof Error ? e.message : 'Could not delete the item');
      });
  };

  /* ---- write modes (owner only; defended again here) ---- */
  if (canWrite && mode.kind === 'create') {
    return <InvForm initial={emptyForm()} editingId={null} onCancel={() => { setMode({ kind: 'list' }); }} onSaved={onSaved} />;
  }
  if (canWrite && mode.kind === 'edit' && items) {
    const editing = items.find((it) => it.id === mode.id);
    if (editing) {
      return (
        <InvForm
          initial={formFromItem(editing)}
          editingId={editing.id}
          onCancel={() => { setMode({ kind: 'list' }); navigate(`/inventory/${encodeURIComponent(editing.id)}`); }}
          onSaved={onSaved}
        />
      );
    }
  }

  if (error) {
    return (
      <div className="page fade-in">
        <div className="page-wrap">
          <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-tint)' }}>
            <div style={{ color: 'var(--brass-deep)', marginBottom: 8 }}><Icon name="alert" s={28} /></div>
            <div style={{ fontWeight: 600, color: 'var(--ink-700)' }}>Couldn&rsquo;t load inventory</div>
            <div className="muted" style={{ marginTop: 4 }}>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (open) {
    return (
      <>
        <InvDetail
          item={open}
          tasks={tasksById[open.id] ?? []}
          isOwner={isOwner}
          canWrite={canWrite}
          onBack={() => navigate('/inventory')}
          onEdit={() => setMode({ kind: 'edit', id: open.id })}
          onDelete={() => setConfirmDel(open.id)}
        />
        {confirmDel && (
          <ConfirmDelete name={open.name} onCancel={() => setConfirmDel(null)} onConfirm={() => doDelete(confirmDel)} />
        )}
      </>
    );
  }

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">What&rsquo;s aboard &amp; is it ready</span>
          <h1 className="page-title">Inventory</h1>
          <p className="page-lead">
            Everything aboard &mdash; safety gear, ground tackle, soft goods, spares and electronics.
            Anything with an expiry, inspection or service date flows into the maintenance list automatically.
          </p>
        </div>

        <div className="grid g-4" style={{ marginBottom: 22 }}>
          <div className="card card-pad"><Stat label="Items aboard" value={items?.length ?? 0} sm /></div>
          <div className="card card-pad" style={{ borderTop: '3px solid var(--sig-overdue)' }} data-testid="rollup-attention">
            <Stat label="Need attention" value={attentionCount} sm />
          </div>
          <div className="card card-pad" style={{ borderTop: '3px solid var(--sig-due)' }} data-testid="rollup-coming">
            <Stat label="Coming due" value={comingCount} sm />
          </div>
          <div className="card card-pad"><Stat label="Categories" value={grouped.length} sm /></div>
        </div>

        <div className="flex items-center wrap" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div className={styles.filter}>
            {(['all', 'attention'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`${styles.filterBtn}${filter === k ? ` ${styles.filterBtnOn}` : ''}`}
              >
                {k === 'all' ? 'All items' : `Needs attention${attentionCount + comingCount > 0 ? ` (${attentionCount + comingCount})` : ''}`}
              </button>
            ))}
          </div>
          {canWrite && (
            <button className="btn btn-brass" onClick={() => setMode({ kind: 'create' })}>
              <Icon name="plus" s={16} />Add item
            </button>
          )}
        </div>

        {items === null && <div className="muted" style={{ padding: '20px 0' }}>Loading what&rsquo;s aboard…</div>}

        {items !== null && grouped.length === 0 && (
          <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-tint)' }}>
            <div style={{ color: 'var(--brass-deep)', marginBottom: 8 }}><Icon name="box" s={28} /></div>
            <div style={{ fontWeight: 600, color: 'var(--ink-700)' }}>
              {filter === 'attention' ? 'Nothing needs attention' : 'Nothing aboard yet'}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {filter === 'attention'
                ? 'Every item is in date — switch to “All items” to see the full kit.'
                : 'Items you add will appear here, grouped by category.'}
            </div>
          </div>
        )}

        {grouped.map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 26 }}>
            <SectionHead icon={categoryIcon(cat)} title={cat} action={<span className="muted mono tiny">{list.length}</span>} />
            <div className="card" style={{ overflow: 'hidden' }}>
              {list.map((it) => (
                <InvRow
                  key={it.id}
                  item={it}
                  tone={toneOf(it)}
                  onOpen={() => navigate(`/inventory/${encodeURIComponent(it.id)}`)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
