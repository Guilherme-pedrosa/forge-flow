/** A preparation day for an internal sale, never a posting cutoff or a promised hour. */
export function deliveryPreparationDay(order: {
  due_date?: string | null;
  ship_by_at?: string | null;
  internal_due_at?: string | null;
  marketplace_order_id?: string | null;
}, hasMarketplaceLink = false): string | null {
  if (hasMarketplaceLink || order.marketplace_order_id !== null || order.ship_by_at != null || order.internal_due_at != null) return null;
  const deliveryDay = order.due_date;
  if (!deliveryDay || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDay)) return null;
  // UTC is only used for civil calendar arithmetic; the result remains a DATE.
  const day = new Date(`${deliveryDay}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== deliveryDay) return null;
  day.setUTCDate(day.getUTCDate() - 1);
  const preparationDay = day.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(preparationDay) ? preparationDay : null;
}
