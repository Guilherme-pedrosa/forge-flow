import { describe, expect, it } from "vitest";
import { operatingDateInput, operatingDateToIso, readSalesWorkflowResult, salesOrderNextAction } from "./sales-workflow";

describe("sales workflow feedback", () => {
  it("does not report success for a missing or malformed confirmation receipt", () => {
    for (const value of [null, "order-id", { order_id: "1", outcome: "done" }, { order_id: "1", outcome: "needs_preparation", issues: [null], production_order_id: null }]) {
      expect(() => readSalesWorkflowResult(value)).toThrow(/confirmação/);
    }
  });
  it("shows a preparation exception and the next operational action", () => {
    expect(salesOrderNextAction({ status: "draft", workflow_issues: ["Missing recipe"] })).toBe("Resolver pendências");
    expect(salesOrderNextAction({ status: "draft" })).toBe("Confirmar e organizar");
    expect(salesOrderNextAction({ status: "ready" })).toBe("Embalar e postar");
  });
  it("round trips a local shipping hour while retaining its UTC instant", () => {
    const local = "2026-11-10T14:30";
    const iso = operatingDateToIso(local, "postagem");
    expect(iso).toMatch(/Z$/);
    expect(operatingDateInput(iso)).toBe(local);
    expect(operatingDateToIso("", "postagem")).toBeNull();
    expect(() => operatingDateToIso("invalid", "postagem")).toThrow(/postagem/);
  });
  it.each(["2026-10-13T23:59:59-03:00", "2026-10-13T23:59:59.123456-03:00", "2026-10-14T02:59:59.987Z"])("preserves the complete official instant %s when its displayed minute is unchanged", original => {
    expect(operatingDateToIso(operatingDateInput(original), "postagem", original)).toBe(original);
  });
  it("uses the edited minute when the operator changes a saved deadline", () => {
    const original = "2026-10-13T23:59:59.123-03:00";
    const editedInstant = new Date(Date.parse(original) + 60_000).toISOString();
    const edited = operatingDateInput(editedInstant);
    expect(operatingDateToIso(edited, "postagem", original)).toBe(new Date(edited).toISOString());
    expect(operatingDateToIso(edited, "postagem", original)).not.toBe(original);
    expect(operatingDateToIso("", "postagem", original)).toBeNull();
  });
  it("does not reuse an invalid or date-only original", () => {
    expect(operatingDateToIso("2026-10-13T23:59", "postagem", "invalid")).toBe(new Date("2026-10-13T23:59").toISOString());
    const local = operatingDateInput("2026-10-13");
    expect(operatingDateToIso(local, "postagem", "2026-10-13")).toBe(new Date(local).toISOString());
  });
});
