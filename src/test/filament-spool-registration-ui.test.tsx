import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilamentSpoolRegistration } from "@/components/estoque/FilamentSpoolRegistration";
import { existingCostPerKg, newSpoolDraft, readSpoolRegistrationResult, spoolNetGrams, spoolRegistrationPayload } from "@/lib/filament-spool-registration";
import type { FilamentMaterial } from "@/lib/filament-planning";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), saved: vi.fn(), close: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
// Search and keyboard interaction are verified by the shared picker suite.
// Here the assertions cover the single-write contract and retry identity.
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label, disabled }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; label: string; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecione</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
const spoolId = "81000000-0000-4000-8000-000000000001";
const itemId = "81000000-0000-4000-8000-000000000002";
const item: FilamentMaterial = { id: itemId, name: "PLA Framboesa F3D", unit: "g", current_stock: 1200, avg_cost: .1, min_stock: 0, vendor_id: null, material_code: "PLA", color: "Framboesa", color_code: "FRAMBOESA" };
const receipt = (changes: Record<string, unknown> = {}) => ({ spool_id: spoolId, item_id: itemId, item_created: true, net_grams: 900, stock_mode: "add_to_stock", stock_before: 0, stock_after: 900, stock_unit: "g", ...changes });
const clients: QueryClient[] = [];
function show(items: FilamentMaterial[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><FilamentSpoolRegistration items={items} printers={[]} onClose={mock.close} onSaved={mock.saved} /></QueryClientProvider>);
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
function newMaterial() { fill("Material", "PLA"); fill("Marca (opcional)", "F3D"); fill("Cor do filamento", "Framboesa"); }
function submit() { fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento e bobina" })); }
beforeEach(() => { mock.rpc.mockReset().mockResolvedValue({ data: receipt(), error: null }); mock.saved.mockReset(); mock.close.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("Cadastro único de filamento, bobina e saldo", () => {
  it("creates from an empty catalogue in exactly one RPC without a separate material or opening-stock write", async () => {
    show(); newMaterial(); fill("Filamento restante (g)", "900"); fill("Custo do filamento (R$/kg)", "100,00"); submit();
    await waitFor(() => expect(mock.saved).toHaveBeenCalledExactlyOnceWith(receipt()));
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith("register_filament_spool", expect.objectContaining({ p_item_id: null, p_material: expect.objectContaining({ material_code: "PLA", color: "Framboesa", brand: "F3D", color_code: null }), p_stock_mode: "add_to_stock", p_cost_per_kg: 100, p_spool: expect.objectContaining({ label: "", estimated_remaining_grams: 900, initial_net_grams: 1000, location_kind: "storage", location_label: "Prateleira", reason: "Cadastro de bobina" }) }));
    expect(mock.rpc.mock.calls[0][1].p_material).not.toHaveProperty("current_stock");
  });

  it("subtracts the tare and displays900g instead of posting the original1000g capacity", async () => {
    show(); newMaterial(); fireEvent.click(screen.getByRole("checkbox", { name: "Pesar com carretel" })); fill("Peso bruto da balança (g)", "1100"); fill("Tara do carretel vazio (g)", "200"); fill("Custo do filamento (R$/kg)", "80");
    expect(screen.getByRole("status")).toHaveTextContent("900 g"); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("register_filament_spool", expect.objectContaining({ p_spool: expect.objectContaining({ measured_gross_grams: 1100, tare_grams: 200, estimated_remaining_grams: null, weight_source: "manual_weighing", initial_net_grams: 1000 }) })));
  });

  it("registers an already-counted spool without requiring cost or creating an extra stock entry", async () => {
    mock.rpc.mockResolvedValue({ data: receipt({ item_created: false, stock_mode: "already_in_stock", stock_before: 1200, stock_after: 1200 }), error: null });
    show([item]); fill("Filamento cadastrado", itemId); fill("Filamento restante (g)", "900");
    expect(screen.queryByLabelText("Custo do filamento (R$/kg)")).not.toBeInTheDocument();
    expect(screen.getByText(/O saldo do filamento será mantido/)).toBeInTheDocument(); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("register_filament_spool", expect.objectContaining({ p_item_id: itemId, p_material: null, p_stock_mode: "already_in_stock", p_cost_per_kg: null })));
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it("only adds to existing stock after explicit selection and converts the saved cost to R$/kg", async () => {
    show([item]); fill("Filamento cadastrado", itemId); fill("Filamento restante (g)", "900"); fireEvent.click(screen.getByRole("checkbox", { name: /Somar esta bobina ao estoque/ }));
    expect(screen.getByLabelText("Custo do filamento (R$/kg)")).toHaveValue("100"); expect(screen.getByText("1.200 g → 2.100 g")).toBeInTheDocument(); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("register_filament_spool", expect.objectContaining({ p_stock_mode: "add_to_stock", p_cost_per_kg: 100 })));
  });

  it("requires an explicit cost when entering stock but accepts a deliberate zero", async () => {
    show(); newMaterial(); fill("Filamento restante (g)", "900"); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o custo do filamento em R$/kg. Se não houve custo, informe 0."); expect(mock.rpc).not.toHaveBeenCalled();
    fill("Custo do filamento (R$/kg)", "0"); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("register_filament_spool", expect.objectContaining({ p_cost_per_kg: 0 })));
  });

  it("preserves the draft after a lost response and retries the same atomic request", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("A conexão caiu")).mockResolvedValue({ data: receipt(), error: null });
    show(); newMaterial(); fill("Filamento restante (g)", "900"); fill("Custo do filamento (R$/kg)", "100"); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("A conexão caiu"); expect(screen.getByLabelText("Cor do filamento")).toHaveValue("Framboesa"); expect(mock.saved).not.toHaveBeenCalled(); submit();
    await waitFor(() => expect(mock.saved).toHaveBeenCalledTimes(1)); expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]);
  });

  it("does not claim success for an incomplete response and retains its retry key", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { spool_id: spoolId }, error: null }).mockResolvedValue({ data: receipt(), error: null });
    show(); newMaterial(); fill("Filamento restante (g)", "900"); fill("Custo do filamento (R$/kg)", "100"); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("O servidor não confirmou o cadastro completo"); expect(mock.saved).not.toHaveBeenCalled(); submit();
    await waitFor(() => expect(mock.saved).toHaveBeenCalledTimes(1)); expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]);
  });

  it("starts a fresh request after changing a failed draft and never separately saves its material", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "Código indisponível" } }); show(); newMaterial(); fill("Filamento restante (g)", "900"); fill("Custo do filamento (R$/kg)", "100"); submit(); await screen.findByRole("alert");
    fill("Cor do filamento", "Rosa"); submit(); await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    expect(mock.rpc.mock.calls[0][1].p_request_id).not.toBe(mock.rpc.mock.calls[1][1].p_request_id);
    expect(mock.rpc.mock.calls.every(([name]) => name === "register_filament_spool")).toBe(true);
  });

  it("blocks another submission and draft edits while the atomic save is pending", async () => {
    let finish!: (value: { data: ReturnType<typeof receipt>; error: null }) => void;
    mock.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    show(); newMaterial(); fill("Filamento restante (g)", "900"); fill("Custo do filamento (R$/kg)", "100"); submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled());
    expect(screen.getByLabelText("Cor do filamento")).toBeDisabled();
    fireEvent.submit(document.getElementById("register-filament-spool")!);
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.saved).not.toHaveBeenCalled();
    await act(async () => { finish({ data: receipt(), error: null }); });
    await waitFor(() => expect(mock.saved).toHaveBeenCalledTimes(1));
  });
});

describe("Payload e recebimento da bobina", () => {
  it("converts g and kg costs without turning a missing or zero historical cost into a confirmed free cost", () => {
    expect(existingCostPerKg(item)).toBe("100"); expect(existingCostPerKg({ unit: "kg", avg_cost: 92.5 })).toBe("92.5"); expect(existingCostPerKg({ unit: "g", avg_cost: 0 })).toBe(""); expect(existingCostPerKg({ unit: "g" })).toBe("");
  });
  it("rejects negative remaining weight, gross below tare and a remaining weight greater than initial capacity", () => {
    const draft = { ...newSpoolDraft(false), materialCode: "PLA", color: { name: "Framboesa", code: "", hex: "" }, costPerKg: "0", remaining: "-1" };
    expect(() => spoolRegistrationPayload(draft, [], [])).toThrow(/filamento restante/);
    expect(() => spoolNetGrams({ ...draft, weighed: true, gross: "100", tare: "200" })).toThrow(/menor que a tara/);
    expect(() => spoolRegistrationPayload({ ...draft, remaining: "1001" }, [], [])).toThrow(/capacidade inicial/);
    expect(() => readSpoolRegistrationResult("saved")).toThrow(/não confirmou/);
  });
});
