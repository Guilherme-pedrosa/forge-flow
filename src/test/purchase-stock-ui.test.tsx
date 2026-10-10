import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Compras, { parseNfeXml } from "@/pages/estoque/Compras";
import { PurchaseStockQuantity } from "@/components/estoque/PurchaseStockQuantity";
import { calculateFilamentPlan, loadFilamentPlanningSnapshot } from "@/lib/filament-planning";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), orders: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
// These tests verify financial/material payloads. Real dropdown focus, search,
// keyboard and responsive bounds are exercised by test-catalog-search-ui.mjs.
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({ value, onValueChange, children, disabled }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode; disabled: boolean }) => {
      const trigger = Children.toArray(children).find(child => isValidElement(child) && (child.props as Record<string, unknown>)["aria-label"]);
      const label = isValidElement(trigger) ? (trigger.props as Record<string, string>)["aria-label"] : "Selecionar";
      return <select aria-label={label} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>;
    }, SelectTrigger: () => null, SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "inventory_items" ? [{ id: "red", name: "Filamento", category: "filament", is_active: true, current_stock: 0, material_code: "PLA", color: "Vermelho", color_code: "RED", unit: "g" }, { id: "blue", name: "Filamento", category: "filament", is_active: true, current_stock: 0, material_code: "PETG", color: "Azul", color_code: "BLUE", unit: "kg" }] : table === "purchase_orders" ? mock.orders.map(order => ({ ...order })) : table === "purchase_order_items" ? mock.items : [], error: null }).then(resolve, reject) };
  return query;
} } }));
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); Element.prototype.scrollIntoView = vi.fn(); mock.rpc.mockReset(); mock.toast.mockClear(); mock.orders = []; mock.items = []; mock.rpc.mockResolvedValue({ data: "purchase-1", error: null }); });
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Compras /></MemoryRouter></QueryClientProvider>);

describe("recebimento com material/cor e massa explícitos", () => {
  it("mantém quantidade comprada 1 e preço do rolo, salvando entrada de 1000g no material escolhido", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Nova Compra" }));

    fireEvent.change(screen.getByLabelText("Descrição do item 1"), { target: { value: "Rolo vermelho" } });
    fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "100" } });
    await screen.findByRole("option", { name: /Filamento · PLA/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Material de estoque do item 1" }), { target: { value: "red" } });
    expect(screen.getByLabelText("Quantidade de estoque de Rolo vermelho")).toHaveValue("");
    fireEvent.click(screen.getByText("Calcular por rolo ou embalagem"));
    fireEvent.change(screen.getByLabelText("Peso de material por embalagem de Rolo vermelho"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar total de 1.000 g" }));
    expect(screen.getByLabelText("Quantidade comprada do item 1")).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar compra" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_quick_purchase", expect.objectContaining({ p_items: [expect.objectContaining({ quantity: 1, unit_price: 100, total: 100, inventory_item_id: "red", stock_quantity: 1000 })] })));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_quick_purchase"]);
  });
  it("limpa a conversão ao mudar a quantidade comercial ou selecionar outro material/unidade", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Nova Compra" }));

    await screen.findByRole("option", { name: /Filamento · PLA/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Material de estoque do item 1" }), { target: { value: "red" } });
    fireEvent.change(screen.getByLabelText("Quantidade de estoque de Filamento"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Quantidade comprada do item 1"), { target: { value: "2" } });
    expect(screen.getByLabelText("Quantidade de estoque de Filamento")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Quantidade de estoque de Filamento"), { target: { value: "2000" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Material de estoque do item 1" }), { target: { value: "blue" } });
    expect(screen.getByLabelText("Quantidade de estoque de Filamento")).toHaveValue("");
    expect(screen.getByText("Total de entrada no estoque (kg)")).toBeInTheDocument();
  });
  it("usa somente a unidade comercial estruturada da NF e exige aplicar a conversão", () => {
    const xml = `<NFe><infNFe Id="NFe123"><det><prod><xProd>Rolo 1kg</xProd><qCom>2</qCom><uCom>KG</uCom><vUnCom>100</vUnCom><vProd>200</vProd></prod></det></infNFe></NFe>`;
    const parsed = parseNfeXml(xml)!; expect(parsed.items[0]).toMatchObject({ quantity: 2, purchaseUnit: "KG" }); expect(parsed.items[0].stockQuantity).toBeUndefined();
    const commit = vi.fn(); render(<PurchaseStockQuantity label="NF" value="" purchasedQuantity={parsed.items[0].quantity} purchaseUnit={parsed.items[0].purchaseUnit} stockUnit="g" onCommit={commit} />);
    expect(screen.getByLabelText("Quantidade de estoque de NF")).toHaveValue(""); expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Converter 2 KG da nota → 2.000 g" }));
    expect(commit).toHaveBeenCalledExactlyOnceWith("2000");
    expect(parseNfeXml(xml.replace("<uCom>KG</uCom>", ""))?.items[0].purchaseUnit).toBe("");
  });
});

