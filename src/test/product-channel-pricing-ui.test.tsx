import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import { modelPricingFromMakerWorld } from "@/lib/model-pricing";
import { createPricingSourceTransfer, discardPricingSourceTransfer } from "@/lib/pricing-source-transfer";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import type { CatalogChannelPricingDraft, ChannelAssumptions } from "@/lib/channel-policy";
import type { PricingInput, PricingTransfer } from "@/lib/print-pricing";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), conditions: {} as ChannelAssumptions }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" }, user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/public-description-translation", () => ({ translatePublicDescription: async (value: string) => value }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, label, options, onChange }: { value: string; label: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/ModelFileInput", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc, functions: { invoke: async () => ({ data: { projects: [] }, error: null }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, gt: () => query, in: () => query, order: () => query, range: () => query, single: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "tenants" ? { settings: {} } : table === "inventory_items" ? [filament] : table === "printers" ? [printer] : [], error: null }).then(resolve) };
    return query;
  },
} }));
const filament = { id: "red", name: "PLA vermelho", category: "filament", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000", freight_cost: 0, loss_coefficient: 0, is_active: true };
const printer = { id: "a1", name: "A1 da oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 1, maintenance_cost_per_hour: 1, is_active: true };
const assumptions: ChannelAssumptions = { commission_percent: 10, tax_percent: 5, fixed_fee_per_order: 4, fixed_fee_per_item: 0, seller_shipping_per_order: 12, advertising_per_order: 2, other_cost_per_order: 0, target_margin: 20 };
const channelDraft: CatalogChannelPricingDraft = { channel: "mercado_livre", assumptions, quantity: 3, expected_policy_revision: "channel-r1", quoted_unit_cost: 10, unit_price: 30 };
const accepted: PricingTransfer = { name: "Produto preparado", cost: 10, price: 20, quotePrice: 30, quantity: 3, quote: true };
const input: PricingInput = { quantity: 2, hours: 2, watts: 100, kwh: 1, machineHour: 2, laborMinutes: 0, laborHour: 20, overhead: 0, failure: 0, margin: 50, target: 20,
  materials: [{ name: "PLA", grams: 100, kgPrice: 80 }], extras: [{ name: "Embalagem já incluída", cost: 3.9, basis: "unit" }] };
function maker() {
  const value = normalizeMakerWorldDesign({ id: 456, title: "Produto preparado", description: "Peça decorativa", instances: [{ id: 101, profileId: 501, title: "A1 PLA", extention: { modelInfo: {
    compatibility: { devProductName: "A1", nozzleDiameter: 0.4 }, plates: [{ index: 1, weight: 100, prediction: 7200, name: "Produtos", objects: [{ id: 1, name: "Corpo", quantity: 2 }], filaments: [{ id: "1", type: "PLA", color: "#FF0000", usedG: 100 }] }],
  } } }] });
  return { ...value, provider: "makerworld", source_url: "https://makerworld.com/models/456", selected_profile_id: "101", selected_instance_id: "101", selected_variant_profile_id: "501" } as ProductExternalImport;
}
function LocationProof() { const location = useLocation(); return <output aria-label="Destino do orçamento">{JSON.stringify(location.state)}</output>; }
function mount(pricing?: PricingTransfer & { sourceToken?: string; sourceRequired?: boolean; channelPricing?: CatalogChannelPricingDraft }) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={[{ pathname: "/comercial/produtos", state: pricing ? { pricing } : null }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /><LocationProof /></MemoryRouter>
  </QueryClientProvider>);
}
const saved = () => mock.rpc.mock.calls.find(([name]) => name === "save_product_with_photos")?.[1] as { p_product: Record<string, unknown> } | undefined;
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
async function manualProduct() {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Novo Produto" }));
  await screen.findByRole("dialog", { name: "Novo Produto" });
  change("Nome *", "Produto manual"); change("Preço de custo (R$)", "10"); change("Preço unitário (R$)", "20");
  change("Canal de venda", "mercado_livre");
  await waitFor(() => expect(screen.getByLabelText("Comissão sobre produtos (%)")).toHaveValue("10"));
  change("Unidades por pedido / pacote", "3"); change("Preço escolhido neste canal (R$)", "30");
}
beforeEach(() => {
  discardPricingSourceTransfer(); mock.conditions = { ...assumptions }; mock.toast.mockReset();
  mock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "channel_pricing_policy") return { data: { channel: args.p_channel, configured: true, revision: "channel-r1", assumptions: mock.conditions }, error: null };
    if (name === "save_product_with_photos") return { data: "saved-product", error: null };
    if (name === "pricing_settings") return { data: { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50, handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0, printer_hour_costs: [], revision: "company-r1" }, error: null };
    return { data: [], error: null };
  });
});
afterEach(() => { cleanup(); discardPricingSourceTransfer(); });

