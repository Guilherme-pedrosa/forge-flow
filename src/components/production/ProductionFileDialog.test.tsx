import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ProductionFileForm } from "./ProductionFileDialog";
import type { JobProductionReview } from "@/lib/production-files";
const { prepare, download } = vi.hoisted(() => ({ prepare: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/production-files", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/production-files")>(), prepareJobPrintFile: prepare, downloadJobPrintFile: download }));
const file = { id: "source", file_path: "tenant/path/file.3mf", file_name: "Arquivo_preservado.3mf", file_sha256: null };
const review: JobProductionReview = { job_id: "job", code: "OI-0001", status: "queued", product_id: "product", planned_quantity: 2, origin: "approved_order", captured_at: null, file, file_options: [file], plate: { id: "plate", plate_index: 1, label: "Tampa", units_per_plate: 2 }, printer: { id: "printer", name: "Bambina", model: "A1", status: "idle" }, requirements: [{ item_id: "red", name: "PLA exato", unit: "kg", material_code: "PLA", color: "Vermelho", color_code: "RED", required_grams: 40, current_stock_grams: 500, is_active: true }], issues: [], preparation_ready: true, dispatch_available: false, can_prepare: true, manual_accounting_supported: true, est_total_cost: 5.4, est_grams: 60, est_time_minutes: 120 };
const props = (data = review) => ({ review: data, printers: [review.printer!], tenantId: "tenant", onBusy: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn() });
function mount(data = review) { return render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ProductionFileForm {...props(data)} /></QueryClientProvider></MemoryRouter>); }
beforeEach(() => { prepare.mockReset(); download.mockReset(); vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("stable-request") }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("production file preparation", () => {
  it("shows approved file, exact material and honest manual handoff, without a fake Send action", () => {
    mount(); expect(screen.getByText("Receita preservada do pedido aprovado")).toBeInTheDocument();
    expect(screen.getByText("Arquivo_preservado.3mf", { selector: "p" })).toBeInTheDocument(); expect(screen.getByText(/PLA · Vermelho · RED/)).toBeInTheDocument();
    expect(screen.getByText(/ERP não possui envio direto configurado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar|Imprimir/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar arquivo privado" })).toBeInTheDocument();
  });
  it("an interrupted preparation preserves justification and request ID for retry", async () => {
    prepare.mockRejectedValueOnce(new Error("Resposta interrompida")).mockResolvedValue(undefined); mount();
    fireEvent.change(screen.getByLabelText("Justificativa da preparação"), { target: { value: "Arquivo conferido" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preparação" })); await screen.findByText("Resposta interrompida");
    expect(screen.getByLabelText("Justificativa da preparação")).toHaveValue("Arquivo conferido");
    fireEvent.click(screen.getByRole("button", { name: "Salvar preparação" })); await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(prepare.mock.calls[0][4]).toBe(prepare.mock.calls[1][4]);
    await screen.findByText("Preparação salva. Nenhum comando foi enviado à impressora.");
  });
  it("download errors remain visible and a missing file offers preparation rather than a broken download", async () => {
    download.mockRejectedValue(new Error("Arquivo difere da versão")); mount();
    fireEvent.click(screen.getByRole("button", { name: "Baixar arquivo privado" })); await screen.findByRole("alert"); expect(screen.getByText("Arquivo difere da versão")).toBeInTheDocument(); cleanup();
    mount({ ...review, file: null, file_options: [], manual_accounting_supported: false });
    expect(screen.queryByRole("button", { name: "Baixar arquivo privado" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar arquivo no produto" })).toHaveAttribute("href", "/comercial/produtos");
    expect(screen.getByText(/três ou mais materiais/)).toBeInTheDocument();
  });
});
