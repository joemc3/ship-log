/**
 * Vendors & services directory — Valkyrie's little black book.
 *
 * Visually ported from the prototype's pages-vendors.jsx (the .page/.card/.grid/
 * .chip/.sec-head/.badge design language), but bound to the REAL API:
 *   - cards come from GET /api/vendors (WithBody<Vendor>[]) — frontmatter
 *     (name/phone/email/address/url/services[]) plus a Markdown `body` note;
 *   - the prototype's mock fields that don't exist in the real schema
 *     (vendor.type/note/location) are dropped: the narrative is `body`, and the
 *     contact block renders phone/email/address/url, each only when present;
 *   - the REVERSE cross-link is computed client-side: from a vendor we list the
 *     OPEN maintenance items whose `vendorId` is this vendor (GET /api/maintenance),
 *     and clicking one opens /maintenance/:id (the Shell navTo(page,ref) idea);
 *   - every optional field degrades gracefully (name is the only required field).
 *
 * NO MONETARY DATA: vendors carry no cost fields, so the page is identical for
 * crew/owner/guest-authed viewers — EXCEPT the write affordances. Owner gets
 * create/edit/delete via the shared form kit; crew sees none; and in demo even
 * the owner-equivalent viewer sees none (every write route is denyInDemo → 403).
 *
 * Routing: the directory lives at /vendors; an `?focus=<id>` query (from a
 * cross-link or search hit) scroll-highlights that vendor's card.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.js';
import { StatusBadge, SectionHead, EmptyState } from '../components/atoms.js';
import { RecordForm, TextField, TextAreaField, StringArrayField, buildPayload } from '../components/forms/index.js';
import { api, ApiError } from '../lib/api.js';
import { useSession } from '../state/session.js';
import type { VendorRec, MaintenanceRec } from '../lib/types.js';
import styles from './VendorsPage.module.css';

/* --------------------------------------------------------------- vendor form */

type FormMode = { kind: 'create' } | { kind: 'edit'; vendor: VendorRec };

interface VendorFormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  url: string;
  services: string[];
  body: string;
}

function blankState(): VendorFormState {
  return { name: '', phone: '', email: '', address: '', url: '', services: [], body: '' };
}

function stateFrom(v: VendorRec): VendorFormState {
  return {
    name: v.name ?? '',
    phone: v.phone ?? '',
    email: v.email ?? '',
    address: v.address ?? '',
    url: v.url ?? '',
    services: v.services ?? [],
    body: v.body ?? '',
  };
}

function VendorForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: FormMode;
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const editing = mode.kind === 'edit';
  const [s, setS] = useState<VendorFormState>(editing ? stateFrom(mode.vendor) : blankState());
  const set = <K extends keyof VendorFormState>(k: K, v: VendorFormState[K]): void =>
    setS((prev) => ({ ...prev, [k]: v }));

  const submit = async (): Promise<void> => {
    // buildPayload omits blank optionals (partial entries are first-class) and
    // leaves `body` for the server to split out; vendors carry no numbers.
    const fields: Record<string, unknown> = { ...s };
    const payload = buildPayload(fields, { arrays: ['services'] });
    if (editing) {
      await api.updateVendor(mode.vendor.id, payload);
    } else {
      await api.createVendor(payload);
    }
    onDone();
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 720 }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Directory
        </button>
        <RecordForm
          eyebrow={editing ? 'Edit vendor' : 'New vendor'}
          title={editing ? mode.vendor.name : 'Add a vendor'}
          onSubmit={submit}
          onCancel={onCancel}
        >
          <TextField label="Name" required value={s.name} onChange={(v) => set('name', v)} placeholder="e.g. Dieselworks Marine" />
          <TextField label="Phone" value={s.phone} onChange={(v) => set('phone', v)} placeholder="555-0101" />
          <TextField label="Email" value={s.email} onChange={(v) => set('email', v)} placeholder="shop@example.com" />
          <TextField label="Address" value={s.address} onChange={(v) => set('address', v)} placeholder="Street, town" />
          <TextField label="Website" value={s.url} onChange={(v) => set('url', v)} placeholder="https://…" />
          <StringArrayField
            label="Services"
            itemLabel="Service"
            value={s.services}
            onChange={(v) => set('services', v)}
            placeholder="e.g. Engine"
            hint="What they handle — shown as chips on the card."
          />
          <TextAreaField label="Notes" value={s.body} onChange={(v) => set('body', v)} rows={5} placeholder="What they're good for, who to ask for…" />
        </RecordForm>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- contact rows */

