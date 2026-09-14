import type { OrderRecord } from './types.ts';

/** Statuses shown on floor / orders as live operational checks. */
export const OPEN_OPERATIONAL_STATUSES = new Set(['In Progress', 'Pending']);

/**
 * Open checks must carry an invoice number — every real CREATE allocates one.
 * Rows without it are sync/import shells (sparse MERGE replay, id-only seeds).
 */
export function isGhostOperationalOrder(
  order: Pick<OrderRecord, 'status' | 'invoice_number'>,
): boolean {
  const status = String(order.status ?? '');
  if (!OPEN_OPERATIONAL_STATUSES.has(status)) {
    return false;
  }
  const inv = order.invoice_number;
  return inv == null || !Number.isFinite(Number(inv));
}

/** Whether a brand-new Dexie row may be created from this patch (no existing row). */
export function shouldMaterializeNewOrder(
  patch: Partial<OrderRecord>,
): boolean {
  const status = String(patch.status ?? 'In Progress');
  if (!OPEN_OPERATIONAL_STATUSES.has(status)) {
    return true;
  }
  const inv = patch.invoice_number;
  return inv != null && Number.isFinite(Number(inv));
}

const CLOSED_STATUSES = new Set([
  'Paid',
  'Cancelled',
  'Merged',
  'Spilt',
  'Refunded',
]);

/** Merge sparse remote patches must not wipe authoritative header fields. */
export function preserveOrderHeaderOnMerge(
  existing: OrderRecord | undefined,
  patch: Partial<OrderRecord>,
): Partial<OrderRecord> {
  if (!existing) {
    return patch;
  }
  const next = { ...patch };
  if (existing.invoice_number != null && next.invoice_number == null) {
    next.invoice_number = existing.invoice_number;
  }
  if (existing.auto_id != null && next.auto_id == null) {
    next.auto_id = existing.auto_id;
  }
  if (existing.user && !next.user) {
    next.user = existing.user;
  }
  if (existing.order_type && !next.order_type) {
    next.order_type = existing.order_type;
  }
  if (existing.cashier && !next.cashier) {
    next.cashier = existing.cashier;
  }
  const existingStatus = String(existing.status ?? '');
  const patchStatus = next.status != null ? String(next.status) : null;
  if (
    CLOSED_STATUSES.has(existingStatus)
    && (!patchStatus || OPEN_OPERATIONAL_STATUSES.has(patchStatus))
  ) {
    next.status = existing.status;
  }
  return next;
}
