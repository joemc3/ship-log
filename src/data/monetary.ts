/** Collections whose every record is owner-only (never sent to crew/guest). */
export const OWNER_ONLY_COLLECTIONS = ['cost'] as const;

/** Per-collection list of cost-bearing fields to strip from non-owner responses. */
export const MONETARY_FIELDS: Record<string, string[]> = {
  maintenance: ['costEst'],
  cost: ['amount'],
};

export function isMonetaryField(collection: string, field: string): boolean {
  return (MONETARY_FIELDS[collection] ?? []).includes(field);
}