function Contact({ icon, children, href }: { icon: 'phone' | 'mail' | 'pin' | 'share'; children: React.ReactNode; href?: string }): JSX.Element {
  return (
    <div className={styles.contact}>
      <span className={styles.contactIcon}><Icon name={icon} s={15} /></span>
      {href ? (
        <a className={`mono tiny ${styles.contactLink}`} href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <span className={`mono tiny ${styles.contactVal}`}>{children}</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- card */

function VendorCard({
  vendor,
  openJobs,
  focused,
  canWrite,
  onOpenJob,
  onEdit,
  onDelete,
  refEl,
}: {
  vendor: VendorRec;
  openJobs: MaintenanceRec[];
  focused: boolean;
  canWrite: boolean;
  onOpenJob: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  refEl?: React.Ref<HTMLDivElement>;
}): JSX.Element {
  const services = vendor.services ?? [];
  return (
    <div
      ref={refEl}
      id={vendor.id}
      data-testid={`vendor-${vendor.id}`}
      className={`card card-pad${focused ? ' is-focused' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', outline: focused ? '2px solid var(--brass)' : undefined }}
    >
      <div className="flex items-center gap-12">
        <span className={styles.medallion}><Icon name="store" s={22} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 18, lineHeight: 1.15 }}>{vendor.name}</h3>
          {services.length > 0 && (
            <div className="muted tiny" style={{ marginTop: 3 }}>{services.join(' · ')}</div>
          )}
        </div>
        {canWrite && (
          <div className={styles.cardTools}>
            <button type="button" className={styles.toolBtn} aria-label={`Edit ${vendor.name}`} title="Edit" onClick={onEdit}>
              <Icon name="wrench" s={16} />
            </button>
            <button type="button" className={styles.toolBtn} aria-label={`Delete ${vendor.name}`} title="Delete" onClick={onDelete}>
              <Icon name="close" s={16} />
            </button>
          </div>
        )}
      </div>

      {vendor.body.trim() && (
        <p className="muted" style={{ fontSize: 14, marginTop: 12, marginBottom: 12 }}>{vendor.body}</p>
      )}

      {services.length > 0 && (
        <div className="flex wrap gap-8" style={{ marginTop: vendor.body.trim() ? 0 : 12, marginBottom: 14 }}>
          {services.map((sv) => <span key={sv} className="chip tiny">{sv}</span>)}
        </div>
      )}

      <div className="stack" style={{ gap: 8, marginTop: 'auto' }}>
        {vendor.phone && <Contact icon="phone">{vendor.phone}</Contact>}
        {vendor.email && <Contact icon="mail">{vendor.email}</Contact>}
        {vendor.address && <Contact icon="pin">{vendor.address}</Contact>}
        {vendor.url && <Contact icon="share" href={vendor.url}>{vendor.url.replace(/^https?:\/\//, '')}</Contact>}
      </div>

      {openJobs.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Open jobs for them</div>
          {openJobs.map((j) => (
            <button key={j.id} type="button" className={styles.job} onClick={() => onOpenJob(j.id)}>
              <StatusBadge status={j.status} />
              <span className={styles.jobTitle}>{j.title}</span>
              <Icon name="arrowRight" s={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- page */

export default function VendorsPage(): JSX.Element {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus') ?? routeId ?? null;

  const { isOwner, demo } = useSession();
  // Owner may write; demo is owner-equivalent for reads but every write route is
  // denyInDemo (403), so write affordances are hidden when demo is true.
  const canWrite = isOwner && !demo;

  const [vendors, setVendors] = useState<VendorRec[] | null>(null);
  const [maint, setMaint] = useState<MaintenanceRec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  // Shared loader: fetch the directory + maintenance (for the reverse cross-link).
  // `guard()` lets the mount effect drop a late response after unmount.
  const load = (guard: () => boolean = () => true): void => {
    setError(null);
    Promise.all([api.vendors(), api.maintenance().catch(() => [] as MaintenanceRec[])])
      .then(([v, m]) => {
        if (!guard()) return;
        setVendors(v);
        setMaint(m);
      })
      .catch((err: unknown) => {
        if (!guard()) return;
        setError(err instanceof ApiError ? err.message : 'Could not load the vendor directory.');
        setVendors([]);
      });
  };

  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse cross-link: open (non-done) maintenance items grouped by vendorId.
  const openJobsByVendor = useMemo(() => {
    const map = new Map<string, MaintenanceRec[]>();
    for (const m of maint) {
      if (!m.vendorId || m.status === 'done') continue;
      const list = map.get(m.vendorId) ?? [];
      list.push(m);
      map.set(m.vendorId, list);
    }
    return map;
  }, [maint]);

  const sorted = useMemo(
    () => (vendors ? [...vendors].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [vendors],
  );

  // Scroll the focused card into view when arriving from a cross-link / search.
  useEffect(() => {
    const el = focusRef.current;
    if (focusId && !form && el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusId, form, sorted]);

  const onDeleteVendor = (v: VendorRec): void => {
    if (!window.confirm(`Delete "${v.name}" from the directory?`)) return;
    api.deleteVendor(v.id)
      .then(() => load())
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not delete the vendor.');
      });
  };

  if (form && canWrite) {
    return (
      <VendorForm
        mode={form}
        onCancel={() => setForm(null)}
        onDone={() => { setForm(null); load(); }}
      />
    );
  }

  if (vendors === null) {
    return (
      <div className="page fade-in">
        <div className="page-wrap"><p className="muted">Loading the little black book&hellip;</p></div>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <span className="eyebrow">Valkyrie&rsquo;s little black book</span>
          <h1 className="page-title">Vendors &amp; services</h1>
          <p className="page-lead">
            The people who keep her sailing &mdash; chandlery, engine, diver, and sail loft.
            Add anyone new as you find them.
          </p>
        </div>

        {error && (
          <div className="card card-pad" role="alert" style={{ marginBottom: 22, borderColor: 'var(--sig-overdue)' }}>
            <span className="muted">{error}</span>
          </div>
        )}

        <SectionHead
          icon="store"
          title="Directory"
          action={
            canWrite ? (
              <button className="btn btn-brass" onClick={() => setForm({ kind: 'create' })}>
                <Icon name="plus" s={16} />Add vendor
              </button>
            ) : undefined
          }
        />

        {sorted.length === 0 ? (
          <EmptyState
            icon="store"
            title="No vendors yet"
            hint={canWrite ? 'Add the first one above.' : 'The directory will fill in as vendors are added.'}
          />
        ) : (
          <div className="grid g-2">
            {sorted.map((v) => (
              <VendorCard
                key={v.id}
                vendor={v}
                openJobs={openJobsByVendor.get(v.id) ?? []}
                focused={v.id === focusId}
                canWrite={canWrite}
                refEl={v.id === focusId ? focusRef : undefined}
                onOpenJob={(mid) => navigate(`/maintenance/${encodeURIComponent(mid)}`)}
                onEdit={() => setForm({ kind: 'edit', vendor: v })}
                onDelete={() => onDeleteVendor(v)}
              />
            ))}
          </div>
        )}

        {canWrite && sorted.length > 0 && (
          <button type="button" className={`card card-pad ${styles.addPrompt}`} onClick={() => setForm({ kind: 'create' })}>
            <div className="muted" style={{ display: 'inline-flex', marginBottom: 8 }}><Icon name="plus" s={24} /></div>
            <div style={{ fontWeight: 600, color: 'var(--ink-700)' }}>Add a new vendor</div>
            <p className="muted tiny" style={{ maxWidth: '40ch', margin: '4px auto 0' }}>
              Riggers, surveyors, haul-out yards, electronics &mdash; keep them all here so the next job is one tap away.
            </p>
          </button>
        )}
      </div>
    </div>
  );
}
