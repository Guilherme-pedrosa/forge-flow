import { describe, expect, it } from "vitest";
import { excludeUnstartedCancelledJobs } from "./job-source-cancellation";

const orders = [{ id: "cancelled-sale", status: "cancelled" }, { id: "active-sale", status: "approved" }];
const productionOrders = [
  { id: "derived-op", status: "released", source_order_id: "cancelled-sale" },
  { id: "cancelled-op", status: "cancelled", source_order_id: "active-sale" },
  { id: "active-op", status: "released", source_order_id: "active-sale" },
];

describe("cancelled source in active planning", () => {
  it.each(["draft", "queued", "reprint"])("excludes unstarted %s work from every cancelled source path", status => {
    const jobs = [
      { id: "direct", status, order_id: "cancelled-sale" },
      { id: "derived", status, order_id: null, production_order_id: "derived-op" },
      { id: "op", status, production_order_id: "cancelled-op" },
      { id: "conflicting", status, order_id: "active-sale", production_order_id: "derived-op" },
      { id: "active", status, production_order_id: "active-op" },
    ];
    expect(excludeUnstartedCancelledJobs(jobs, orders, productionOrders).map(job => job.id)).toEqual(["active"]);
  });

  it.each(["printing", "paused", "failed", "post_processing", "quality_check", "ready", "completed", "shipped"])("retains %s for physical follow-up and accounting", status => {
    const job = { id: status, status, order_id: "cancelled-sale", production_order_id: "cancelled-op" };
    expect(excludeUnstartedCancelledJobs([job], orders, productionOrders)).toEqual([job]);
  });

  it("preserves execution markers even when status has returned to queued/draft/reprint", () => {
    const jobs = [
      { id: "started", status: "queued", order_id: "cancelled-sale", started_at: "2026-10-10T10:00:00Z" },
      { id: "posted", status: "reprint", production_order_id: "derived-op", inventory_posted_at: "2026-10-10T11:00:00Z" },
      { id: "draft-started", status: "draft", production_order_id: "cancelled-op", started_at: "legacy-marker" },
    ];
    expect(excludeUnstartedCancelledJobs(jobs, orders, productionOrders)).toEqual(jobs);
  });

  it("does not infer cancellation from absent or unknown source records", () => {
    const jobs = [
      { id: "unlinked", status: "queued" },
      { id: "missing-sale", status: "queued", order_id: "missing" },
      { id: "missing-op", status: "queued", production_order_id: "missing" },
      { id: "unknown-op", status: "queued", production_order_id: "unknown-op" },
    ];
    expect(excludeUnstartedCancelledJobs(jobs, orders, [{ id: "unknown-op", source_order_id: "unknown-sale" }])).toEqual(jobs);
  });

  it("leaves the original jobs available for history without changing their data", () => {
    const cancelled = Object.freeze({ id: "cancelled", status: "queued", order_id: "cancelled-sale", started_at: null, inventory_posted_at: null });
    const active = Object.freeze({ id: "active", status: "queued", order_id: "active-sale" });
    const history = Object.freeze([cancelled, active]);
    expect(excludeUnstartedCancelledJobs(history, orders, productionOrders)).toEqual([active]);
    expect(history).toEqual([cancelled, active]);
    expect(excludeUnstartedCancelledJobs(history, [], [])[0]).toBe(cancelled);
  });
});
