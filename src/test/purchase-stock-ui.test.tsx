import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Compras, { parseNfeXml } from "@/pages/estoque/Compras";
import { PurchaseStockQuantity } from "@/components/estoque/PurchaseStockQuantity";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
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
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "inventory_items" ? [{ id: "red", name: "Filamento", material_code: "PLA", color: "Vermelho", color_code: "RED", unit: "g" }, { id: "blue", name: "Filamento", material_code: "PETG", color: "Azul", color_code: "BLUE", unit: "kg" }] : [], error: null }).then(resolve, reject) };
  return query;
} } }));
beforeEach(() => { mock.rpc.mockReset(); mock.toast.mockClear(); mock.rpc.mockResolvedValue({ data: "purchase-1", error: null }); });
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Compras /></MemoryRouter></QueryClientProvider>);

describe("recebimento com material/cor e massa explícitos", () => {
  it("mantém quantidade comprada 1 e preço do rolo, salvando entrada de 1000g no material escolhido", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Nova Compra" }));
    await screen.findByRole("option", { name: "Filamento · PLA · Vermelho · [RED] · estoque em g" });
    fireEvent.change(screen.getByLabelText("Descrição do item 1"), { target: { value: "Rolo vermelho" } });
    fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Material de estoque do item 1"), { target: { value: "red" } });
    expect(screen.getByLabelText("Quantidade de estoque de Rolo vermelho")).toHaveValue("");
    fireEvent.click(screen.getByText("Calcular por rolo ou embalagem"));
    fireEvent.change(screen.getByLabelText("Peso de material por embalagem de Rolo vermelho"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar total de 1.000 g" }));
    expect(screen.getByLabelText("Quantidade comprada do item 1")).toHaveValue(1);
    fireEvent.click(screen.getByRole("button", { name: "Criar Pedido" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("create_purchase_order", expect.objectContaining({ p_items: [expect.objectContaining({ quantity: 1, unit_price: 100, total: 100, inventory_item_id: "red", stock_quantity: 1000 })] })));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["create_purchase_order"]);
  });
  it("limpa a conversão ao mudar a quantidade comercial ou selecionar outro material/unidade", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Nova Compra" }));
    await screen.findByRole("option", { name: /Filamento · PLA/ });
    fireEvent.change(screen.getByLabelText("Material de estoque do item 1"), { target: { value: "red" } });
    fireEvent.change(screen.getByLabelText("Quantidade de estoque de item 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Quantidade comprada do item 1"), { target: { value: "2" } });
    expect(screen.getByLabelText("Quantidade de estoque de item 1")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Quantidade de estoque de item 1"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Material de estoque do item 1"), { target: { value: "blue" } });
    expect(screen.getByLabelText("Quantidade de estoque de item 1")).toHaveValue("");
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
