/**
 * TripForm — the create/edit form for a trip log, composed from the form kit.
 *
 * Bound to the REAL write API: it collects flat field state, runs it through
 * `buildPayload` (which OMITS blank optionals + splits out `body`), then calls
 * `api.createTrip` / `api.updateTrip`. PARTIAL ENTRIES ARE FIRST-CLASS — the only
 * required field is the `date`, so submitting just a date posts `{ date }` and the
 * server derives the id (we never send one).
 *
 * Crew and owner share the same trip-write scope, so this form is identical for
 * both; the page gates its visibility (and hides it entirely in demo). Trips carry
 * NO cost data, so nothing here ever offers a monetary input.
 *
 * Findings may cross-link to a maintenance item: the optional `maintId` picker is
 * populated from GET /api/maintenance (open work first) so a finding can point at
 * the work it spawned. PhotoUpload appends `photos/<hash>.jpg` refs to photos[].
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon.js';
import {
  RecordForm,
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  StringArrayField,
  GroupField,
  PhotoUpload,
  buildPayload,
  type GroupRow,
  type GroupSubField,
  type SelectOption,
} from '../components/forms/index.js';
import { api } from '../lib/api.js';
import type { TripRec, MaintenanceRec } from '../lib/types.js';
import styles from './TripForm.module.css';

/** The flat, all-string form state (the form kit's controlled-input shape). */
interface FormState {
  title: string;
  date: string;
  sky: string;
  wind: string;
  seas: string;
  tempF: string;
  durationHrs: string;
  distanceNm: string;
  engineHrs: string;
  crew: string[];
  waypoints: GroupRow[];
  findings: GroupRow[];
  body: string;
}

const WAYPOINT_TYPE_OPTIONS: readonly SelectOption[] = [
  { value: 'depart', label: 'Depart' },
  { value: 'waypoint', label: 'Waypoint' },
  { value: 'anchor', label: 'Anchor' },
  { value: 'arrive', label: 'Arrive' },
];

const SEVERITY_OPTIONS: readonly SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const WAYPOINT_FIELDS: readonly GroupSubField[] = [
  { name: 'name', label: 'Name', kind: 'text' },
  { name: 'type', label: 'Type', kind: 'select', options: WAYPOINT_TYPE_OPTIONS },
  { name: 'time', label: 'Time', kind: 'text' },
  { name: 'note', label: 'Note', kind: 'text' },
];

/** buildPayload config: numbers are coerced, arrays compacted, group rows pruned. */
const PAYLOAD_OPTS = {
  numbers: ['tempF', 'durationHrs', 'distanceNm', 'engineHrs'] as const,
  arrays: ['crew', 'photos'] as const,
  objectArrays: {
    waypoints: { keep: ['name'] as const },
    findings: { keep: ['text'] as const },
  },
};

/** Seed the form state from an existing record (Edit) or blank defaults (Add). */
function seedState(trip?: TripRec): FormState {
  return {
    title: trip?.title ?? '',
    date: trip?.date ?? '',
    sky: trip?.sky ?? '',
    wind: trip?.wind ?? '',
    seas: trip?.seas ?? '',
    tempF: trip?.tempF !== undefined ? String(trip.tempF) : '',
    durationHrs: trip?.durationHrs !== undefined ? String(trip.durationHrs) : '',
    distanceNm: trip?.distanceNm !== undefined ? String(trip.distanceNm) : '',
    engineHrs: trip?.engineHrs !== undefined ? String(trip.engineHrs) : '',
    crew: trip?.crew ? [...trip.crew] : [],
    waypoints: (trip?.waypoints ?? []).map((w) => ({
      name: w.name ?? '',
      type: w.type ?? '',
      time: w.time ?? '',
      note: w.note ?? '',
    })),
    findings: (trip?.findings ?? []).map((f) => ({
      text: f.text ?? '',
      severity: f.severity ?? '',
      maintId: f.maintId ?? '',
    })),
    body: trip?.body ?? '',
  };
}

