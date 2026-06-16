/**
 * Owner's manuals + quick reference.
 *
 * Visually ported from the prototype's pages-manuals.jsx (the spine-styled book
 * cover, the expandable section TOC drawer, and the quick-reference card grid),
 * but bound to the REAL API:
 *   - manuals come from GET /api/manuals (WithBody<Manual>[]): the authoritative
 *     shape is { id, title, kind?, file?, sections?[{title, anchor?}] } plus a
 *     Markdown `body`. The prototype's mock pages/year/summary and per-section
 *     `summary` have no real source, so they are intentionally dropped; the body
 *     becomes the card's note and each section is a TOC row that deep-links into
 *     the served file at its `#anchor`;
 *   - a manual's `file` (a PDF/markdown under the data dir's manuals/) is served
 *     by the GET /files/manuals/:name route (api.manualFileUrl). Only a manual
 *     that actually carries a `file` shows a Download/Open link;
 *   - quick-reference cards come from GET /api/quickref ({ id, title, body? }).
 *     The prototype's icon + steps[] are replaced by the real single `body`.
 *
 * WRITES (owner-only, hidden in demo): the owner gets create/edit/delete via the
 * form kit (RecordForm + fields). Every manual write carries `denyInDemo`
 * server-side, so the UI hides all write affordances when `me.demo`. Manuals
 * carry NO monetary data, so this page never renders a cost field or offers a
 * cost input — the redaction contract is trivially satisfied here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/Icon.js';
import { SectionHead, EmptyState } from '../components/atoms.js';
import {
  RecordForm,
  TextField,
  TextAreaField,
  SelectField,
  GroupField,
  buildPayload,
  type GroupRow,
  type SelectOption,
} from '../components/forms/index.js';
import { useSession } from '../state/session.js';
import { api, ApiError } from '../lib/api.js';
import { Markdown } from './Markdown.js';
import type { ManualRec, Quickref } from '../lib/types.js';
import styles from './ManualsPage.module.css';

/** Manual `kind` -> cover icon + chip label. Unknown/absent kinds fall back to a
 *  generic book; the chip is omitted entirely when the manual carries no kind. */
const KIND_META: Record<string, { icon: IconName; label: string }> = {
  engine: { icon: 'engine', label: 'Engine' },
  boat: { icon: 'helm', label: 'Boat' },
  electrical: { icon: 'bolt', label: 'Electrical' },
  rigging: { icon: 'sail', label: 'Rigging' },
};

const KIND_OPTIONS: readonly SelectOption[] = [
  { value: 'boat', label: 'Boat' },
  { value: 'engine', label: 'Engine' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'rigging', label: 'Rigging' },
];

function kindMeta(kind: string | undefined): { icon: IconName; label: string } | null {
  if (!kind) return null;
  return KIND_META[kind] ?? { icon: 'book', label: kind };
}

/* ----------------------------------------------------------------- manual card */

