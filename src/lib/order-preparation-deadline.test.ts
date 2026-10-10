import { describe, expect, it } from "vitest";
import { deliveryPreparationDay } from "./order-preparation-deadline";

const manual = (due_date: string) => ({ due_date, marketplace_order_id: null });

describe("delivery preparation day", () => {
  it.each([
    ["2026-11-10", "2026-11-09"],
    ["2026-10-01", "2026-09-30"],
    ["2027-01-01", "2026-12-31"],
    ["2024-03-01", "2024-02-29"],
    ["2026-03-01", "2026-02-28"],
  ])("keeps delivery %s unchanged and prepares on %s without assigning an hour", (delivery, preparation) => {
    const order = manual(delivery);
    expect(deliveryPreparationDay(order)).toBe(preparation);
    expect(order.due_date).toBe(delivery);
    expect(deliveryPreparationDay(order)).not.toContain("T");
  });

  it.each(["", "invalid", "2026-02-29", "2026-02-30", "2026-13-01", "2026-10-00", "2026-1-01", "2026-10-10T18:00:00Z", " 2026-10-10", "0000-01-01"])("does not infer a day from invalid delivery %s", delivery => {
    expect(deliveryPreparationDay(manual(delivery))).toBeNull();
  });

  it("requires a known internal origin and excludes either marketplace relation", () => {
    expect(deliveryPreparationDay({ due_date: "2026-11-10" })).toBeNull();
    expect(deliveryPreparationDay({ ...manual("2026-11-10"), marketplace_order_id: "marketplace-1" })).toBeNull();
    expect(deliveryPreparationDay(manual("2026-11-10"), true)).toBeNull();
    expect(deliveryPreparationDay({ marketplace_order_id: null })).toBeNull();
  });

  it.each(["2026-11-10T18:00:00-03:00", "invalid", ""])("preserves an explicit or unrecognized operating value %s instead of hiding it", value => {
    expect(deliveryPreparationDay({ ...manual("2026-11-10"), ship_by_at: value })).toBeNull();
    expect(deliveryPreparationDay({ ...manual("2026-11-10"), internal_due_at: value })).toBeNull();
  });
});
