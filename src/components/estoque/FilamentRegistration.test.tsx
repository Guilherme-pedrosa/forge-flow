import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilamentRegistration, type FilamentRegistrationProps } from "./FilamentRegistration";
import type { FilamentRegistrationItem } from "@/lib/filament-registration";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), saved: vi.fn(), close: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const item: FilamentRegistrationItem = { id: "83000000-0000-4000-8000-000000000001", name: "PLA Branco F3D", unit: "g", current_stock: 2500, avg_cost: .08,
  material_code: "PLA", material_type: "PLA", color: "Branco", color_code: "WHITE", brand: "F3D", diameter: 1.75 };
const clients: QueryClient[] = [];
function show(props: Partial<FilamentRegistrationProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><FilamentRegistration onClose={mock.close} onSaved={mock.saved} {...props} /></QueryClientProvider>);
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento" }));
beforeEach(() => { mock.rpc.mockReset().mockResolvedValue({ data: item.id, error: null }); mock.saved.mockReset(); mock.close.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("stock-first filament registration", () => {
  it("keeps the explicit purchase name while requiring the filament color and starting with zero stock", async () => {
    show({ initialName: "PLA branco para luminárias" });
    expect(screen.getByText("Nome no cadastro:")).toHaveTextContent("PLA branco para luminárias");
    fill("Cor *", "Branco");submit();
    await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog",expect.objectContaining({p_item:expect.objectContaining({name:"PLA branco para luminárias",color:"Branco",current_stock:0,avg_cost:0})})));
  });
  it("uses an exact source palette color but asks for the name of an unknown source hex", async () => {
    show({ defaults: { material_code: "PETG" }, initialColor: { hex: "#FCECD6" } });
    expect(screen.getByLabelText("Material")).toHaveValue("PETG");
    expect(screen.getByLabelText("Cor *")).toHaveValue("");
    expect(screen.getByText(/Cor do arquivo:/)).toHaveTextContent("#FCECD6");
    submit(); expect(await screen.findByRole("alert")).toHaveTextContent("Informe a cor do filamento"); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("prefills only an exact known palette color without changing add-another-color defaults", async () => {
    show({ initialColor: { hex: "#FFFFFFFF" } });
    expect(screen.getByLabelText("Cor *")).toHaveValue("Branco"); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({ p_item: expect.objectContaining({ color: "Branco", color_code: "WHITE", color_hex: "#FFFFFF", current_stock: 0 }) })));
  });
  it("creates a zero-balance filament with material and color only, without capacity or spool questions", async () => {
    show();
    expect(screen.getByLabelText("Material")).toHaveValue("PLA");
    expect(screen.getByLabelText("Estoque inicial (kg)")).toHaveValue("0");
    expect(screen.queryByText(/capacidade|tara|bobina|impressora/i)).not.toBeInTheDocument();
    expect(screen.getByText("Compras recebidas atualizam saldo e custo médio automaticamente.")).toBeVisible();
    fill("Cor *", "Framboesa"); submit();
    await waitFor(() => expect(mock.saved).toHaveBeenCalledExactlyOnceWith(item.id));
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_inventory_catalog", expect.objectContaining({ p_item_id: null, p_item: expect.objectContaining({ name: "PLA Framboesa", color_code: "FRAMBOESA", current_stock: 0, avg_cost: 0, unit: "g" }), p_request_id: expect.any(String) }));
  });
  it("accepts kilograms of stock and a per-kilo price without a physical spool limit", async () => {
    show(); fill("Cor *", "Branco"); fill("Marca (opcional)", "F3D"); fill("Estoque inicial (kg)", "5,5"); fill("Custo médio (R$/kg)", "80"); submit();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({ p_item: expect.objectContaining({ current_stock: 5500, avg_cost: .08, brand: "F3D", unit: "g" }) })));
  });
  it("edits metadata without resubmitting the average cost or stock, keeping the saved unit immutable", async () => {
    show({ item });
    expect(screen.getByLabelText("Custo médio (R$/kg)")).toHaveValue("80");
    expect(screen.queryByLabelText("Unidade da quantidade informada")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Outros detalhes (opcional)", { selector: "summary" }));
    fill("SKU / código interno", "PLA-WHITE"); fireEvent.click(screen.getByRole("button", { name: "Salvar filamento" }));
    await waitFor(() => expect(mock.saved).toHaveBeenCalledWith(item.id));
    const data = mock.rpc.mock.calls[0][1].p_item;
    expect(data).toMatchObject({ sku: "PLA-WHITE", color_code: "WHITE", unit: "g" });
    expect(data).not.toHaveProperty("avg_cost"); expect(data).not.toHaveProperty("current_stock");
  });
  it("protects a manual stock edit with expected_stock and submits through Enter", async () => {
    show({ item }); fill("Estoque atual (g)", "3000");
    fireEvent.submit(screen.getByRole("button", { name: "Salvar filamento" }).closest("div[role=dialog]")!.querySelector("form")!);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({ p_item_id: item.id, p_item: expect.objectContaining({ current_stock: 3000, expected_stock: 2500 }) })));
  });
  it("retains the draft and request id after a lost response and verifies the returned id", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("A conexão caiu")).mockResolvedValueOnce({ data: "incomplete", error: null }).mockResolvedValue({ data: item.id, error: null });
    show(); fill("Cor *", "Azul"); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("A conexão caiu");
    expect(screen.getByLabelText("Cor *")).toHaveValue("Azul"); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("O servidor não confirmou"); expect(mock.saved).not.toHaveBeenCalled(); submit();
    await waitFor(() => expect(mock.saved).toHaveBeenCalledTimes(1));
    expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]); expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[2]);
  });
  it("blocks closing, editing and duplicate Enter while saving, then permits retry after failure", async () => {
    let finish!: (result: { data: null; error: { message: string } }) => void;
    mock.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    show(); fill("Cor *", "Verde"); submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled());
    expect(screen.getByLabelText("Cor *")).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "Cancelar" }); expect(cancel).toBeDisabled(); fireEvent.click(cancel);
    fireEvent.submit(screen.getByLabelText("Cor *").closest("form")!); expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.close).not.toHaveBeenCalled();
    await act(async () => finish({ data: null, error: { message: "Tente novamente" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tente novamente");
    expect(cancel).toBeEnabled(); expect(screen.getByLabelText("Cor *")).toBeEnabled();
  });
});