function ManualCard({
  man,
  canWrite,
  onEdit,
  onDelete,
}: {
  man: ManualRec;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const meta = kindMeta(man.kind);
  const sections = man.sections ?? [];
  const note = (man.body ?? '').trim();
  const fileHref = man.file ? api.manualFileUrl(man.file) : null;

  return (
    <div className="card" data-testid="manual-card" style={{ overflow: 'hidden' }}>
      <div className="flex gap-16" style={{ padding: 20, alignItems: 'flex-start' }}>
        <div className={styles.cover}>
          <Icon name={meta?.icon ?? 'book'} s={26} />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
            {meta && <span className="badge plain">{meta.label}</span>}
            {sections.length > 0 && (
              <span className="muted mono tiny">{sections.length} section{sections.length === 1 ? '' : 's'}</span>
            )}
          </div>
          <h3 style={{ fontSize: 19, marginTop: 8 }}>{man.title}</h3>
        </button>
        {canWrite && (
          <div className="flex items-center gap-8" style={{ flex: '0 0 auto' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onEdit}
              aria-label={`Edit ${man.title}`}
              style={{ fontSize: 12.5, padding: '6px 12px' }}
            >
              <Icon name="wrench" s={14} />Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onDelete}
              aria-label={`Delete ${man.title}`}
              style={{ fontSize: 12.5, padding: '6px 12px', color: 'var(--sig-overdue)' }}
            >
              <Icon name="close" s={14} />Delete
            </button>
          </div>
        )}
        <span className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ''}`}>
          <Icon name="chevron" s={18} />
        </span>
      </div>

      {open && (
        <div className={styles.drawer}>
          {note && (
            <div style={{ padding: '4px 8px 8px' }}>
              <Markdown source={note} className="markdown" />
            </div>
          )}

          {sections.map((s, i) => {
            const href = fileHref ? `${fileHref}${s.anchor ? `#${s.anchor}` : ''}` : undefined;
            const inner = (
              <>
                <span className="mono tiny" style={{ color: 'var(--brass-deep)', width: 24, flex: '0 0 auto' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--ink-800)' }}>{s.title}</span>
                <Icon name={href ? 'arrowRight' : 'chevron'} s={15} />
              </>
            );
            return href ? (
              <a key={`${s.title}-${i}`} className={styles.section} href={href} target="_blank" rel="noopener noreferrer">
                {inner}
              </a>
            ) : (
              <div key={`${s.title}-${i}`} className={styles.section}>{inner}</div>
            );
          })}

          {fileHref && (
            <div style={{ marginTop: 12 }}>
              <a
                className="btn btn-ghost"
                href={fileHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12.5, padding: '6px 12px' }}
              >
                <Icon name="download" s={14} />Download PDF
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ edit form */

/** Form state mirrors the Manual schema's writable fields. Sections are an
 *  object-array group ({title, anchor}); buildPayload compacts blank rows. */
interface ManualForm {
  title: string;
  kind: string;
  file: string;
  body: string;
  sections: GroupRow[];
}

function blankForm(): ManualForm {
  return { title: '', kind: '', file: '', body: '', sections: [] };
}

function formFromRec(man: ManualRec): ManualForm {
  return {
    title: man.title,
    kind: man.kind ?? '',
    file: man.file ?? '',
    body: man.body ?? '',
    sections: (man.sections ?? []).map((s) => ({ title: s.title, anchor: s.anchor ?? '' })),
  };
}

function ManualEditor({
  initial,
  isNew,
  onSubmit,
  onCancel,
}: {
  initial: ManualForm;
  isNew: boolean;
  onSubmit: (payload: Record<string, unknown> & { body?: string }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<ManualForm>(initial);
  const set = <K extends keyof ManualForm>(key: K, value: ManualForm[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (): Promise<void> => {
    const payload = buildPayload({ ...form }, {
      objectArrays: { sections: { keep: ['title'] } },
    });
    await onSubmit(payload);
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 720 }}>
        <RecordForm
          eyebrow={isNew ? 'Add to the library' : 'Edit manual'}
          title={isNew ? 'New manual' : form.title || 'Edit manual'}
          onSubmit={submit}
          onCancel={onCancel}
        >
          <TextField
            label="Title"
            required
            value={form.title}
            onChange={(v) => set('title', v)}
            placeholder="e.g. Universal M-25 Owner's Manual"
          />
          <SelectField
            label="Kind"
            value={form.kind}
            onChange={(v) => set('kind', v)}
            options={KIND_OPTIONS}
            hint="What part of the boat this manual covers."
          />
          <TextField
            label="File"
            value={form.file}
            onChange={(v) => set('file', v)}
            placeholder="manuals/universal-m25.pdf"
            hint="Path to the scanned PDF under the data dir's manuals/ folder (optional)."
          />
          <GroupField
            label="Sections"
            value={form.sections}
            onChange={(v) => set('sections', v)}
            hint="A table of contents; each section deep-links into the file at its anchor."
            fields={[
              { name: 'title', label: 'Section title', kind: 'text' },
              { name: 'anchor', label: 'Anchor', kind: 'text' },
            ]}
          />
          <TextAreaField
            label="Note"
            value={form.body}
            onChange={(v) => set('body', v)}
            placeholder="A short index/summary of the manual (Markdown)."
          />
        </RecordForm>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ quick ref */

function QuickRefCard({ q }: { q: Quickref }): JSX.Element {
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-12" style={{ marginBottom: 10 }}>
        <span className={styles.refIcon}><Icon name="info" s={20} /></span>
        <h3 style={{ fontSize: 17 }}>{q.title}</h3>
      </div>
      {q.body && <p className="muted" style={{ fontSize: 13.5, color: 'var(--ink-700)', margin: 0 }}>{q.body}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

type EditTarget = { mode: 'new' } | { mode: 'edit'; man: ManualRec };

export default function ManualsPage(): JSX.Element {
  const { isOwner, demo } = useSession();
  const canWrite = isOwner && !demo;

  const [manuals, setManuals] = useState<ManualRec[] | null>(null);
  const [quickref, setQuickref] = useState<Quickref[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const load = useCallback((): Promise<void> => {
    setError(null);
    return Promise.all([api.manuals(), api.quickref().catch(() => [] as Quickref[])])
      .then(([m, q]) => {
        setManuals(m);
        setQuickref(q);
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Could not load the manuals.');
        setManuals([]);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (payload: Record<string, unknown> & { body?: string }): Promise<void> => {
    await api.createManual(payload);
    setEditing(null);
    await load();
  };

  const handleUpdate = async (
    id: string,
    payload: Record<string, unknown> & { body?: string },
  ): Promise<void> => {
    await api.updateManual(id, payload);
    setEditing(null);
    await load();
  };

  const handleDelete = async (man: ManualRec): Promise<void> => {
    if (!window.confirm(`Delete "${man.title}"? This cannot be undone.`)) return;
    await api.deleteManual(man.id);
    await load();
  };

  if (editing) {
    return editing.mode === 'new' ? (
      <ManualEditor initial={blankForm()} isNew onSubmit={handleCreate} onCancel={() => setEditing(null)} />
    ) : (
      <ManualEditor
        initial={formFromRec(editing.man)}
        isNew={false}
        onSubmit={(p) => handleUpdate(editing.man.id, p)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <span className="eyebrow">Know your boat</span>
          <h1 className="page-title">Owner&rsquo;s manuals</h1>
          <p className="page-lead">
            The books for the boat and her systems, plus quick-reference cards for the procedures you
            reach for most.
          </p>
        </div>

        {error && (
          <div className="card card-pad" role="alert" style={{ marginBottom: 22, borderColor: 'var(--sig-overdue)' }}>
            <span className="flex items-center gap-8"><Icon name="alert" s={16} />{error}</span>
          </div>
        )}

        <SectionHead
          icon="book"
          title="Manuals"
          action={
            canWrite ? (
              <button type="button" className="btn btn-brass" onClick={() => setEditing({ mode: 'new' })}>
                <Icon name="plus" s={16} />Add manual
              </button>
            ) : undefined
          }
        />

        {manuals === null ? (
          <div className="muted" style={{ padding: '20px 0' }}>Loading the library&hellip;</div>
        ) : manuals.length === 0 ? (
          <EmptyState icon="book" title="No manuals on file yet" hint="Add the boat's books and they'll appear here." />
        ) : (
          <div className="stack">
            {manuals.map((m) => (
              <ManualCard
                key={m.id}
                man={m}
                canWrite={canWrite}
                onEdit={() => setEditing({ mode: 'edit', man: m })}
                onDelete={() => void handleDelete(m)}
              />
            ))}
          </div>
        )}

        {quickref.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <SectionHead icon="info" title="Quick reference" />
            <div className="grid g-2">
              {quickref.map((q) => (
                <QuickRefCard key={q.id} q={q} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
