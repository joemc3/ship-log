/**
 * Form-kit barrel — the single import surface the Milestone B page/write work
 * consumes. Pages compose the field primitives inside a RecordForm, collect flat
 * state, run it through `buildPayload` (which omits blank optionals + splits out
 * `body`), then call the typed `api.createX/updateX`. PhotoUpload returns a
 * `photos/<hash>.jpg` ref to append to a record's photos[].
 */
export { buildPayload, type BuildPayloadOptions } from './buildPayload.js';
export {
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  SelectField,
  StringArrayField,
  GroupField,
  type SelectOption,
  type GroupSubField,
  type GroupRow,
} from './fields.js';
export { RecordForm } from './RecordForm.js';
export { PhotoUpload } from './PhotoUpload.js';