export function TripForm({
  trip,
  onSaved,
  onCancel,
}: {
  /** When present the form edits this trip (PUT); otherwise it creates one (POST). */
  trip?: TripRec;
  /** Called after a successful write so the page can refresh + close the form. */
  onSaved: () => void;
  onCancel: () => void;
}): JSX.Element {
  const editing = trip !== undefined;
  const [state, setState] = useState<FormState>(() => seedState(trip));
  const [photos, setPhotos] = useState<string[]>(() => trip?.photos ? [...trip.photos] : []);
  const [maint, setMaint] = useState<MaintenanceRec[]>([]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setState((s) => ({ ...s, [key]: value }));

  // The finding maint-picker is populated from the work list (open items first);
  // a soft failure just leaves the picker empty — the field is optional anyway.
  useEffect(() => {
    let alive = true;
    api.maintenance()
      .then((m) => { if (alive) setMaint(m); })
      .catch(() => { /* picker is optional; ignore */ });
    return () => { alive = false; };
  }, []);

  const maintOptions = useMemo<readonly SelectOption[]>(
    () =>
      [...maint]
        .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
        .map((m) => ({ value: m.id, label: m.title })),
    [maint],
  );

  const findingFields = useMemo<readonly GroupSubField[]>(
    () => [
      { name: 'text', label: 'Finding', kind: 'text' },
      { name: 'severity', label: 'Severity', kind: 'select', options: SEVERITY_OPTIONS },
      { name: 'maintId', label: 'Linked work item', kind: 'select', options: maintOptions },
    ],
    [maintOptions],
  );

  const handleSubmit = async (): Promise<void> => {
    const payload = buildPayload(
      { ...state, photos },
      {
        numbers: PAYLOAD_OPTS.numbers,
        arrays: PAYLOAD_OPTS.arrays,
        objectArrays: PAYLOAD_OPTS.objectArrays,
      },
    );
    if (editing) {
      await api.updateTrip(trip.id, payload);
    } else {
      await api.createTrip(payload);
    }
    onSaved();
  };

  return (
    <div className="page fade-in">
      <div className="page-wrap" style={{ maxWidth: 760 }}>
        <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 18 }}>
          <Icon name="arrowLeft" s={16} />Back
        </button>

        <RecordForm
          eyebrow={editing ? 'Edit trip log' : 'New trip log'}
          title={editing ? (trip.title ?? 'Edit trip') : 'Log a trip'}
          saveLabel={editing ? 'Save changes' : 'Save log'}
          onSubmit={handleSubmit}
          onCancel={onCancel}
        >
          <div className="card card-pad">
            <TextField
              label="Title"
              value={state.title}
              onChange={(v) => set('title', v)}
              placeholder="Coastal passage to Heron Cove"
              hint="Optional — defaults to the date if left blank."
            />
            <DateField
              label="Date"
              required
              value={state.date}
              onChange={(v) => set('date', v)}
              hint="The only thing a trip needs. Everything else can come later."
            />
          </div>

          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Conditions</div>
            <div className={`grid ${styles.twoCol}`} style={{ alignItems: 'start' }}>
              <TextField label="Sky" value={state.sky} onChange={(v) => set('sky', v)} placeholder="Clear, building cumulus" />
              <TextField label="Wind" value={state.wind} onChange={(v) => set('wind', v)} placeholder="SW 14-18 kt" />
              <TextField label="Seas" value={state.seas} onChange={(v) => set('seas', v)} placeholder="moderate, 2-3 ft" />
              <NumberField label="Air temp (°F)" value={state.tempF} onChange={(v) => set('tempF', v)} placeholder="64" />
            </div>
            <div className={`grid ${styles.threeCol}`} style={{ alignItems: 'start' }}>
              <NumberField label="Duration (hrs)" value={state.durationHrs} onChange={(v) => set('durationHrs', v)} step="0.1" min={0} />
              <NumberField label="Distance (nm)" value={state.distanceNm} onChange={(v) => set('distanceNm', v)} step="0.1" min={0} />
              <NumberField label="Engine (hrs)" value={state.engineHrs} onChange={(v) => set('engineHrs', v)} step="0.1" min={0} />
            </div>
          </div>

          <div className="card card-pad">
            <StringArrayField
              label="Crew aboard"
              itemLabel="Crew member"
              value={state.crew}
              onChange={(v) => set('crew', v)}
              placeholder="Dana R."
            />
          </div>

          <div className="card card-pad">
            <GroupField
              label="Waypoints"
              hint="The route, in order. A waypoint needs a name to be kept."
              value={state.waypoints}
              onChange={(v) => set('waypoints', v)}
              fields={WAYPOINT_FIELDS}
            />
          </div>

          <div className="card card-pad">
            <GroupField
              label="Findings"
              hint="Anything you noticed — link it to a work item if it needs attention."
              value={state.findings}
              onChange={(v) => set('findings', v)}
              fields={findingFields}
            />
          </div>

          <div className="card card-pad">
            <TextAreaField
              label="Log"
              value={state.body}
              onChange={(v) => set('body', v)}
              placeholder="The longest passage of the year — a delivery run down the coast…"
              hint="Markdown narrative. Optional."
            />
          </div>

          <div className="card card-pad">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Photos{photos.length > 0 ? ` · ${photos.length}` : ''}</div>
            {photos.length > 0 && (
              <div className="flex wrap gap-8" style={{ marginBottom: 12 }}>
                {photos.map((ref, i) => (
                  <span key={`${ref}-${i}`} className="chip tiny">
                    <Icon name="camera" s={13} />Photo {i + 1}
                    <button
                      type="button"
                      className={styles.photoRemove}
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" s={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <PhotoUpload onUploaded={(ref) => setPhotos((p) => [...p, ref])} />
          </div>
        </RecordForm>
      </div>
    </div>
  );
}
