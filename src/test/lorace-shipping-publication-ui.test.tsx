import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Lorace from "@/pages/integracoes/Lorace";
import { buildCommercialProductDescription } from "@/lib/commercial-product-description";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), toast: vi.fn(), filters: [] as [string, unknown][],
  events: [] as string[], packaging: null as unknown, published: false,
  description: "", category: "printed_part", presentation: null as unknown,
  pendingUpdate: null as Promise<unknown>|null,
  updateError: null as { message: string } | null, savedId: "product-1" as string | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/marketplace/LoracePayments", () => ({ LoracePayments: () => null }));
vi.mock("@/components/marketplace/LoraceShipping", () => ({ LoraceShipping: () => null }));
vi.mock("@/lib/marketplace-orders", () => ({ marketplaceRpc: mock.rpc, marketplaceDb: { from: (table: string) => {
  let updating = false;
  const query = {
    select: () => query, order: () => query, range: () => query, limit: () => query, maybeSingle: () => query,
    eq: (field: string, value: unknown) => { if (updating) mock.filters.push([field, value]); return query; },
    update: (value: unknown) => { updating = true; mock.update(value); mock.events.push("package"); return query; },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const data = updating ? mock.savedId ? { id: mock.savedId } : null
        : table === "products" ? [{ id: "product-1", name: "Caneca", sku: "CAN-1", photo_url: "https://example.test/caneca.jpg", sale_price: 25, is_active: true, shipping_package: mock.packaging, description: mock.description, category: mock.category, commercial_presentation: mock.presentation, updated_at: "2026-11-02T12:00:00Z" }]
        : table === "storefront_channels" ? { id: "channel-1", slug: "lorace", name: "Elevare3D", enabled: true }
        : table === "storefront_listings" ? mock.published ? [{ product_id: "product-1", published: true, category: "canecas", price_override: null, made_to_order: false, lead_days: 7, updated_at: "2026-11-02T12:01:00Z" }] : [] : [];
      return (updating && mock.pendingUpdate ? mock.pendingUpdate : Promise.resolve({ data, error: updating ? mock.updateError : null })).then(resolve, reject);
    },
  };
  return query;
} } }));
const complete = { length_cm: 20.5, width_cm: 15, height_cm: 8, weight_grams: 350 };
const fields = ["Comprimento da embalagem (cm)", "Largura da embalagem (cm)", "Altura da embalagem (cm)", "Peso total embalado (g)"];
beforeEach(() => {
  mock.rpc.mockReset(); mock.update.mockReset(); mock.toast.mockReset(); mock.filters.length = 0; mock.events.length = 0;
  mock.packaging = null; mock.published = false; mock.updateError = null; mock.savedId = "product-1";
  mock.description = ""; mock.category = "printed_part"; mock.presentation = null; mock.pendingUpdate = null;
  mock.rpc.mockImplementation(async (name: string) => {
    if (name === "storefront_site") return { content: { categories: [{ slug: "canecas", name: "Canecas", enabled: true }] } };
    if (name === "save_storefront_product_details") { mock.events.push("atomic"); if(mock.updateError) throw new Error(mock.updateError.message); if(mock.pendingUpdate)return mock.pendingUpdate; return mock.savedId ? { saved: true, listing_id: "listing-1", product_updated_at: "2026-11-02T12:02:00Z", listing_updated_at: "2026-11-02T12:02:00Z", replayed: false } : null; }
    return null;
  });
});
afterEach(cleanup);
async function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Lorace /></MemoryRouter></QueryClientProvider>);
  return screen.findByRole("form", { name: "Publicação de Caneca" });
}
async function preparePublication() {
  const card = await mount();
  await waitFor(() => expect(within(card).getByLabelText("Categoria na loja")).toBeEnabled());
  fireEvent.change(within(card).getByLabelText("Categoria na loja"), { target: { value: "canecas" } });
  fireEvent.click(within(card).getByLabelText("Exibir este produto na Elevare3D"));
  return card;
}
function fillPackage(card: HTMLElement) {
  fields.forEach((label, index) => fireEvent.change(within(card).getByLabelText(label), { target: { value: ["20,5", "15", "8", "350"][index] } }));
}
const publicationCalls = () => mock.rpc.mock.calls.filter(([name]) => name === "save_storefront_product_details");

