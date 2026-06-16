/**
 * Form-kit field primitives. Each is a small CONTROLLED input: a `value` + an
 * `onChange(next)` callback, a label, an optional hint, a required marker, and a
 * per-field error slot. They emit nothing app-specific — pages compose them into
 * a RecordForm and feed the collected state through `buildPayload` before calling
 * the typed API client. Styling is the co-located CSS module (parchment tokens
 * from app.css); we never edit the shared stylesheet.
 *
 * The field set mirrors the Zod shapes in `src/data/schema.ts`:
 *   - TextField / TextAreaField  → strings (title, body narrative, …)
 *   - NumberField                → numeric strings (buildPayload coerces)
 *   - DateField                  → ISO YYYY-MM-DD
 *   - SelectField                → enums (status, severity, waypoint type, …)
 *   - StringArrayField           → string[] (crew[], services[])
 *   - GroupField                 → object[] (waypoints[], findings[], sections[])
 */
import { useId, type ReactNode } from 'react';
import { Icon } from '../Icon.js';
import styles from './forms.module.css';

interface BaseProps {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  id?: string;
}

/** Shared label + hint + error wrapper around a control. */
function Field({
  label,
  hint,
  required,
  error,
  htmlFor,
  children,
}: BaseProps & { htmlFor: string; children: ReactNode }): JSX.Element {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {required && <span className={styles.req} aria-hidden="true">*</span>}
      </label>
      {hint && <p className={styles.hint}>{hint}</p>}
      {children}
      {error && <p className={styles.fieldError} role="alert">{error}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------- scalars */

export function TextField({
  value,
  onChange,
  placeholder,
  ...base
}: BaseProps & { value: string; onChange: (v: string) => void; placeholder?: string }): JSX.Element {
  const auto = useId();
  const id = base.id ?? auto;
  return (
    <Field {...base} htmlFor={id}>
      <input
        id={id}
        type="text"
        className={`${styles.control}${base.error ? ` ${styles.invalid}` : ''}`}
        value={value}
        required={base.required}
        placeholder={placeholder}
        aria-invalid={base.error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 8,
  ...base
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}): JSX.Element {
  const auto = useId();
  const id = base.id ?? auto;
  return (
    <Field {...base} htmlFor={id}>
      <textarea
        id={id}
        className={`${styles.textarea}${base.error ? ` ${styles.invalid}` : ''}`}
        value={value}
        rows={rows}
        required={base.required}
        placeholder={placeholder}
        aria-invalid={base.error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  value,
  onChange,
  placeholder,
  step,
  min,
  ...base
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: number | string;
  min?: number | string;
}): JSX.Element {
  const auto = useId();
  const id = base.id ?? auto;
  return (
    <Field {...base} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={`${styles.control}${base.error ? ` ${styles.invalid}` : ''}`}
        value={value}
        step={step}
        min={min}
        required={base.required}
        placeholder={placeholder}
        aria-invalid={base.error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function DateField({
  value,
  onChange,
  ...base
}: BaseProps & { value: string; onChange: (v: string) => void }): JSX.Element {
  const auto = useId();
  const id = base.id ?? auto;
  return (
    <Field {...base} htmlFor={id}>
      <input
        id={id}
        type="date"
        className={`${styles.control}${base.error ? ` ${styles.invalid}` : ''}`}
        value={value}
        required={base.required}
        aria-invalid={base.error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder = '—',
  ...base
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  /** Label for the empty (unset) choice. */
  placeholder?: string;
}): JSX.Element {
  const auto = useId();
  const id = base.id ?? auto;
  return (
    <Field {...base} htmlFor={id}>
      <select
        id={id}
        className={`${styles.select}${base.error ? ` ${styles.invalid}` : ''}`}
        value={value}
        required={base.required}
        aria-invalid={base.error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ---------------------------------------------------------- repeatable: scalars */

export function StringArrayField({
  value,
  onChange,
  itemLabel,
  placeholder,
  ...base
}: BaseProps & {
  value: string[];
  onChange: (v: string[]) => void;
  /** Singular noun for each row's aria-label, e.g. "Crew member". */
  itemLabel?: string;
  placeholder?: string;
}): JSX.Element {
  const noun = itemLabel ?? `${base.label} member`;
  const setAt = (i: number, v: string): void => {
    const next = [...value];
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number): void => onChange(value.filter((_, j) => j !== i));
  const add = (): void => onChange([...value, '']);

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {base.label}
        {base.required && <span className={styles.req} aria-hidden="true">*</span>}
      </span>
      {base.hint && <p className={styles.hint}>{base.hint}</p>}
      <div className={styles.rows}>
        {value.map((v, i) => (
          <div className={styles.row} key={i}>
            <input
              type="text"
              className={`${styles.control} ${styles.rowGrow}`}
              aria-label={`${noun} ${i + 1}`}
              value={v}
              placeholder={placeholder}
              onChange={(e) => setAt(i, e.target.value)}
            />
            <button
              type="button"
              className={`btn btn-ghost ${styles.removeBtn}`}
              aria-label={`Remove ${noun} ${i + 1}`}
              onClick={() => removeAt(i)}
            >
              <Icon name="close" s={14} />
            </button>
          </div>
        ))}
        <button type="button" className={`btn btn-ghost ${styles.addBtn}`} onClick={add}>
          <Icon name="plus" s={14} />Add {noun.toLowerCase()}
        </button>
      </div>
      {base.error && <p className={styles.fieldError} role="alert">{base.error}</p>}
    </div>
  );
}

/* ---------------------------------------------------- repeatable: object groups */

export type GroupSubField =
  | { name: string; label: string; kind: 'text' }
  | { name: string; label: string; kind: 'date' }
  | { name: string; label: string; kind: 'number' }
  | { name: string; label: string; kind: 'select'; options: readonly SelectOption[] };

export type GroupRow = Record<string, string>;

/** A repeatable group of object rows (waypoints[], findings[], sections[]).
 *  Each row is a flat string-map; buildPayload's objectArrays config compacts
 *  blank fields + drops empty rows before the payload is sent. */
export function GroupField({
  value,
  onChange,
  fields,
  ...base
}: BaseProps & {
  value: GroupRow[];
  onChange: (v: GroupRow[]) => void;
  fields: readonly GroupSubField[];
}): JSX.Element {
  const blankRow = (): GroupRow => Object.fromEntries(fields.map((f) => [f.name, '']));

  const setRowField = (i: number, name: string, v: string): void => {
    const next = value.map((row, j) => (j === i ? { ...row, [name]: v } : row));
    onChange(next);
  };
  const removeRow = (i: number): void => onChange(value.filter((_, j) => j !== i));
  const addRow = (): void => onChange([...value, blankRow()]);

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {base.label}
        {base.required && <span className={styles.req} aria-hidden="true">*</span>}
      </span>
      {base.hint && <p className={styles.hint}>{base.hint}</p>}
      <div className={styles.rows}>
        {value.map((row, i) => (
          <div className={styles.groupRow} data-testid="group-row" key={i}>
            {fields.map((f) => (
              <GroupSubInput
                key={f.name}
                field={f}
                value={row[f.name] ?? ''}
                onChange={(v) => setRowField(i, f.name, v)}
              />
            ))}
            <button
              type="button"
              className={`btn btn-ghost ${styles.removeBtn}`}
              aria-label={`Remove ${base.label} ${i + 1}`}
              onClick={() => removeRow(i)}
            >
              <Icon name="close" s={14} />Remove
            </button>
          </div>
        ))}
        <button type="button" className={`btn btn-ghost ${styles.addBtn}`} onClick={addRow}>
          <Icon name="plus" s={14} />Add {base.label.toLowerCase()}
        </button>
      </div>
      {base.error && <p className={styles.fieldError} role="alert">{base.error}</p>}
    </div>
  );
}

function GroupSubInput({
  field,
  value,
  onChange,
}: {
  field: GroupSubField;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  switch (field.kind) {
    case 'select':
      return <SelectField label={field.label} value={value} onChange={onChange} options={field.options} />;
    case 'date':
      return <DateField label={field.label} value={value} onChange={onChange} />;
    case 'number':
      return <NumberField label={field.label} value={value} onChange={onChange} />;
    case 'text':
    default:
      return <TextField label={field.label} value={value} onChange={onChange} />;
  }
}
