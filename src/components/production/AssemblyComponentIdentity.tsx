import type { AssemblyComponent } from "@/lib/assembly";
import { ImportedModelImage } from "@/components/comercial/ImportedModelImage";

export function AssemblyComponentIdentity({ part }: { part: AssemblyComponent }) {
  return <div className="flex items-start gap-2">
    {part.photo_url && <ImportedModelImage src={part.photo_url} alt={part.label} className="h-14 w-14 shrink-0 rounded border object-contain" />}
    <div>{part.label}<p className="text-xs font-normal text-muted-foreground">Placa {part.plate_index}{!part.prepared && " · preparar materiais"}</p>
      {!!part.parts?.length && <ul className="mt-1 text-xs font-normal text-muted-foreground">{part.parts.map((piece, i) => <li key={i}>{piece.quantity_per_product != null ? `${piece.quantity_per_product} × ` : ""}{piece.name}</li>)}</ul>}
    </div>
  </div>;
}
