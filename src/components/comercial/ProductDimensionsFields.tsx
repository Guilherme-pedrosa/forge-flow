import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { productDimensionFields, type ProductDimensionsDraft } from "@/lib/product-presentation";

export function ProductDimensionsFields({ value, onChange, disabled = false, idPrefix = "product-dimensions" }: {
  value: ProductDimensionsDraft; onChange: (value: ProductDimensionsDraft) => void; disabled?: boolean; idPrefix?: string;
}) {
  return <section aria-label="Medidas da peça" className="space-y-3 rounded-lg border p-3"><div><h3 className="font-medium">Medidas da peça</h3><p className="text-sm text-muted-foreground">Informe o tamanho do produto pronto. Deixe em branco o que ainda não foi medido.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">{productDimensionFields.map(([key, , label]) => <div key={key}><Label htmlFor={`${idPrefix}-${key}`}>{label}</Label><Input id={`${idPrefix}-${key}`} value={value[key]} inputMode="decimal" disabled={disabled} placeholder="Não informado" onChange={event => onChange({ ...value, [key]: event.target.value })} /></div>)}</div>
    <p className="text-xs text-muted-foreground">Estas medidas podem completar a descrição; textos editados à mão são preservados. As medidas da embalagem para o frete são preenchidas separadamente.</p></section>;
}
