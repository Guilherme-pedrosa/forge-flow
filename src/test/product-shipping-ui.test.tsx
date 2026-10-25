import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), existing: false }));
const savedPackage = { length_cm: 20, width_cm: 15, height_cm: 8, weight_grams: 350 };
const product = { id: "product", tenant_id: "tenant", name: "Maçã embalada", category: "printed_part", is_active: true, cost_estimate: null, sale_price: 25, prints_per_plate: 1, num_colors: 1, extras: [], shipping_package: savedPackage };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, single: () => query, is: () => query, in: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "products" && mock.existing ? [product] : table === "tenants" ? { settings: {} } : [], error: null }).then(resolve) };
  return query;
} } }));
vi.mock("@/pages/comercial/ProductPrintSources", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductMaterialRecipe", () => ({ default: () => null }));
beforeEach(() => {
  mock.existing = false; mock.rpc.mockReset(); mock.toast.mockReset();
  mock.rpc.mockImplementation(async (name: string) => ({ data: name === "product_material_recipe_catalog" ? [] : "saved", error: null }));
});
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /></MemoryRouter></QueryClientProvider>);
const fields = ["Comprimento da embalagem (cm)", "Largura da embalagem (cm)", "Altura da embalagem (cm)", "Peso total embalado (g)"];

describe("cadastro de embalagem para envio", () => {
  it("salva dimensões externas e peso bruto junto com um novo produto", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Novo Produto" }));
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Maçã com caixa" } });
    fireEvent.click(screen.getByRole("tab", { name: "Embalagem para envio" }));
    fields.forEach((label, index) => fireEvent.change(screen.getByLabelText(label), { target: { value: ["20,5", "15", "8", "350"][index] } }));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_with_photos", expect.objectContaining({ p_product: expect.objectContaining({ name: "Maçã com caixa", shipping_package: { length_cm: 20.5, width_cm: 15, height_cm: 8, weight_grams: 350 }, est_grams: 0 }) })));
  });
  it("carrega embalagem salva e permite limpar ou salvar um rascunho parcial", async () => {
    mock.existing = true; mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Maçã embalada" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Embalagem para envio" }));
    fields.forEach((label, index) => expect(within(dialog).getByLabelText(label)).toHaveValue(["20", "15", "8", "350"][index]));
    fields.slice(1).forEach(label => fireEvent.change(within(dialog).getByLabelText(label), { target: { value: "" } }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_with_photos", expect.objectContaining({ p_product_id: "product", p_product: expect.objectContaining({ shipping_package: { length_cm: 20, width_cm: null, height_cm: null, weight_grams: null } }) })));
  });
  it("não envia medida inválida nem herda a embalagem ao abrir outro cadastro", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Novo Produto" }));
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Peça" } });
    fireEvent.click(screen.getByRole("tab", { name: "Embalagem para envio" }));
    fireEvent.change(screen.getByLabelText(fields[0]), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/Comprimento da embalagem/) })));
    expect(mock.rpc.mock.calls.some(call => call[0] === "save_product_with_photos")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo Produto" }));
    fireEvent.click(screen.getByRole("tab", { name: "Embalagem para envio" }));
    fields.forEach(label => expect(screen.getByLabelText(label)).toHaveValue(""));
  });
});
