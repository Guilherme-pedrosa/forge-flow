import { describe, expect, it } from "vitest";
import { filamentRegistrationPayload, newFilamentDraft, readFilamentRegistrationId, type FilamentRegistrationItem } from "./filament-registration";

const item: FilamentRegistrationItem = { id: "83000000-0000-4000-8000-000000000001", name: "PLA Branco F3D", unit: "g", current_stock: 2500,
  avg_cost: .08, material_code: "PLA", material_type: "PLA", color: "Branco", color_code: "WHITE", brand: "F3D", diameter: 1.75 };
const newDraft = () => ({ ...newFilamentDraft(), color: { name: "Framboesa", code: "", hex: "" }, brand: "F3D" });

describe("simple filament registration payload", () => {
  it("creates one identified stock item with zero balance and optional cost, without physical spool data", () => {
    const payload = filamentRegistrationPayload(newDraft());
    expect(payload.p_item_id).toBeNull();
    expect(payload.p_item).toMatchObject({ name: "PLA Framboesa F3D", category: "filament", material_code: "PLA", color: "Framboesa", color_code: "FRAMBOESA", brand: "F3D", current_stock: 0, avg_cost: 0, unit: "g" });
    expect(JSON.stringify(payload)).not.toMatch(/spool|tare|capacity|initial_net|printer|loss/);
  });
  it("converts new kilograms to saved grams and R$/kg to R$/g exactly once", () => {
    const draft = { ...newDraft(), quantity: "2,5", costPerKg: "80" };
    expect(filamentRegistrationPayload(draft).p_item).toMatchObject({ current_stock: 2500, avg_cost: .08, unit: "g" });
    expect(filamentRegistrationPayload({ ...draft, quantity: "1.001" }).p_item.current_stock).toBe(1001);
    expect(filamentRegistrationPayload({ ...draft, quantityUnit: "g", quantity: "2500" }).p_item.current_stock).toBe(2500);
  });
  it("does not replay stock or average cost when editing only metadata", () => {
    const draft = { ...newFilamentDraft(item), notes: "Guardado na estante" };
    expect(draft.costPerKg).toBe("80");
    const payload = filamentRegistrationPayload(draft, item);
    expect(payload.p_item_id).toBe(item.id);
    expect(payload.p_item).not.toHaveProperty("current_stock");
    expect(payload.p_item).not.toHaveProperty("expected_stock");
    expect(payload.p_item).not.toHaveProperty("avg_cost");
    expect(payload.p_item).toMatchObject({ color_code: "WHITE", notes: "Guardado na estante", unit: "g" });
  });
  it("preserves fine-precision saved balances and tiny valid costs during metadata edits", () => {
    for (const current_stock of [1234.1234567891, .0000001]) {
      const existing = { ...item, current_stock, avg_cost: .00000000001 };
      const draft = newFilamentDraft(existing);
      expect(draft.quantity).not.toMatch(/[eE]/);
      expect(draft.costPerKg).toBe("0.00000001");
      const payload = filamentRegistrationPayload({ ...draft, notes: "Conferido" }, existing).p_item;
      expect(payload).not.toHaveProperty("current_stock");
      expect(payload).not.toHaveProperty("avg_cost");
    }
  });
  it("sends only an intentional cost update and protects manual stock changes with the loaded balance", () => {
    const draft = { ...newFilamentDraft(item), quantity: "3000", costPerKg: "90" };
    expect(filamentRegistrationPayload(draft, item).p_item).toMatchObject({ current_stock: 3000, expected_stock: 2500, avg_cost: .09 });
    const kg = { ...item, unit: "kg", current_stock: 2.5, avg_cost: 80 };
    expect(newFilamentDraft(kg)).toMatchObject({ quantity: "2.5", quantityUnit: "kg", costPerKg: "80" });
    expect(filamentRegistrationPayload({ ...newFilamentDraft(kg), costPerKg: "90" }, kg).p_item.avg_cost).toBe(90);
    expect(() => filamentRegistrationPayload({ ...draft, quantityUnit: "kg" }, item)).toThrow(/unidade.*não pode ser alterada/);
  });
  it("inherits only material, brand and diameter for another color", () => {
    const draft = newFilamentDraft(null, { ...item, material_code: "PETG", diameter: 2.85 });
    expect(draft).toMatchObject({ materialCode: "PETG", brand: "F3D", diameter: "2.85", quantity: "0", quantityUnit: "kg", costPerKg: "", color: { name: "", code: "", hex: "" } });
  });
  it("rejects missing identity and malformed balances without treating them as zero", () => {
    expect(() => filamentRegistrationPayload(newFilamentDraft())).toThrow(/cor do filamento/);
    for (const quantity of ["", "-1", "NaN", "1e3"]) expect(() => filamentRegistrationPayload({ ...newDraft(), quantity })).toThrow(/quantidade/);
    expect(() => filamentRegistrationPayload({ ...newDraft(), materialCode: "OTHER" })).toThrow(/composição/);
    expect(() => readFilamentRegistrationId("saved")).toThrow(/não confirmou/);
    expect(readFilamentRegistrationId(item.id)).toBe(item.id);
  });
});
