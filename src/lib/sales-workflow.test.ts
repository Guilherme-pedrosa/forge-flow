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
});
