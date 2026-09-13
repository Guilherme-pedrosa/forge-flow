import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPrintSources from "@/pages/comercial/ProductPrintSources";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), sources: [] as Record<string, unknown>[], tasks: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (result: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve({ data: table === "product_print_sources" ? mock.sources : mock.tasks, error: null }).then(resolve, reject),
    };
    return builder;
  },
} }));
const source = { id: "source-1", tenant_id: "tenant-1", product_id: "product-1", label: "Arquivo da peça", source_url: null, file_name: "peca.3mf", file_path: "tenant-1/file/peca.3mf", design_id: null, instance_id: null, model_id: null, profile_id: null, plate_index: null, is_active: true };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ProductPrintSources productId="product-1" tenantId="tenant-1" /></QueryClientProvider>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.toast.mockClear(); mock.sources = [source];
  mock.tasks = [
    { id: "task-a", bambu_task_id: "101", design_title: "Mesmo nome", status: "2", start_time: "2026-09-13T10:00:00Z", bambu_devices: { name: "Impressora A" } },
    { id: "task-b", bambu_task_id: "102", design_title: "Mesmo nome", status: "3", start_time: "2026-09-13T11:00:00Z", bambu_devices: { name: "Impressora B" } },
  ];
});
afterEach(cleanup);

describe("binding a product file to Bambu history", () => {
  it("requires an explicit history choice and sends the selected task UUID, never a name match", async () => {
    mock.rpc.mockResolvedValue({ data: "source-1", error: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular impressão" }));
    const select = await screen.findByRole("combobox", { name: "Impressão do histórico" });
    await screen.findByRole("option", { name: /Impressora B.*#102/ });
    expect(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "task-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bind_product_print_source", { p_source_id: "source-1", p_task_id: "task-b" }));
    const bindings = mock.rpc.mock.calls.filter(([name]) => name === "bind_product_print_source");
    expect(bindings).toHaveLength(1);
    const bindingIndex = mock.rpc.mock.calls.findIndex(([name]) => name === "bind_product_print_source");
    expect(mock.rpc.mock.contexts[bindingIndex]).toBe(supabase);
  });

  it("keeps the selection open and exposes a server-side ambiguity conflict", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "Esta impressão já está vinculada a outro SKU." } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular impressão" }));
    await screen.findByRole("option", { name: /Impressora A.*#101/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Impressão do histórico" }), { target: { value: "task-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "Esta impressão já está vinculada a outro SKU." })));
    expect(screen.getByRole("combobox", { name: "Impressão do histórico" })).toHaveValue("task-a");
  });

  it("clears an old selection when the user changes the history search", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular impressão" }));
    await screen.findByRole("option", { name: /Impressora A.*#101/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Impressão do histórico" }), { target: { value: "task-a" } });
    fireEvent.change(screen.getByLabelText("Buscar por nome, impressora ou ID Bambu"), { target: { value: "Impressora B" } });
    expect(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })).toBeDisabled();
    expect(mock.rpc.mock.calls.filter(([name]) => name === "bind_product_print_source")).toHaveLength(0);
  });

  it("saves a MakerWorld link without inventing a cloud profile from the fragment", async () => {
    mock.sources = [];
    mock.rpc.mockImplementation(async (_name, input) => {
      mock.sources = [{ ...source, file_name: null, file_path: null, ...input.p_source }];
      return { data: "source-1", error: null };
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar fonte" }));
    fireEvent.change(screen.getByLabelText("Nome da fonte"), { target: { value: "Modelo MakerWorld" } });
    const link = screen.getByLabelText("Link do modelo ou perfil");
    fireEvent.change(link, { target: { value: "https://makerworld.com/en/models/12345#profileId-999" } });
    fireEvent.blur(link);
    fireEvent.click(screen.getByRole("button", { name: "Salvar fonte" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_print_source", {
      p_source_id: null, p_product_id: "product-1", p_source: {
        source_url: "https://makerworld.com/en/models/12345#profileId-999", label: "Modelo MakerWorld",
        design_id: "12345", instance_id: null, model_id: null, profile_id: null, plate_index: null,
      },
    }));
    expect(await screen.findByRole("combobox", { name: "Impressão do histórico" })).toBeInTheDocument();
  });
});
