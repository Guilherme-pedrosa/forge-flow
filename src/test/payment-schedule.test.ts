import { describe, expect, it } from "vitest";
import { generateParts, validateParts } from "@/components/shared/InstallmentEditor";

describe("Parcelas revisáveis", () => {
  it("distribui centavos sem alterar o total e permite intervalo em dias", () => {
    const parts = generateParts(100, 3, "2026-01-31", "15");
    expect(parts).toEqual([{amount:"33.34",due_date:"2026-01-31"},{amount:"33.33",due_date:"2026-02-15"},{amount:"33.33",due_date:"2026-03-02"}]);
    expect(validateParts(parts,100)).toHaveLength(3);
  });
  it("usa último dia do mês no modo mensal e aceita vencimentos ajustados", () => {
    const parts = generateParts(10,2,"2026-01-31","");
    expect(parts[1].due_date).toBe("2026-02-28");
    expect(validateParts([{amount:"3,50",due_date:"2026-02-02"},{amount:"6,50",due_date:"2026-04-12"}],10)).toEqual([{amount:3.5,due_date:"2026-02-02"},{amount:6.5,due_date:"2026-04-12"}]);
  });
  it("recusa soma diferente, valores inválidos e data inexistente", () => {
    expect(()=>validateParts([{amount:"9",due_date:"2026-01-31"}],10)).toThrow("soma");
    expect(()=>validateParts([{amount:"-10",due_date:"2026-01-31"}],10)).toThrow();
    expect(()=>validateParts([{amount:"10",due_date:"2026-02-30"}],10)).toThrow("vencimentos");
    expect(()=>generateParts(10,2,"2026-01-01","-1")).toThrow("intervalo");
  });
});
