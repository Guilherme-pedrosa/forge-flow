import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { purchaseMassToStock, purchasePackageToStock } from "@/lib/purchase-stock";

export function PurchaseStockQuantity({ label, value, purchasedQuantity, stockUnit, purchaseUnit, onChange, onCommit, disabled = false }: {
  label: string; value: string; purchasedQuantity: number; stockUnit: string; purchaseUnit?: string;
  onChange?: (value: string) => void; onCommit?: (value: string) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [mass, setMass] = useState("");
  const [massUnit, setMassUnit] = useState("kg");
  useEffect(() => { setDraft(value); }, [value]);
  const direct = purchaseUnit ? purchaseMassToStock(purchasedQuantity, purchaseUnit, stockUnit) : null;
  const calculated = purchasePackageToStock(purchasedQuantity, mass, massUnit, stockUnit);
  const update = (next: string) => { setDraft(next); onChange?.(next); };
  const apply = (quantity: number) => { const next = String(quantity); update(next); onCommit?.(next); };
  const fmt = (quantity: number) => quantity.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  return <div className="min-w-0 space-y-2">
    <label className="block text-xs font-medium">Total de entrada no estoque ({stockUnit})
      <Input aria-label={`Quantidade de estoque de ${label}`} inputMode="decimal" placeholder={`Total em ${stockUnit}`} value={draft} disabled={disabled} onChange={event => update(event.target.value)} onBlur={() => { if (draft !== value) onCommit?.(draft); }} />
    </label>
    {direct != null ? <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal text-left text-xs" disabled={disabled} onClick={() => apply(direct)}>Converter {fmt(purchasedQuantity)} {purchaseUnit} da nota → {fmt(direct)} {stockUnit}</Button>
      : ["g", "kg"].includes(stockUnit) && <details className="text-xs">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">Calcular por rolo ou embalagem</summary>
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <p>{fmt(purchasedQuantity)} unidades compradas. Informe o peso líquido de material em cada uma, sem o carretel.</p>
          <div className="flex gap-2">
            <Input aria-label={`Peso de material por embalagem de ${label}`} inputMode="decimal" placeholder="Peso por embalagem" value={mass} onChange={event => setMass(event.target.value)} disabled={disabled} />
            <select aria-label={`Unidade do peso por embalagem de ${label}`} value={massUnit} onChange={event => setMassUnit(event.target.value)} disabled={disabled} className="h-10 rounded-md border bg-background px-2"><option value="kg">kg</option><option value="g">g</option></select>
          </div>
          <Button type="button" variant="outline" size="sm" className="min-h-11 w-full whitespace-normal" disabled={disabled || calculated == null} onClick={() => calculated != null && apply(calculated)}>{calculated == null ? "Informe o peso para calcular" : `Aplicar total de ${fmt(calculated)} ${stockUnit}`}</Button>
        </div>
      </details>}
  </div>;
}
