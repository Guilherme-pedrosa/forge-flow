import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";
import type { PricingPolicy } from "@/lib/pricing-policy";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), policy: {} as PricingPolicy, invalidPolicy: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" }, user: { id: "user" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/comercial/ModelFileInput", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductPrintSources", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductMaterialRecipe", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query, range: () => query, single: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "products" ? [product] : table === "printers" ? [{ id: "a1", name: "A1", model: "A1", power_watts: 150 }] : table === "tenants" ? { settings: {} } : [], error: null }).then(resolve) };
    return query;
  },
} }));
const product = { id: "legacy-product", tenant_id: "tenant", name: "Produto legado", category: "printed_part", is_active: true,
  cost_estimate: 12, manual_cost_override: null, sale_price: 18, prints_per_plate: 1, num_colors: 1, extras: [],
  catalog_details: { cost_source: "composition", price_source: "markup", markup_percent: 50, base_cost: 12, accessory_cost: 0, other_cost: 0 },
  stock_item_id: "stock", stock: { id: "stock", unit: "un", current_stock: 0, min_stock: 0, max_stock: 0, avg_cost: 12 } };
const policy: PricingPolicy = { revision: "company-r1", machine_rate_scope: "commercial_excludes_energy", machine_hour_cost: null, labor_cost_hour: 25, energy_cost_kwh: 1.14, target_margin: 50,
  handling_minutes_per_plate: 5, finishing_minutes_per_piece: null, assembly_minutes_per_product: null, extras_cost_per_product: null, overhead_percent: 3, printer_hour_costs: [{ printer_id: "a1", hour_cost: 2 }] };
const fields = ["Acabamento padrão por peça (min)", "Montagem por produto completo (min)", "Outros insumos padrão por produto (R$)"];
function LocationProof() { const location = useLocation(); return <output aria-label="Página atual">{location.pathname}{location.search}</output>; }
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/comercial/produtos"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /><LocationProof /></MemoryRouter></QueryClientProvider>); }
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const productSave = () => mock.rpc.mock.calls.find(([name]) => name === "save_product_with_photos")?.[1] as { p_product: Record<string, unknown> } | undefined;
beforeEach(() => {
  mock.policy = structuredClone(policy); mock.invalidPolicy = false; mock.toast.mockReset();
  mock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "pricing_settings") return { data: mock.invalidPolicy ? "old-test-response" : structuredClone(mock.policy), error: null };
    if (name === "save_pricing_settings") { mock.policy = { ...mock.policy, ...(args.p_settings as PricingPolicy), revision: "company-r2" }; return { data: "saved-company", error: null }; }
    if (name === "product_material_recipe_catalog") {
      const complete = mock.invalidPolicy || [mock.policy.finishing_minutes_per_piece, mock.policy.assembly_minutes_per_product, mock.policy.extras_cost_per_product].every(value => value != null);
      return { data: [{ id: product.id, configured: true, complete, cost_per_unit: complete ? 12.3456 : null, plate_count: 1, revision: `bom-${mock.policy.revision}`, missing: complete ? [] : ["Confirme acabamento, montagem e demais insumos."] }], error: null };
    }
    if (name === "save_product_with_photos") return { data: product.id, error: null };
    return { data: [], error: null };
  });
});
afterEach(cleanup);

describe("company cost confirmation inside a legacy product", () => {
  it("confirms the three unknown standards in Valores, refreshes cost and markup, and saves the current composition revision without leaving the form", async () => {
    let release!: () => void;
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "save_pricing_settings") await new Promise<void>(resolve => { release = resolve; });
      return original(name, args);
    });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Produto legado" }));
    const editor = await screen.findByRole("dialog", { name: "Editar Produto" });
    change("Nome *", "Produto legado atualizado"); fireEvent.click(within(editor).getByRole("tab", { name: "Valores" }));
    await screen.findByText("Confirme os custos que faltam");
    expect(screen.getAllByLabelText("Parâmetros de custo da empresa")).toHaveLength(1);
    expect(screen.queryByLabelText("Hora da máquina padrão (R$/h)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dados da impressão cadastrada")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Custo final")).toHaveTextContent("Pendente");
    for (const label of fields) fireEvent.click(screen.getByRole("button", { name: `Considerar zero: ${label}` }));
    expect(within(editor).getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "Cancelar" })).toBeDisabled());
    expect(within(editor).getByRole("tab", { name: "Dados" })).toBeDisabled();
    expect(screen.getByLabelText("Origem do custo")).toBeDisabled();
    await act(async () => { release(); });
    await screen.findByText(/Parâmetros salvos/);
    await waitFor(() => expect(screen.getByLabelText("Preço de custo (R$)")).toHaveValue("12.3456"));
    expect(screen.getByLabelText("Preço unitário (R$)")).toHaveValue("18.52");
    expect(screen.getByLabelText("Lucro sobre o custo (%)")).toHaveValue("50");
    expect(screen.getAllByLabelText("Parâmetros de custo da empresa")).toHaveLength(1);
    expect(screen.getByLabelText("Página atual")).toHaveTextContent(/^\/comercial\/produtos$/);
    expect(mock.rpc).toHaveBeenCalledWith("save_pricing_settings", expect.objectContaining({ p_expected_revision: "company-r1", p_settings: {
      machine_hour_cost: null, labor_cost_hour: 25, energy_cost_kwh: 1.14, target_margin: 50, handling_minutes_per_plate: 5,
      finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0, overhead_percent: 3, printer_hour_costs: [{ printer_id: "a1", hour_cost: 2 }],
    } }));
    expect(mock.rpc.mock.calls.filter(([name]) => name === "product_material_recipe_catalog").length).toBeGreaterThan(1);
    fireEvent.click(within(editor).getByRole("tab", { name: "Dados" }));
    expect(screen.getByLabelText("Nome *")).toHaveValue("Produto legado atualizado");
    fireEvent.click(within(editor).getByRole("tab", { name: "Valores" }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "Salvar" })).toBeEnabled());
    fireEvent.click(within(editor).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(productSave()).toBeDefined());
    expect(productSave()!.p_product).toMatchObject({ name: "Produto legado atualizado", cost_estimate: 12.3456, sale_price: 18.52,
      catalog_pricing: { cost_source: "composition", price_source: "markup", markup_percent: 50, expected_composition_revision: "bom-company-r2" } });
  }, 10000);

  it("ignores an old malformed settings stub without accessing missing policy fields or breaking an otherwise complete recipe", async () => {
    mock.invalidPolicy = true; mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Produto legado" }));
    fireEvent.click(screen.getByRole("tab", { name: "Valores" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("pricing_settings", {}));
    expect(screen.queryByLabelText("Parâmetros de custo da empresa")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preço de custo (R$)")).toHaveValue("12.3456");
    expect(screen.getByLabelText("Preço unitário (R$)")).toHaveValue("18.52");
  });
});
