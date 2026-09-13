type StockMaterial = { name: string; unit: string; sku?: string | null; category?: string | null; material_code?: string | null; color?: string | null; color_code?: string | null };

export function purchaseMaterialLabel(item: StockMaterial) {
  const identity = [item.material_code, item.color, item.color_code ? `[${item.color_code}]` : null].filter(Boolean).join(" · ");
  const pending = ["filament", "resin"].includes(item.category ?? "") && (!item.material_code || !item.color || !item.color_code);
  return [item.name, identity, pending ? "Tipo/cor pendentes" : null, item.sku, `estoque em ${item.unit}`].filter(Boolean).join(" · ");
}

export function purchaseMassToStock(quantity: number, purchaseUnit: string, stockUnit: string): number | null {
  const from = purchaseUnit.trim().toLowerCase(); const to = stockUnit.trim().toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0 || !["g", "kg"].includes(from) || !["g", "kg"].includes(to)) return null;
  const result = quantity * (from === "kg" ? 1000 : 1) / (to === "kg" ? 1000 : 1);
  const rounded = Math.round(result * 1e6) / 1e6;
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

export function purchasePackageToStock(purchasedQuantity: number, massPerPackage: string, massUnit: string, stockUnit: string): number | null {
  const mass = Number(massPerPackage.trim().replace(",", "."));
  if (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0 || !Number.isFinite(mass) || mass <= 0) return null;
  return purchaseMassToStock(purchasedQuantity * mass, massUnit, stockUnit);
}

export function purchaseStockQuantity(value: string): number | null {
  if (!value.trim()) return null;
  const quantity = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Informe a quantidade total que entra no estoque, maior que zero.");
  return quantity;
}
