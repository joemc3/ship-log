/**
 * Costs — the OWNER-ONLY ledger.
 *
 * Visually ported from the prototype's pages-costs.jsx (the donut total, the
 * per-category rollup bars, and the filterable ledger), but bound to the REAL
 * API and the REAL Cost shape (date/category/item/amount/vendorId/maintId):
 *   - data is GET /api/costs (WithBody<Cost>[]); the route is owner-guarded and
 *     the API 403s crew/guest, so a non-owner who somehow reaches the page sees a
 *     graceful explanatory empty state — never a blank screen or a thrown error;
 *   - cross-links use the SPA's `?focus=` convention: a cost's vendor ->
 *     /vendors?focus=, its maintenance item -> /maintenance?focus=;
 *   - OWNER (and NOT in demo) gets create/edit/delete via the form kit; every
 *     write carries `denyInDemo` server-side, so the UI hides all write
 *     affordances when `me.demo` is true.
 *
 * This whole page is monetary by definition; it is unreachable for crew/guest by
 * both the router guard and the API. We still degrade gracefully (the forbidden +
 * empty states) and never print `$NaN`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.js';
import { SectionHead, EmptyState } from '../components/atoms.js';
import { RecordForm, TextField, NumberField, DateField, SelectField, buildPayload } from '../components/forms/index.js';
import { useSession } from '../state/session.js';
import { api, ApiError } from '../lib/api.js';
import { fmtMoney, fmtDateShort } from '../lib/format.js';
import type { CostRec, VendorRec } from '../lib/types.js';
import styles from './CostsPage.module.css';

/* ----------------------------------------------------------------- category meta */

/** The five cost categories from the prototype, each with a swatch colour + icon.
 *  These are display hints only — the schema's `category` is a free string, so an
 *  unknown category still renders (falling back to a neutral swatch). */
const CATEGORY_META: Record<string, { color: string; icon: Parameters<typeof Icon>[0]['name'] }> = {
  'Part replacement': { color: '#B23A33', icon: 'wrench' },
  Enhancement: { color: '#3C7B74', icon: 'bolt' },
  Consumable: { color: '#C0842A', icon: 'drop' },
  'Service & labor': { color: '#3C6E8E', icon: 'crew' },
  'Slip & mooring': { color: '#8A5A36', icon: 'anchor' },
};

const CATEGORY_OPTIONS = Object.keys(CATEGORY_META).map((c) => ({ value: c, label: c }));
const FALLBACK_COLOR = '#5C7C8C';

function catColor(category: string | undefined): string {
  return (category && CATEGORY_META[category]?.color) || FALLBACK_COLOR;
}

/** `$1,234` — whole-dollar money for the donut centre (mirrors the prototype's
 *  fmtMoney0). 0 renders as `$0`, never `$NaN`. */
