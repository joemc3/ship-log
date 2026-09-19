/**
 * Resolve a record's photo ref to the URL the /photos route serves it at.
 *
 * Records store refs as `photos/<name>.jpg` (the repo-relative path); the
 * route serves them root-anchored, so the URL is that path with a leading
 * slash. A ref that is already absolute (http/https) is passed through, and an
 * accidental leading slash is not doubled. One helper for every page, so the
 * three copies that used to disagree with each other can't drift again.
 */
export function photoUrl(ref: string): string {
  if (/^https?:\/\//.test(ref)) return ref;
  return `/${ref.replace(/^\/+/, '')}`;
}
