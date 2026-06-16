/**
 * Shared UI atoms ported from the prototype's components.jsx, retyped against
 * the REAL record shapes (src/data/schema.ts) — not the prototype's mock
 * window.DATA. Visual output (class names, structure) is preserved 1:1; the
 * data bindings are the authoritative ones.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon.js';
import type { MaintStatus, Trip } from '../lib/types.js';

/** Maintenance status -> badge label + CSS class (matches the prototype STATUS map). */
const STATUS: Record<MaintStatus, { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'overdue' },
  due: { label: 'Due soon', cls: 'due' },
  scheduled: { label: 'Scheduled', cls: 'scheduled' },
  done: { label: 'Done', cls: 'done' },
};

export function StatusBadge({ status }: { status: MaintStatus }): JSX.Element {
  const s = STATUS[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span className="dot" />
      {s.label}
    </span>
  );
}

/** A generic dot-badge for ad-hoc tones (e.g. inventory overdue/due/good). */
export type BadgeTone = 'overdue' | 'due' | 'scheduled' | 'done' | 'plain';
export function Badge({ tone = 'plain', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

/** Placeholder photo tile (the real <img> swap lands with a later page that
 *  resolves photos/<name>.jpg against the photo route). */
export function Photo({
  label,
  h = 160,
  parchment = false,
  icon = 'camera',
  style,
}: {
  label?: string;
  h?: number;
  parchment?: boolean;
  icon?: IconName;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div className={`photo${parchment ? ' parchment' : ''}`} style={{ height: h, ...style }}>
      <span className="photo-ico"><Icon name={icon} s={26} /></span>
      {label && <span className="photo-tag">{label}</span>}
    </div>
  );
}

export function Stat({ label, value, sm = false }: { label: ReactNode; value: ReactNode; sm?: boolean }): JSX.Element {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${sm ? ' sm' : ''}`}>{value}</div>
    </div>
  );
}

export function SectionHead({ icon, title, action }: { icon?: IconName; title: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="sec-head">
      {icon && <span style={{ color: 'var(--brass-deep)' }}><Icon name={icon} s={20} /></span>}
      <h2>{title}</h2>
      <span className="sec-rule" />
      {action}
    </div>
  );
}

/** Weather chips for a trip. Each chip is rendered only when its field exists
 *  (the real Trip shape makes sky/wind/seas/tempF all optional). */
export function WeatherRow({ trip }: { trip: Pick<Trip, 'wind' | 'seas' | 'sky' | 'tempF'> }): JSX.Element {
  return (
    <div className="flex wrap gap-8">
      {trip.wind && <span className="chip"><Icon name="wind" s={15} />{trip.wind}</span>}
      {trip.seas && <span className="chip"><Icon name="waves" s={15} />{trip.seas}</span>}
      {trip.sky && <span className="chip"><Icon name="sun" s={15} />{trip.sky}</span>}
      {trip.tempF !== undefined && <span className="chip"><Icon name="thermo" s={15} />{trip.tempF}°F</span>}
    </div>
  );
}

/** A parchment card surface. `pad` adds the standard inner padding. */
export function Card({ pad = false, className = '', style, children }: { pad?: boolean; className?: string; style?: React.CSSProperties; children: ReactNode }): JSX.Element {
  return <div className={`card${pad ? ' card-pad' : ''}${className ? ` ${className}` : ''}`} style={style}>{children}</div>;
}

type Variant = 'primary' | 'brass' | 'ghost';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
}
export function Button({ variant = 'ghost', icon, children, className = '', ...rest }: ButtonProps): JSX.Element {
  return (
    <button className={`btn btn-${variant}${className ? ` ${className}` : ''}`} {...rest}>
      {icon && <Icon name={icon} s={16} />}
      {children}
    </button>
  );
}

/** Centered empty-state, used by pages with no records yet. */
export function EmptyState({ icon = 'info', title, hint }: { icon?: IconName; title: ReactNode; hint?: ReactNode }): JSX.Element {
  return (
    <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-tint)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--brass-deep)' }}>
        <Icon name={icon} s={28} />
      </div>
      <div style={{ fontWeight: 600, color: 'var(--ink-700)' }}>{title}</div>
      {hint && <div className="muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