describe("product catalogue channel pricing", () => {
  it("saves a separate stamped channel price atomically with the product and keeps the global base price unchanged", async () => {
    await manualProduct();
    await waitFor(() => expect(screen.getByTestId("channel-pricing-result")).toHaveTextContent("28,50"));
    expect(screen.getByLabelText("Preço unitário (R$)")).toHaveValue("20");
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ name: "Produto manual", manual_cost: 10, cost_estimate: 10, sale_price: 20, channel_pricing: [channelDraft], catalog_pricing: { cost_source: "manual", price_source: "manual" } });
    expect(mock.rpc.mock.calls.some(([name]) => name === "apply_product_pricing" || name === "apply_product_channel_pricing" || name === "save_channel_pricing_policy")).toBe(false);
  });

  it("blocks a selected channel with an unknown fee instead of saving that fee as zero", async () => {
    mock.conditions.tax_percent = null;
    await manualProduct();
    await screen.findByText("Confirme Tributo sobre produtos (%), inclusive zero quando não houver esse custo.");
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(saved()).toBeUndefined();
    change("Tributo sobre produtos (%)", "0"); await screen.findByTestId("channel-pricing-result");
    fireEvent.click(screen.getByRole("button", { name: "Criar" })); await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ sale_price: 20, channel_pricing: [{ assumptions: { tax_percent: 0 } }] });
  });

  it("receives the prepared source and its channel quote while keeping source yield, order quantity and base sale price distinct", async () => {
    const externalImport = maker(), estimate = modelPricingFromMakerWorld(externalImport);
    // 12.20 native manufacturing + 2×3.90 supplies =20 per profile, or10 per product.
    const token = await createPricingSourceTransfer({ tenantId: "tenant-1", userId: "user-1" }, { sourceFile: null, externalImport, estimate, accepted,
      pricingInput: input, calculated: { printerId: "a1", quantity: 2, materialSelections: { [estimate.materials[0].key]: "red" } }, channelPricing: channelDraft });
    mount({ ...accepted, sourceToken: token, sourceRequired: true });
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    await within(editor).findByText("Impressão e valores preservados");
    await within(editor).findByTestId("channel-pricing-result");
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("10");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("20");
    expect(within(editor).getByLabelText("Preço escolhido neste canal (R$)")).toHaveValue("30");
    expect(within(editor).getByLabelText("Unidades por pedido / pacote")).toHaveValue(3);
    fireEvent.click(within(editor).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 10, sale_price: 20, extras: [], channel_pricing: [channelDraft],
      import_pricing: { quantity: 2, printer_id: "a1", plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "red", grams: 100 }] }] }, external_import: { selected_variant_profile_id: "501" } });
    await waitFor(() => expect(screen.getByLabelText("Destino do orçamento")).toHaveTextContent('"pricingQuote":{"product_id":"saved-product","quantity":3,"unit_price":30}'));
  });
  it.each(["channel", "factory"])("quotes the operator's current %s price instead of the old transferred channel price", async mode => {
    const externalImport = maker(), estimate = modelPricingFromMakerWorld(externalImport);
    const token = await createPricingSourceTransfer({ tenantId: "tenant-1", userId: "user-1" }, { sourceFile: null, externalImport, estimate, accepted,
      pricingInput: input, calculated: { printerId: "a1", quantity: 2, materialSelections: { [estimate.materials[0].key]: "red" } }, channelPricing: channelDraft });
    mount({ ...accepted, sourceToken: token, sourceRequired: true });
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" }); await within(editor).findByTestId("channel-pricing-result");
    if (mode === "channel") { change("Preço escolhido neste canal (R$)", "40"); change("Unidades por pedido / pacote", "2"); }
    else { change("Canal de venda", "factory"); change("Preço unitário (R$)", "25"); }
    fireEvent.click(within(editor).getByRole("button", { name: "Criar" })); await waitFor(() => expect(saved()).toBeDefined());
    const quotePrice = mode === "channel" ? 40 : 25, quantity = mode === "channel" ? 2 : 3;
    await waitFor(() => expect(screen.getByLabelText("Destino do orçamento")).toHaveTextContent(`"pricingQuote":{"product_id":"saved-product","quantity":${quantity},"unit_price":${quotePrice}}`));
    expect(saved()!.p_product.sale_price).toBe(mode === "channel" ? 20 : 25);
  });
});