describe("revisão da previsão de compra pendente", () => {
  const fixture = (status = "pending", expectedDate: string | null = null) => {
    mock.orders = [{ id: "purchase-1", code: "CMP-XML-1", status, expected_date: expectedDate, order_date: "2026-10-10", received_date: null, total: 110, nfe_number: "123", nfe_key: "xml-key", nfe_xml: "<NFe/>", vendors: { name: "Fornecedor XML" } }];
    mock.items = [{ id: "line-1", purchase_order_id: "purchase-1", description: "Rolo vermelho", quantity: 1, unit_price: 100, total: 100, inventory_item_id: "red", stock_quantity: 1000 }];
    const completedRequests = new Set<string>();
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "purchase_expected_date_review_available") return { data: true, error: null };
      if (name === "set_purchase_expected_date") {
        const requestId = String(args.p_request_id);
        if (!completedRequests.has(requestId)) { mock.orders[0].expected_date = args.p_expected_date; completedRequests.add(requestId); }
        return { data: "purchase-1", error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
  };
  const Projection = () => {
    const query = useQuery({ queryKey: ["filament-planning", "tenant-1"], queryFn: () => loadFilamentPlanningSnapshot(supabase) });
    const plan = query.data ? calculateFilamentPlan(query.data, "2026-10-10") : null;
    return <output aria-label="Entrada projetada">{plan?.materials[0].incomingGrams ?? 0} g em {plan?.materials[0].timeline[0]?.date ?? "data não confirmada"}</output>;
  };
  const mountDetail = (projection = false) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/estoque/compras?compra=purchase-1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Compras />{projection && <Projection />}</MemoryRouter></QueryClientProvider>);
    return { client, invalidate };
  };
  it("revisa compra XML já salva e recarrega a projeção no dia confirmado sem recriar a compra", async () => {
    fixture(); const { invalidate } = mountDetail(true);
    expect(await screen.findByLabelText("Previsão de entrega da compra")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("0 g em data não confirmada"));
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "2026-10-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-13"));
    expect(mock.rpc).toHaveBeenCalledWith("set_purchase_expected_date", expect.objectContaining({ p_order_id: "purchase-1", p_expected_date: "2026-10-13", p_request_id: expect.any(String) }));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["purchase_expected_date_review_available", "set_purchase_expected_date"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["purchase_orders"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["filament-planning"] });
    expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Previsão atualizada" }));
  });
  it("mantém a data salva e a projeção quando a revisão falha, permitindo repetir a mesma operação", async () => {
    fixture("pending", "2026-10-12");
    let attempts = 0;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "purchase_expected_date_review_available") return { data: true, error: null };
      attempts++;
      if (attempts === 1) return { data: null, error: { message: "Falha de conexão" } };
      mock.orders[0].expected_date = args.p_expected_date; return { data: "purchase-1", error: null };
    });
    const { invalidate } = mountDetail(true);
    await screen.findByLabelText("Previsão de entrega da compra");
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-12"));
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "2026-10-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de conexão");
    expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-12");
    expect(invalidate).not.toHaveBeenCalled();
    expect(mock.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Previsão atualizada" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-14"));
    const calls = mock.rpc.mock.calls.filter(call => call[0] === "set_purchase_expected_date");
    expect(calls[1][1].p_request_id).toBe(calls[0][1].p_request_id);
  });
  it("retira a previsão só ao salvar explicitamente o campo vazio", async () => {
    fixture("pending", "2026-10-12"); mountDetail(true);
    await screen.findByLabelText("Previsão de entrega da compra");
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "" } });
    expect(mock.rpc).not.toHaveBeenCalledWith("set_purchase_expected_date", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("set_purchase_expected_date", expect.objectContaining({ p_order_id: "purchase-1", p_expected_date: null })));
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("0 g em data não confirmada"));
  });
  it("gera nova operação ao revisar novamente a mesma data após outra sessão mudar a compra", async () => {
    fixture(); const { client } = mountDetail(true);
    await screen.findByLabelText("Previsão de entrega da compra");
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "2026-10-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Previsão atualizada" })));
    expect(mock.orders[0].expected_date).toBe("2026-10-13");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    // Another session changes the confirmed forecast; the original component
    // and its request map stay mounted when the detail is closed and reopened.
    mock.orders[0].expected_date = "2026-10-15";
    await act(async () => { await Promise.all([client.invalidateQueries({ queryKey: ["purchase_orders"] }), client.invalidateQueries({ queryKey: ["filament-planning"] })]); });
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-15"));
    fireEvent.click(screen.getByText("CMP-XML-1"));
    expect(await screen.findByLabelText("Previsão de entrega da compra")).toHaveValue("2026-10-15");
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "2026-10-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(screen.getByLabelText("Entrada projetada")).toHaveTextContent("1000 g em 2026-10-13"));
    expect(mock.orders[0].expected_date).toBe("2026-10-13");
    const calls = mock.rpc.mock.calls.filter(call => call[0] === "set_purchase_expected_date");
    expect(calls).toHaveLength(2);
    expect(calls[1][1].p_request_id).not.toBe(calls[0][1].p_request_id);
  });
  it("informa a ativação da estrutura sem oferecer salvar quando a disponibilidade não existe", async () => {
    fixture(); mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Function not found" } }); mountDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("ativação da estrutura de compras");
    expect(screen.queryByRole("button", { name: "Salvar previsão" })).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["purchase_expected_date_review_available"]);
  });
  it("trata ausência da RPC de escrita como ativação sem registrar sucesso nem invalidar a projeção", async () => {
    fixture(); mock.rpc.mockImplementation(async (name: string) => name === "purchase_expected_date_review_available" ? { data: true, error: null } : { data: null, error: { code: "PGRST202", message: "Function not found" } });
    const { invalidate } = mountDetail(); await screen.findByLabelText("Previsão de entrega da compra");
    fireEvent.change(screen.getByLabelText("Previsão de entrega da compra"), { target: { value: "2026-10-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ativação da estrutura de compras");
    expect(screen.queryByRole("button", { name: "Salvar previsão" })).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("distingue falha de leitura de estrutura ausente e permite consultar novamente", async () => {
    fixture(); mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Network unavailable" } }); mountDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível consultar");
    expect(screen.queryByText(/ativação da estrutura/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByLabelText("Previsão de entrega da compra")).toHaveValue("");
  });
  it("não oferece revisar para perfil sem permissão ou para compras recebidas/canceladas", async () => {
    fixture(); mock.rpc.mockResolvedValue({ data: false, error: null }); mountDetail();
    expect(await screen.findByText("Seu perfil não tem permissão para revisar a previsão de compras.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar previsão" })).not.toBeInTheDocument();
    cleanup(); mock.rpc.mockClear(); fixture("received"); mountDetail();
    await screen.findByText("Pedido CMP-XML-1"); expect(screen.queryByLabelText("Previsão de entrega da compra")).not.toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled();
    cleanup(); fixture("cancelled"); mountDetail();
    await screen.findByText("Pedido CMP-XML-1"); expect(screen.queryByLabelText("Previsão de entrega da compra")).not.toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled();
  });
});