describe("packaging at storefront publication", () => {
  it("asks for missing packaging and saves product changes and listing atomically", async () => {
    const card = await preparePublication();
    const save = within(card).getByRole("button", { name: "Salvar publicação" });
    expect(save).toBeDisabled();
    expect(within(card).getByText(/Complete comprimento, largura, altura e peso total embalado/)).toBeVisible();
    fields.forEach(label => expect(within(card).getByLabelText(label)).toBeVisible());
    fillPackage(card);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    expect(publicationCalls()[0][1]).toMatchObject({ p_product_changes: { shipping_package: complete }, p_expected_product_updated_at: "2026-11-02T12:00:00Z", p_expected_listing_updated_at: null });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.events).toEqual(["atomic"]);
    expect(publicationCalls()[0][1]).toMatchObject({ p_product_id: "product-1", p_settings: { published: true, category: "canecas" } });
  });

  it("reuses complete stored packaging without an unnecessary product update", async () => {
    mock.packaging = complete; mock.published = true;
    const card = await mount();
    fields.forEach((label, index) => expect(within(card).getByLabelText(label)).toHaveValue(["20.5", "15", "8", "350"][index]));
    expect(within(card).getByText(/Embalagem para envio · medidas preenchidas/).parentElement).not.toHaveAttribute("open");
    const save = within(card).getByRole("button", { name: "Salvar publicação" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each(["denied", "unconfirmed"])("does not publish when saving packaging is %s", async mode => {
    mock.updateError = mode === "denied" ? { message: "Sem permissão para salvar embalagem" } : null;
    mock.savedId = mode === "unconfirmed" ? null : "product-1";
    const card = await preparePublication(); fillPackage(card);
    fireEvent.click(within(card).getByRole("button", { name: "Salvar publicação" }));
    await waitFor(() => expect(within(card).getByRole("alert")).toHaveTextContent(mode === "denied" ? "Sem permissão" : "não foi confirmado"));
    expect(mock.update).not.toHaveBeenCalled();
    expect(publicationCalls()).toHaveLength(1);
    expect(within(card).getByLabelText("Peso total embalado (g)")).toHaveValue("350");
  });

  it("rejects invalid values with the same packaging rules as the product editor", async () => {
    const card = await preparePublication(); fillPackage(card);
    fireEvent.change(within(card).getByLabelText(fields[0]), { target: { value: "0" } });
    expect(within(card).getByRole("button", { name: "Salvar publicação" })).toBeDisabled();
    expect(within(card).getByText(/Comprimento da embalagem.*maior que zero/)).toBeVisible();
    expect(mock.update).not.toHaveBeenCalled(); expect(publicationCalls()).toHaveLength(0);
  });

  it("links directly to this product's shipping tab instead of leaving the seller at the catalog", async () => {
    const card = await mount();
    expect(within(card).getByRole("link", { name: "Editar embalagem no cadastro" })).toHaveAttribute("href", "/comercial/produtos?produto=product-1&editar=1&aba=embalagem");
    expect(within(card).getByRole("link", { name: "Editar produto e fotos" })).toHaveAttribute("href", "/comercial/produtos?produto=product-1&editar=1");
  });

  it("saves three piece dimensions in millimetres independently of four package fields and preserves a manual description", async () => {
    mock.description = "Caneca decorativa com acabamento revisado pela equipe Elevare.";
    const card = await preparePublication();
    fireEvent.click(within(card).getByText("Descrição e medidas da peça"));
    const pieceFields = ["Comprimento da peça (cm)", "Largura da peça (cm)", "Altura da peça (cm)"];
    pieceFields.forEach((label, index) => fireEvent.change(within(card).getByLabelText(label), { target: { value: ["10,5", "7,25", "12"][index] } }));
    expect(within(card).getByLabelText("Descrição comercial de Caneca")).toHaveValue(mock.description);
    expect(within(card).getByRole("button", { name: "Salvar publicação" })).toBeDisabled();
    fillPackage(card);
    fireEvent.click(within(card).getByRole("button", { name: "Salvar publicação" }));
    await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    expect(publicationCalls()[0][1].p_product_changes).toEqual({ shipping_package: complete, commercial_presentation: {
      dimensions: { length_mm: 105, width_mm: 72.5, height_mm: 120 }, description_generation: null,
    } });
    expect(publicationCalls()[0][1].p_product_changes).not.toHaveProperty("description");
    expect(mock.events).toEqual(["atomic"]);
  });

  it("refreshes only generated measurement text while preserving confirmed material, colors and provenance", async () => {
    const generated = buildCommercialProductDescription({ title: "Caneca", category: "printed_part", material: { confirmed: true, name: "PLA" },
      colors: { confirmed: true, count: 3, names: ["White", "Green", "Red"] }, dimensions: { confirmed: true, lengthMm: 100, widthMm: 80, heightMm: 150 },
      source: { provider: "makerworld", source_id: "744793" } });
    mock.description = generated.text; mock.presentation = { dimensions: { length_mm: 100, width_mm: 80, height_mm: 150 }, description_generation: generated.generation };
    mock.packaging = complete; mock.published = true;
    const card = await mount(); fireEvent.click(within(card).getByText("Descrição e medidas da peça"));
    fireEvent.change(within(card).getByLabelText("Altura da peça (cm)"), { target: { value: "18" } });
    const expected = "Caneca. Peça produzida por impressão 3D em PLA. Produção em 3 cores (Branco, Verde, Vermelho). Medidas da peça: comprimento 10 cm; largura 8 cm; altura 18 cm.";
    expect(within(card).getByLabelText("Descrição comercial de Caneca")).toHaveValue(expected);
    await waitFor(() => expect(within(card).getByRole("button", { name: "Salvar publicação" })).toBeEnabled());
    fireEvent.click(within(card).getByRole("button", { name: "Salvar publicação" })); await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    const saved = publicationCalls()[0][1].p_product_changes;
    expect(saved).toMatchObject({ description: expected, commercial_presentation: { dimensions: { length_mm: 100, width_mm: 80, height_mm: 180 }, description_generation: { generated_text: expected } } });
    expect(JSON.parse(saved.commercial_presentation.description_generation.input_signature)).toMatchObject({ production: "Peça produzida por impressão 3D em PLA.", colors: "Produção em 3 cores (Branco, Verde, Vermelho).", source_provider: "makerworld", source_id: "744793" });
    expect(saved).not.toHaveProperty("shipping_package");
  });

  it("rewrites promotional source prose only on request and persists canonical commercial copy before publishing", async () => {
    mock.description = "Boost me! Me impulsione. Gasta menos filamento e imprime sem suportes.";
    mock.packaging = complete; mock.published = true;
    mock.presentation = { dimensions: { length_mm: null, width_mm: null, height_mm: 120 }, description_generation: null };
    const card = await mount(); fireEvent.click(within(card).getByText("Descrição e medidas da peça"));
    expect(within(card).getByLabelText("Descrição comercial de Caneca")).toHaveValue(mock.description); expect(mock.update).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Reescrever descrição para a loja" }));
    const expected = "Caneca. Peça produzida por impressão 3D. Medidas da peça: altura 12 cm.";
    expect(within(card).getByLabelText("Descrição comercial de Caneca")).toHaveValue(expected);
    expect(mock.update).not.toHaveBeenCalled(); expect(publicationCalls()).toHaveLength(0);
    await waitFor(() => expect(within(card).getByRole("button", { name: "Salvar publicação" })).toBeEnabled());
    fireEvent.click(within(card).getByRole("button", { name: "Salvar publicação" })); await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    expect(publicationCalls()[0][1].p_product_changes).toEqual({ description: expected, commercial_presentation: {
      dimensions: { length_mm: null, width_mm: null, height_mm: 120 }, description_generation: expect.objectContaining({ generated_text: expected, generator: "facts-pt-BR-v1" }),
    } });
    expect(mock.events).toEqual(["atomic"]);
  });

  it("does not emit success after an atomic save finishes after its card unmounts", async () => {
    let finish!: (value:unknown) => void;
    mock.pendingUpdate = new Promise(resolve => { finish = resolve; });
    const card = await preparePublication(); fillPackage(card);
    fireEvent.click(within(card).getByRole("button", { name: "Salvar publicação" })); await waitFor(() => expect(publicationCalls()).toHaveLength(1));
    cleanup();
    await act(async () => { finish({ saved: true, listing_id: "listing-1", product_updated_at: "2026-11-02T12:02:00Z", listing_updated_at: "2026-11-02T12:02:00Z", replayed: false }); await mock.pendingUpdate; });
    expect(publicationCalls()).toHaveLength(1); expect(mock.toast).not.toHaveBeenCalled();
  });
});
