import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivrePublicationProductFields } from "./MercadoLivrePublicationProductFields";
import { publicationSchema } from "@/lib/mercado-livre-workspace";
import fixture from "@/test/fixtures/ml-workspace-contract.json";
const mock = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-a" }, user: { id: "user-a" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ upload: mock.upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/${path}` } }) }) } } }));
vi.mock("@/lib/mercado-livre-workspace", async original => ({ ...await original<typeof import("@/lib/mercado-livre-workspace")>(), saveMercadoLivreProductDetails: mock.save }));
const source = () => { const value = publicationSchema.parse(structuredClone(fixture.publication_prepare)); value.product.name = "Nome original do cadastro"; value.product.description = "Descrição original para a loja"; value.selected_pictures = [{ url: "https://example.com/only-in-listing.jpg", width: 1000, height: 1000 }]; value.draft = { ...value.draft, title: "Título diferente só no anúncio", description: "Descrição diferente só no anúncio", picture_urls: ["https://example.com/only-in-listing.jpg"] }; return value; };
beforeEach(() => { mock.save.mockReset().mockResolvedValue({ saved: true }); mock.upload.mockReset().mockResolvedValue({ error: null }); });
afterEach(cleanup);
function mount(section: "dimensions" | "shipping" | "photos" = "shipping") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), saved = vi.fn(), busy = vi.fn(), dirty = vi.fn(), value = source();
  const ui = (next = section) => <QueryClientProvider client={client}><MercadoLivrePublicationProductFields value={value} accountId={value.account_id} section={next} onSaved={saved} onBusyChange={busy} onDirtyChange={dirty} /></QueryClientProvider>;
  const view = render(ui()); return { ...view, value, saved, busy, dirty, section: (next: typeof section) => view.rerender(ui(next)) };
}
describe("publication product data remains separate from the listing draft", () => {
  it("editing packaging preserves the original catalog copy and all other product facts", async () => {
    const view = mount(); fireEvent.change(screen.getByLabelText("Comprimento embalado (cm)"), { target: { value: "22,5" } }); expect(screen.getByLabelText("Nome comercial em português")).not.toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Salvar dados e conferir publicação" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); expect(mock.save).toHaveBeenCalledWith(view.value.account_id, view.value.product_id, expect.objectContaining({ name: "Nome original do cadastro", description: "Descrição original para a loja", shipping_package: expect.objectContaining({ length_cm: 22.5 }), photos: view.value.product.photos.map(photo => photo.url) }), view.value.forge_revision, expect.any(String)); expect(view.saved).toHaveBeenCalledOnce();
  });
  it("keeps dimensions and packaging edits across sections and retries an unsuccessful save with the same request", async () => {
    mock.save.mockRejectedValueOnce(new Error("Resposta perdida")); const view = mount("dimensions"); fireEvent.change(screen.getByLabelText("Comprimento da peça (cm)"), { target: { value: "12" } }); view.section("shipping"); fireEvent.change(screen.getByLabelText("Peso embalado (g)"), { target: { value: "250" } }); view.section("dimensions"); expect(screen.getByLabelText("Comprimento da peça (cm)")).toHaveValue("12"); fireEvent.click(screen.getByRole("button", { name: "Salvar dados e conferir publicação" })); await screen.findByText("Resposta perdida"); fireEvent.click(screen.getByRole("button", { name: "Salvar dados e conferir publicação" })); await waitFor(() => expect(view.saved).toHaveBeenCalledOnce()); expect(mock.save.mock.calls[1]).toEqual(mock.save.mock.calls[0]); expect(mock.save.mock.calls[1][2]).toMatchObject({ dimensions: { length_mm: 120 }, shipping_package: { weight_grams: 250 } });
  });
  it("holds the busy guard during upload and releases it on unmount without uploading the next file in another session", async () => {
    let finish!: (value: { error: null }) => void; mock.upload.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = mount("photos"); const files = [new File(["photo-a"], "a.png", { type: "image/png" }), new File(["photo-b"], "b.png", { type: "image/png" })]; fireEvent.change(screen.getByLabelText("Adicionar fotos ao produto"), { target: { files } }); await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true)); view.unmount(); await act(async () => { finish({ error: null }); }); expect(mock.upload).toHaveBeenCalledTimes(1); expect(view.busy).toHaveBeenLastCalledWith(false); expect(view.saved).not.toHaveBeenCalled();
  });
  it("does not run a late save callback after the product editor has closed", async () => {
    let finish!: (value: unknown) => void; mock.save.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Salvar dados e conferir publicação" })); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); view.unmount(); await act(async () => { finish({ saved: true }); }); expect(view.saved).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
});
