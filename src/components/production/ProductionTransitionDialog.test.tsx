import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionTransitionDialog } from "./ProductionTransitionDialog";
import type { Tables } from "@/integrations/supabase/types";

afterEach(cleanup);
const job = { id: "job-1", code: "OI-1", name: "Suporte", printer_id: "printer-1", material_id: "material-1", secondary_material_id: null, actual_grams: null, actual_time_minutes: null, waste_grams: 0, est_grams: 80, est_time_minutes: 60 } as Tables<"jobs">;
function mount(status: "completed" | "failed" | "quality_check" = "completed") {
  const save = vi.fn();
  render(<ProductionTransitionDialog value={{ job, status }} printers={[{ id: "printer-1", name: "Bambu P1S", status: "idle" }]} pending={false} onClose={vi.fn()} onSave={save} />);
  return save;
}
function field(label: RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole("button", { name: "Confirmar apuração" }).closest("form")!); }

describe("apuração de uma ordem", () => {
  it("não substitui valores reais vazios por estimativas", () => {
    const save = mount(); submit();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("dados reais");
    expect(screen.getByLabelText(/Consumo total real/)).toHaveValue(null);
  });
  it("envia perda como parte do consumo total, sem soma ou coeficiente", () => {
    const save = mount();
    field(/Consumo total real/, "100"); field(/Tempo real/, "70"); field(/Desse total, perda/, "20"); field(/Mão de obra real/, "0"); field(/Custos indiretos reais/, "3"); field(/Acessórios e embalagem/, "8"); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ actualGrams: 100, wasteGrams: 20, actualMinutes: 70, actualLaborCost: 0, actualOverhead: 3, actualExtrasCost: 8 }));
  });
  it("não aceita uma perda maior que o consumo", () => {
    const save = mount();
    field(/Consumo total real/, "100"); field(/Tempo real/, "70"); field(/Desse total, perda/, "120"); field(/Mão de obra real/, "0"); field(/Custos indiretos reais/, "0"); field(/Acessórios e embalagem/, "0"); submit();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("não pode ser maior");
  });
  it("exige causa ao registrar uma falha", () => {
    const save = mount("failed");
    field(/Consumo total real/, "100"); field(/Tempo real/, "70"); field(/Mão de obra real/, "0"); field(/Custos indiretos reais/, "0"); field(/Acessórios e embalagem/, "0"); submit();
    expect(save).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("motivo da falha");
  });
  it("solicita apuração na primeira saída da impressora para controle de qualidade", () => {
    const save = mount("quality_check"); submit();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("dados reais");
    expect(screen.getByLabelText(/Acessórios e embalagem/)).toBeInTheDocument();
  });
  it("uma falha de qualidade posterior preserva a apuração já lançada", () => {
    const save = vi.fn();
    const measuredJob = { ...job, inventory_posted_at: "2026-09-12T00:00:00Z" } as Tables<"jobs">;
    render(<ProductionTransitionDialog value={{ job: measuredJob, status: "failed" }} printers={[{ id: "printer-1", name: "Bambu P1S", status: "idle" }]} pending={false} onClose={vi.fn()} onSave={save} />);
    expect(screen.queryByLabelText(/Consumo total real/)).not.toBeInTheDocument();
    field(/Motivo da falha/, "Dimensão fora de tolerância");
    fireEvent.submit(screen.getByRole("button", { name: "Registrar falha" }).closest("form")!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failureReason: "Dimensão fora de tolerância", printerId: undefined }));
    expect(save.mock.calls[0][0]).not.toHaveProperty("actualGrams");
  });
});
