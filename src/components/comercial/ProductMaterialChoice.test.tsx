import { useState } from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductMaterialChoice } from "./ProductMaterialChoice";
import { changeMaterialOverride, readMaterialOverrides, type MaterialOverride } from "@/lib/product-material-variant";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), price: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const options = [
  { id: "grey", name: "PLA Cinza", material_code: "PLA", color: "Cinza", color_code: "CINZA", color_hex: "#AAAAAA", unit: "g", avg_cost: .08, current_stock: 1000, cost_known: true },
  { id: "purple", name: "PLA Roxo", material_code: "PLA", color: "Roxo", color_code: "ROXO", color_hex: "#AC95D5", unit: "g", avg_cost: .12, current_stock: 300, cost_known: true },
];
const choice = { product_id: "product", plate_id: "plate1", plate_label: "Base da roleta", base_item_id: "grey", selected_item_id: "grey", options };
function Fixture({ quantity = 1 }: { quantity?: number }) {
  const [overrides, setOverrides] = useState<MaterialOverride[]>([]);
  return <ProductMaterialChoice productId="product" tenantId="tenant" quantity={quantity} unitPrice={20} overrides={overrides} onChange={setOverrides} onUnitPriceChange={mock.price} />;
}
const mount = (quantity = 1) => render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Fixture quantity={quantity} /></QueryClientProvider></MemoryRouter>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.price.mockReset();
  mock.rpc.mockImplementation(async (_name, args) => {
    const selected = args.p_material_overrides[0]?.item_id || "grey";
    const cost = selected === "purple" ? 12 : 8;
    return { data: { snapshot: {}, material_options: [{ ...choice, selected_item_id: selected }], complete: true, missing: [], cost_per_unit: cost, estimated_total_cost: cost * args.p_quantity, estimated_unit_cost: cost }, error: null };
  });
});
afterEach(cleanup);
describe("choosing the physical material for one sale item", () => {
  it("prices the selected color for the requested quantity, without updating the product recipe", async () => {
    mount(3);
    fireEvent.change(await screen.findByLabelText("Base da roleta"), { target: { value: "purple" } });
    await waitFor(() => expect(mock.rpc).toHaveBeenLastCalledWith("product_material_variant_preview", {
      p_product_id: "product", p_quantity: 3, p_material_overrides: [{ product_id: "product", plate_id: "plate1", base_item_id: "grey", item_id: "purple" }],
    }));
    await screen.findByText("R$ 12,00", { exact: false });
    fireEvent.change(screen.getByLabelText("Margem desejada (%)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /Usar R\$\s*20,00/ }));
    expect(mock.price).toHaveBeenCalledWith(20);
    expect(mock.rpc.mock.calls.every(([name]) => name === "product_material_variant_preview")).toBe(true);
  });
  it("does not turn an incomplete cost into zero or suggest a price", async () => {
    mock.rpc.mockResolvedValue({ data: { snapshot: {}, material_options: [], complete: false, missing: ["Confirme o custo do PLA roxo."], cost_per_unit: null, estimated_total_cost: null, estimated_unit_cost: null }, error: null });
    mount(); await screen.findByText("Confirme o custo do PLA roxo.");
    expect(screen.queryByLabelText("Margem desejada (%)")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir produto em outra aba" })).toHaveAttribute("target", "_blank");
  });
  it("keeps different colors on different plates and restores the default without losing other choices", () => {
    const second = { ...choice, plate_id: "plate2" };
    let values = changeMaterialOverride([], choice, "purple");
    values = changeMaterialOverride(values, second, "purple");
    values = changeMaterialOverride(values, choice, "grey");
    expect(values).toEqual([{ product_id: "product", plate_id: "plate2", base_item_id: "grey", item_id: "purple" }]);
    expect(readMaterialOverrides(values)).toEqual(values);
    expect(() => readMaterialOverrides([...values, ...values])).toThrow(/mais de um/);
  });
});
