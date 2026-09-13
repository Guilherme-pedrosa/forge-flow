import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPrintPlates from "@/pages/comercial/ProductPrintPlates";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), plates: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (result: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve({
        data: table === "product_print_plates" ? mock.plates : table === "inventory_items" ? [{ id: "material-1", name: "PLA preto", unit: "g" }]
          : table === "printers" ? [{ id: "printer-1", name: "Impressora A" }]
            : [{ id: "task-1", bambu_task_id: "101", design_title: "Tampa do produto", status: "2", start_time: "2026-09-13T10:00:00Z", bambu_devices: { name: "Impressora A" } }], error: null,
      }).then(resolve, reject),
    };
    return builder;
  },
} }));
const base = { tenant_id: "tenant-1", product_id: "product-1", source_id: "source-1", units_per_plate: 1, material_id: "material-1", printer_id: "printer-1", est_grams: null, est_time_seconds: null, est_cost_per_unit: null, actual_grams_per_unit: 10, actual_seconds_per_unit: 600, actual_sample_units: 4, actual_source: "measured", actual_updated_at: null, model_id: "model-1", profile_id: "profile-1", is_active: true };
const mount = (client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) => render(<QueryClientProvider client={client}><ProductPrintPlates productId="product-1" tenantId="tenant-1" sourceId="source-1" showProductTotal /></QueryClientProvider>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: "plate-3", error: null }); mock.toast.mockClear();
  mock.plates = [
    { ...base, id: "plate-1", plate_index: 1, label: "Base", actual_cost_per_unit: 10 },
    { ...base, id: "plate-2", plate_index: 2, label: "Tampa", actual_cost_per_unit: 8 },
  ];
});
afterEach(cleanup);

describe("product plate configuration", () => {
  it("loads observed costs even when the planner cached a narrower plate projection", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["product_print_plates", "tenant-1", "product-1"], mock.plates.map(plate => ({
      id: plate.id, source_id: plate.source_id, plate_index: plate.plate_index, label: plate.label,
      units_per_plate: plate.units_per_plate, is_active: true,
    })));
    mount(client);
    expect(await screen.findByText(/R\$\s18,00/)).toBeInTheDocument();
    expect(screen.getByText("20min")).toBeInTheDocument();
  });
  it("shows base plus lid as an eighteen-real product", async () => {
    mount();
    expect(await screen.findByText(/Produto completo · 2 placas ativas/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s18,00/)).toBeInTheDocument();
    expect(screen.getByText("20min")).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s9,00/)).not.toBeInTheDocument();
  });
  it("saves print totals and per-unit cost with explicit capacity, without sending read-only averages", async () => {
    mount();
    await screen.findByText("Placa 1 · Base");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar placa" }));
    fireEvent.change(screen.getByLabelText("Nome da placa (ex.: base ou tampa)"), { target: { value: "Encaixe" } });
    fireEvent.change(screen.getByLabelText("Unidades do produto atendidas por impressão desta placa"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Peso estimado por impressão (g)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Tempo estimado por impressão (min)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Custo estimado por unidade do produto (R$)"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_print_plate", {
      p_plate_id: null, p_product_id: "product-1", p_source_id: "source-1",
      p_plate: { plate_index: 3, label: "Encaixe", units_per_plate: 4, material_id: null, printer_id: null, est_grams: 100, est_time_seconds: 3600, est_cost_per_unit: 8 },
    }));
  });
  it("shows existing Bambu IDs read-only and keeps them outside the save RPC whitelist", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar placa 1" }));
    expect(screen.getByText("model-1")).toBeInTheDocument();
    expect(screen.getByText("profile-1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Model ID da placa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Profile ID da placa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    const payload = mock.rpc.mock.calls[0][1].p_plate;
    expect(mock.rpc.mock.contexts[0]).toBe(supabase);
    expect(Object.keys(payload).sort()).toEqual(["plate_index", "label", "units_per_plate", "material_id", "printer_id", "est_grams", "est_time_seconds", "est_cost_per_unit"].sort());
  });
  it("binds the selected execution to the lid plate, not just to its source or product", async () => {
    mount();
    const bindButtons = await screen.findAllByRole("button", { name: "Vincular impressão desta placa" });
    fireEvent.click(bindButtons[1]);
    await screen.findByRole("option", { name: /Tampa do produto.*#101/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Impressão Bambu da placa 2" }), { target: { value: "task-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo desta placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bind_product_print_plate", { p_plate_id: "plate-2", p_task_id: "task-1" }));
  });
});