function fmtMoney0(n: number): string {
  return `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;
}

/* ----------------------------------------------------------------------- donut */

interface Segment {
  name: string;
  value: number;
  color: string;
}

function Donut({ segments, total }: { segments: Segment[]; total: number }): JSX.Element {
  const R = 56;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Spend by category">
      <circle cx="75" cy="75" r={R} fill="none" stroke="#EADFC8" strokeWidth="20" />
      {total > 0 &&
        segments.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.name}
              cx="75"
              cy="75"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="20"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="75" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#5C7C8C">
        TOTAL
      </text>
      <text x="75" y="90" textAnchor="middle" fontFamily="Spectral, serif" fontSize="22" fontWeight="600" fill="#0C2230">
        {fmtMoney0(total)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------- cost form */

const ALL = 'All';

interface FormState {
  // Index signature so the fixed-key state is assignable to buildPayload's loose
  // `Record<string, unknown>` parameter without a cast.
  [key: string]: string;
  date: string;
  item: string;
  amount: string;
  category: string;
  vendorId: string;
  maintId: string;
}

function blankForm(): FormState {
  return { date: '', item: '', amount: '', category: '', vendorId: '', maintId: '' };
}

function formFrom(cost: CostRec): FormState {
  return {
    date: cost.date ?? '',
    item: cost.item ?? '',
    amount: cost.amount !== undefined && cost.amount !== null ? String(cost.amount) : '',
    category: cost.category ?? '',
    vendorId: cost.vendorId ?? '',
    maintId: cost.maintId ?? '',
  };
}

function CostForm({
  initial,
  editing,
  vendors,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  editing: boolean;
  vendors: VendorRec[];
  onSubmit: (payload: ReturnType<typeof buildPayload>) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [state, setState] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setState((s) => ({ ...s, [key]: value }));

  const vendorOptions = vendors.map((v) => ({ value: v.id, label: v.name }));

  const submit = async (): Promise<void> => {
    const payload = buildPayload(state, { numbers: ['amount'] });
    await onSubmit(payload);
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 720 }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Back to ledger
        </button>
        <RecordForm
          eyebrow="What she costs to love"
          title={editing ? 'Edit cost' : 'Log a cost'}
          saveLabel={editing ? 'Save' : 'Log a cost'}
          onSubmit={submit}
          onCancel={onCancel}
        >
          <DateField label="Date" required value={state.date} onChange={(v) => set('date', v)} />
          <TextField
            label="Item"
            required
            placeholder="What was it for?"
            value={state.item}
            onChange={(v) => set('item', v)}
          />
          <NumberField
            label="Amount"
            required
            step="0.01"
            min={0}
            placeholder="0.00"
            value={state.amount}
            onChange={(v) => set('amount', v)}
          />
          <SelectField
            label="Category"
            options={CATEGORY_OPTIONS}
            value={state.category}
            onChange={(v) => set('category', v)}
          />
          {vendorOptions.length > 0 && (
            <SelectField
              label="Vendor"
              hint="Link this cost to a vendor (optional)."
              options={vendorOptions}
              value={state.vendorId}
              onChange={(v) => set('vendorId', v)}
            />
          )}
        </RecordForm>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ page */

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; cost: CostRec };

export default function CostsPage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const { demo } = useSession();
  const canWrite = !demo; // owner-only route; writes still blocked in demo (denyInDemo).

  const focus = search.get('focus');

  const [costs, setCosts] = useState<CostRec[] | null>(null);
  const [vendors, setVendors] = useState<VendorRec[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<string>(ALL);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const reload = (): void => {
    setError(null);
    setForbidden(false);
    api
      .costs()
      .then((rows) => setCosts(rows))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
          setCosts([]);
          return;
        }
        setError(e instanceof Error ? e.message : 'Could not load the ledger.');
        setCosts([]);
      });
  };

  useEffect(() => {
    let alive = true;
    setForbidden(false);
    Promise.resolve()
      .then(() => api.costs())
      .then((rows) => {
        if (alive) setCosts(rows);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
          setCosts([]);
          return;
        }
        setError(e instanceof Error ? e.message : 'Could not load the ledger.');
        setCosts([]);
      });
    api
      .vendors()
      .then((v) => {
        if (alive) setVendors(v);
      })
      .catch(() => {
        /* vendors are a nicety here; ignore a failure. */
      });
    return () => {
      alive = false;
    };
  }, []);

  // A /costs/:id deep link opens that cost's editor (owner edit); ?focus= just
  // scrolls/keeps the ledger (the cost rows are inline, so we leave list mode).
  useEffect(() => {
    if (!id || !costs) return;
    const found = costs.find((c) => c.id === id);
    if (found && canWrite) setMode({ kind: 'edit', cost: found });
  }, [id, costs, canWrite]);

  /* ---- derived rollups ---- */

  const all = costs ?? [];

  const byCat = useMemo(() => {
    const map = new Map<string, { name: string; value: number; count: number; color: string }>();
    for (const c of all) {
      const name = c.category ?? 'Uncategorized';
      const cur = map.get(name) ?? { name, value: 0, count: 0, color: catColor(c.category) };
      cur.value += c.amount;
      cur.count += 1;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [all]);

  const total = useMemo(() => all.reduce((s, c) => s + c.amount, 0), [all]);
  const maxCat = byCat.length ? Math.max(...byCat.map((c) => c.value)) : 0;

  const cats = useMemo(() => byCat.map((c) => c.name), [byCat]);

  const shown = useMemo(
    () =>
      (cat === ALL ? all : all.filter((c) => (c.category ?? 'Uncategorized') === cat))
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [all, cat],
  );
  const shownTotal = useMemo(() => shown.reduce((s, c) => s + c.amount, 0), [shown]);

  const vendorById = (vid: string): VendorRec | undefined => vendors.find((v) => v.id === vid);

  /* ---- write handlers ---- */

  const create = async (payload: ReturnType<typeof buildPayload>): Promise<void> => {
    await api.createCost(payload);
    setMode({ kind: 'list' });
    reload();
  };

  const update = async (cid: string, payload: ReturnType<typeof buildPayload>): Promise<void> => {
    await api.updateCost(cid, payload);
    setMode({ kind: 'list' });
    if (id) navigate('/costs');
    reload();
  };

  const remove = async (cost: CostRec): Promise<void> => {
    if (!window.confirm(`Delete “${cost.item}” from the ledger? This can’t be undone.`)) return;
    try {
      await api.deleteCost(cost.id);
      reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Could not delete that cost.');
    }
  };

  const backToList = (): void => {
    setMode({ kind: 'list' });
    if (id) navigate('/costs');
  };

  /* ---- render: write forms ---- */

  if (mode.kind === 'create') {
    return (
      <CostForm
        initial={blankForm()}
        editing={false}
        vendors={vendors}
        onSubmit={create}
        onCancel={backToList}
      />
    );
  }
  if (mode.kind === 'edit') {
    const editing = mode.cost;
    return (
      <CostForm
        initial={formFrom(editing)}
        editing
        vendors={vendors}
        onSubmit={(payload) => update(editing.id, payload)}
        onCancel={backToList}
      />
    );
  }

  /* ---- render: loading / forbidden ---- */

  if (costs === null) {
    return (
      <div className="page fade-in">
        <div className="page-wrap">
          <p className="muted">Tallying the ledger&hellip;</p>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="page fade-in">
        <div className="page-wrap">
          <div className="page-head">
            <span className="eyebrow">What she costs to love</span>
            <h1 className="page-title">Costs</h1>
          </div>
          <div data-testid="costs-forbidden">
            <EmptyState
              icon="coins"
              title="Costs are owner-only"
              hint="Spending records are kept private to the boat's owner."
            />
          </div>
        </div>
      </div>
    );
  }

  /* ---- render: ledger ---- */

  return (
    <div className="page fade-in">
      <div className="page-wrap">
        <div className="page-head">
          <span className="eyebrow">What she costs to love</span>
          <h1 className="page-title">Costs</h1>
          <p className="page-lead">
            Every dollar into the boat, sorted by what it bought &mdash; parts, upgrades, consumables,
            services, and her slip.
          </p>
        </div>

        {error && (
          <div className="card card-pad" role="alert" style={{ marginBottom: 22, borderColor: 'var(--sig-overdue)' }}>
            <span className="muted">{error}</span>
          </div>
        )}

        {all.length === 0 ? (
          <div data-testid="costs-empty">
            <EmptyState
              icon="coins"
              title="No costs logged yet"
              hint={canWrite ? 'Log the first expense to start the ledger.' : 'Spending will appear here once recorded.'}
            />
            {canWrite && (
              <div className="flex" style={{ justifyContent: 'center', marginTop: 16 }}>
                <button className="btn btn-brass" onClick={() => setMode({ kind: 'create' })}>
                  <Icon name="plus" s={16} />Log a cost
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* summary: donut + per-category rollup */}
            <div className={`grid ${styles.summaryGrid}`}>
              <div className={`card card-pad flex items-center gap-16 ${styles.donutCard}`}>
                <Donut segments={byCat} total={total} />
                <div className="stack" style={{ gap: 8 }}>
                  {byCat.map((c) => (
                    <div key={c.name} className="flex items-center gap-8">
                      <span className={styles.swatch} style={{ background: c.color }} />
                      <span className="tiny" style={{ color: 'var(--ink-700)', fontWeight: 500 }}>
                        {c.name.split(' ')[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card card-pad" data-testid="category-rollup">
                <div className="eyebrow" style={{ marginBottom: 16 }}>By category</div>
                <div className="stack" style={{ gap: 14 }}>
                  {byCat.map((c) => {
                    const meta = CATEGORY_META[c.name];
                    return (
                      <div key={c.name}>
                        <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                          <span
                            className="flex items-center gap-8"
                            style={{ fontSize: 14, color: 'var(--ink-700)', fontWeight: 500 }}
                          >
                            {meta && <span style={{ color: c.color }}><Icon name={meta.icon} s={16} /></span>}
                            {c.name}
                            <span className="muted tiny mono">&times;{c.count}</span>
                          </span>
                          <span className="mono" style={{ fontSize: 13.5, color: 'var(--ink-800)' }}>
                            {fmtMoney(c.value)}
                          </span>
                        </div>
                        <div className="meter">
                          <span style={{ width: `${maxCat ? (c.value / maxCat) * 100 : 0}%`, background: c.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ledger */}
            <SectionHead
              icon="coins"
              title="Ledger"
              action={
                canWrite ? (
                  <button className="btn btn-brass" onClick={() => setMode({ kind: 'create' })}>
                    <Icon name="plus" s={16} />Log a cost
                  </button>
                ) : undefined
              }
            />

            <div className="flex wrap gap-8" style={{ marginBottom: 14 }}>
              {[ALL, ...cats].map((c) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() => setCat(c)}
                  style={{
                    cursor: 'pointer',
                    background: cat === c ? 'var(--ink-700)' : 'var(--paper-2)',
                    color: cat === c ? '#fff' : 'var(--ink-700)',
                    borderColor: cat === c ? 'var(--ink-700)' : 'var(--line)',
                  }}
                >
                  {c !== ALL && <span className={styles.swatchSm} style={{ background: catColor(c) }} />}
                  {c}
                </button>
              ))}
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className={`flex items-center ${styles.ledgerHead}`}>
                <span className="eyebrow" style={{ flex: 1 }}>Item</span>
                <span className="eyebrow" style={{ width: 150 }}>Category</span>
                <span className="eyebrow" style={{ width: 100 }}>Date</span>
                <span className="eyebrow" style={{ width: 90, textAlign: 'right' }}>Amount</span>
                {canWrite && <span className="eyebrow" style={{ width: 72, textAlign: 'right' }}>&nbsp;</span>}
              </div>

              {shown.map((c, i) => {
                const v = c.vendorId ? vendorById(c.vendorId) : undefined;
                return (
                  <div
                    key={c.id}
                    className={`flex items-center ${styles.ledgerRow}`}
                    style={{ borderTop: i ? '1px solid var(--line)' : 'none' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--ink-800)', fontSize: 14.5 }}>{c.item}</div>
                      <div className="flex items-center gap-8" style={{ marginTop: 2 }}>
                        {v && (
                          <button
                            type="button"
                            data-testid={`vendor-link-${c.id}`}
                            className={`tiny ${styles.crossLink}`}
                            onClick={() => navigate(`/vendors?focus=${encodeURIComponent(v.id)}`)}
                            title="See this vendor"
                          >
                            <Icon name="store" s={12} />{v.name}
                          </button>
                        )}
                        {c.maintId && (
                          <button
                            type="button"
                            data-testid={`maint-link-${c.id}`}
                            className={`tiny ${styles.crossLink}`}
                            onClick={() => navigate(`/maintenance?focus=${encodeURIComponent(c.maintId!)}`)}
                            title="See the related work"
                          >
                            <Icon name="wrench" s={12} />On the work list
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ width: 150 }}>
                      {c.category ? (
                        <span className="flex items-center gap-8 tiny" style={{ color: 'var(--ink-600)' }}>
                          <span className={styles.swatchSm} style={{ background: catColor(c.category) }} />
                          {c.category}
                        </span>
                      ) : (
                        <span className="muted tiny">&mdash;</span>
                      )}
                    </div>
                    <div style={{ width: 100 }} className="mono tiny muted">{fmtDateShort(c.date)}</div>
                    <div style={{ width: 90, textAlign: 'right' }} className="mono">{fmtMoney(c.amount)}</div>
                    {canWrite && (
                      <div className={styles.rowActions} style={{ width: 72, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          data-testid={`edit-${c.id}`}
                          className={styles.iconBtn}
                          aria-label={`Edit ${c.item}`}
                          title="Edit"
                          onClick={() => setMode({ kind: 'edit', cost: c })}
                        >
                          <Icon name="wrench" s={14} />
                        </button>
                        <button
                          type="button"
                          data-testid={`delete-${c.id}`}
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          aria-label={`Delete ${c.item}`}
                          title="Delete"
                          onClick={() => void remove(c)}
                        >
                          <Icon name="close" s={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className={`flex items-center ${styles.ledgerTotal}`}>
                <span style={{ flex: 1, fontWeight: 600, color: 'var(--ink-800)' }}>
                  {cat === ALL ? 'Total to date' : `${cat} subtotal`}
                </span>
                <span
                  className="mono"
                  data-testid="costs-total"
                  style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink-900)' }}
                >
                  {fmtMoney(shownTotal)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
