import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import ProductFileRevisionDialog from "./ProductFileRevisionDialog";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), close: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("./ModelFileInput", () => ({ default: ({ onChange, onFileReady, onBusyChange }: { onChange: (v: unknown) => void; onFileReady: (f: File) => void; onBusyChange: (v: boolean) => void }) => <><button onClick={() => {
  const file = new File(["test"], "revisao.3mf"); Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("test").buffer });
  onFileReady(file); onChange({ profile_id: "local:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", enabled: true, plates: [{ index: 1, label: "Folhas", weight_grams: 4, time_seconds: 300, parts: [{ source_key: "object:1", name: "Folha", quantity_per_plate: 4 }] }] });
}}>Carregar arquivo de teste</button><button onClick={() => onBusyChange(true)}>Abrir outro arquivo</button></> }));
const context = { revision: "revision", can_target_product: false, blocked_reason: null, active_plates: [], components: [{ id: "subitem", component_product_id: "component-product", name: "Folha cadastrada", sku: "FOLHA" }] };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProductFileRevisionDialog productId="product" tenantId="tenant" open onOpenChange={mocks.close} /></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }); mocks.upload.mockResolvedValue({ error: null }); mocks.rpc.mockImplementation(async (name: string) => name === "product_file_revision_context" ? { data: context, error: null } : { data: "new-source", error: null }); });
afterEach(cleanup);
async function load() { fireEvent.click(await screen.findByRole("button", { name: "Carregar arquivo de teste" })); }
describe("existing product file revision", () => {
  it("requires an explicit existing subitem mapping and preserves its stock identity", async () => {
    mount(); await load(); const apply = screen.getByRole("button", { name: "Aplicar revisão" }); expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Placa 1 · Folha"), { target: { value: "subitem" } }); fireEvent.click(apply);
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    const args = mocks.rpc.mock.calls.find(([name]) => name === "apply_product_file_revision")?.[1];
    expect(args.p_mapping.parts).toEqual([{ plate_index: 1, source_key: "object:1", subitem_id: "subitem" }]);
    expect(args.p_mapping.file_path).toMatch(/^tenant\//); expect(args.p_expected_revision).toBe("revision");
    expect(mocks.rpc.mock.calls.every(([name]) => ["product_file_revision_context", "apply_product_file_revision"].includes(name))).toBe(true);
  });
  it("does not apply a stale preview when a replacement file starts loading", async () => {
    mount(); await load(); fireEvent.click(screen.getByRole("button", { name: "Abrir outro arquivo" }));
    expect(screen.queryByRole("button", { name: "Aplicar revisão" })).not.toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("keeps an existing revision untouched when private file upload fails", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Falha no upload" } }); mount(); await load();
    fireEvent.change(screen.getByLabelText("Placa 1 · Folha"), { target: { value: "subitem" } }); fireEvent.click(screen.getByRole("button", { name: "Aplicar revisão" }));
    await screen.findByText("Falha no upload"); expect(mocks.rpc.mock.calls.some(([name]) => name === "apply_product_file_revision")).toBe(false); expect(mocks.close).not.toHaveBeenCalled();
  });
});
