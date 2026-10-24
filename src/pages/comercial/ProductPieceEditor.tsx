import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { PieceSpecFields } from "@/components/production/PieceTechnicalSheet";
import { assemblyRows, assemblyRpc, type PhysicalSubitem } from "@/lib/assembly";
import { pieceDraft, piecePayload } from "@/lib/piece-technical";
import { positiveInteger } from "@/lib/production";
import { orderRequest } from "@/lib/sales-order";
import type { WorkspaceProduct } from "./ProductWorkspace";

export default function ProductPieceEditor({ productId, productName, tenantId, part, child, onClose, onSaved }: {
  productId: string; productName: string; tenantId: string; part?: PhysicalSubitem; child?: WorkspaceProduct;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState(child?.name || part?.label || "");
  const [sku, setSku] = useState(child?.sku || part?.sku || "");
  const [photo, setPhoto] = useState(child?.photo_url || "");
  const [quantity, setQuantity] = useState(part ? part.quantity_per_product == null ? "" : String(part.quantity_per_product) : "1");
  const [stock, setStock] = useState("0");
  const [cost, setCost] = useState(child?.manual_cost_override == null ? "" : String(child.manual_cost_override));
  const originalTechnical = useRef(pieceDraft(part?.technical)).current;
  const [technical, setTechnical] = useState(originalTechnical);
  const [printMode, setPrintMode] = useState(part?.plate_id ? "existing" : "later");
  const [plateId, setPlateId] = useState(part?.plate_id || "");
  const [yieldValue, setYieldValue] = useState(part?.quantity_per_plate == null ? "" : String(part.quantity_per_plate));
  const [printerId, setPrinterId] = useState("");
  const [nonMaterial, setNonMaterial] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const addingExisting = !part && mode === "existing";
  const catalogue = useQuery({ queryKey: ["products", tenantId, "existing-pieces"], enabled: addingExisting,
    queryFn: () => assemblyRows<{ id: string; name: string; sku: string | null }>("products", "id,name,sku", { tenant_id: tenantId, is_component: true, is_active: true }, "name") });
  const plates = useQuery({ queryKey: ["product_print_plates", tenantId, productId, "piece-editor"],
    queryFn: () => assemblyRows<{ id: string; label: string }>("product_print_plates", "id,label", { tenant_id: tenantId, product_id: productId, is_active: true }) });
  const printers = useQuery({ queryKey: ["printers", tenantId, "piece-editor"], enabled: printMode === "prepare",
    queryFn: () => assemblyRows<{ id: string; name: string }>("printers", "id,name", { tenant_id: tenantId, is_active: true }, "name") });
  const save = useMutation({ mutationFn: async () => {
    const qty = part && !quantity.trim() ? null : positiveInteger(quantity, "Peças por produto", 10000);
    if (addingExisting && !existingId) throw new Error("Escolha uma peça cadastrada.");
    if (!addingExisting && !name.trim()) throw new Error("Informe o nome da peça.");
    if (!addingExisting && photo.trim() && photo.trim() !== child?.photo_url) { const url = new URL(photo); if (url.protocol !== "https:") throw new Error("Use uma foto com endereço HTTPS."); }
    const number = (value: string, label: string) => { if (!value.trim()) return null; const n = Number(value.replace(",", ".")); if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: informe um valor não negativo.`); return n; };
    const data: Record<string, unknown> = { quantity_per_product: qty };
    if (addingExisting) data.component_product_id = existingId;
    else {
      if (!part || name.trim() !== child?.name) data.name = name.trim();
      if (!part || (sku.trim() || null) !== (child?.sku || null)) data.sku = sku.trim() || null;
      if (!part || (photo.trim() || null) !== (child?.photo_url || null)) data.photo_url = photo.trim() || null;
      const manualCost = number(cost, "Custo");
      if (!part || manualCost !== (child?.manual_cost_override ?? null)) data.unit_cost = manualCost;
      if (!part || printMode === "prepare" || JSON.stringify(technical) !== JSON.stringify(originalTechnical)) data.technical = piecePayload(technical);
    }
    if (!part && !addingExisting) data.initial_stock = stock.trim() === "0" ? 0 : positiveInteger(stock, "Estoque inicial", 1000000);
    if (!addingExisting) {
      if (printMode === "existing" && !plateId) throw new Error("Escolha a placa que produz esta peça.");
      if (printMode === "existing") {
        if (!part || plateId !== (part.plate_id || "")) data.plate_id = plateId;
        const yieldCount = yieldValue.trim() ? positiveInteger(yieldValue, "Peças por impressão", 10000) : null;
        if (!part || yieldCount !== part.quantity_per_plate) data.quantity_per_plate = yieldCount;
      } else if (printMode === "later") {
        if (part?.plate_id) { data.plate_id = null; data.quantity_per_plate = null; }
      }
      if (printMode === "prepare") {
        const yieldCount = positiveInteger(yieldValue || technical.units, "Peças por impressão", 10000);
        const otherCost = number(nonMaterial, "Demais custos por peça");
        if (otherCost == null) throw new Error("Confirme os demais custos por peça, inclusive se forem zero.");
        Object.assign(data, { prepare_print: true, plate_id: plateId || null, quantity_per_plate: yieldCount, technical: { ...piecePayload(technical), pieces_per_plate: yieldCount }, printer_id: printerId || null, non_material_cost_per_piece: otherCost });
      }
    }
    const signature = JSON.stringify([productId, part?.id, data]); request.current = orderRequest(request.current, signature);
    return assemblyRpc<string>("save_product_subitem_details", { p_product_id: productId, p_subitem_id: part?.id || null, p_data: data, p_request_id: request.current.id });
  }, onSuccess: async () => { await onSaved(); onClose(); } });
  const field = (id: string, label: string, value: string, change: (v: string) => void, numeric = false) => <div><Label htmlFor={`piece-edit-${id}`}>{label}</Label><Input id={`piece-edit-${id}`} value={value} onChange={e => change(e.target.value)} inputMode={numeric ? "decimal" : undefined} /></div>;
  return <section aria-label={part ? `Editar peça ${part.label}` : "Adicionar peça ao produto"} className="space-y-5 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-6">
    <div><p className="text-sm text-muted-foreground">Dentro de {productName}</p><h2 className="text-xl font-semibold">{part ? `Editar ${part.label}` : "Adicionar peça"}</h2><p className="mt-1 text-sm text-muted-foreground">Cadastro, quantidade usada e ficha técnica são salvos juntos.</p></div>
    <fieldset disabled={save.isPending} className="space-y-5">
    {!part && <div className="flex flex-wrap gap-2"><Button type="button" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>Criar nova peça</Button><Button type="button" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>Usar peça existente</Button></div>}
    {addingExisting ? <div className="space-y-2"><SearchableItemSelect label="Peça cadastrada" value={existingId} onChange={setExistingId} emptyLabel="Digite para buscar uma peça" options={(catalogue.data || []).filter(x => x.id !== productId).map(x => ({ id: x.id, label: x.name, description: x.sku || undefined }))} />{catalogue.error && <p role="alert" className="text-destructive">Não foi possível carregar as peças. <button className="underline" onClick={() => catalogue.refetch()}>Tentar novamente</button></p>}<p className="text-sm text-muted-foreground">O mesmo estoque e a mesma ficha técnica serão usados em todos os produtos que usam esta peça.</p></div> : <>
      {part && <p className="rounded-lg bg-muted p-3 text-sm">Esta é a ficha da peça. Alterar nome, custo ou ficha técnica atualiza todos os produtos que a usam. A quantidade abaixo vale apenas para {productName}.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{field("name", "Nome da peça *", name, setName)}{field("sku", "Código / SKU da peça", sku, setSku)}{field("cost", "Custo manual por peça (R$)", cost, setCost, true)}{!part ? field("stock", "Estoque inicial da peça", stock, setStock, true) : <div><p className="text-sm font-medium">Estoque desta peça</p><p className="mt-2">{part.balance} un. · movimentações em Estoque e montagem</p></div>}</div>
      <p className="text-xs text-muted-foreground">O custo manual é opcional e tem prioridade sobre a estimativa técnica. Deixe vazio para usar o custo calculado.</p>
      {field("photo", "Foto da peça (link HTTPS)", photo, setPhoto)}
    </>}
    <div className="max-w-sm">{field("quantity", "Quantidade desta peça em 1 produto completo", quantity, setQuantity, true)}</div>
    {!addingExisting && <>
      <div className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Filamento, tempo e custo da peça</h3><p className="text-sm text-muted-foreground">Você pode salvar agora e completar depois. Peso e tempo de uma placa com peças diferentes precisam ser identificados por peça.</p><PieceSpecFields value={technical} onChange={setTechnical} tenantId={tenantId} prefix="workspace-piece" showUnitCount={false} /></div>
      <div className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Como esta peça será impressa?</h3><Label htmlFor="piece-print-mode">Preparação da impressão</Label><select id="piece-print-mode" className="h-11 w-full rounded-md border bg-background px-3" value={printMode} onChange={e => setPrintMode(e.target.value)}><option value="later">Vou configurar depois</option><option value="existing">Esta peça sai em uma placa já cadastrada</option><option value="prepare">Preparar uma placa só desta peça</option></select>
        {printMode === "existing" && <><SearchableItemSelect label="Placa que produz esta peça" value={plateId} onChange={setPlateId} emptyLabel="Escolher placa de impressão" options={(plates.data || []).map(p => ({ id: p.id, label: p.label }))} />{plates.error && <p role="alert" className="text-destructive">Falha ao carregar placas. <button className="underline" onClick={() => plates.refetch()}>Tentar novamente</button></p>}<p className="text-xs text-muted-foreground">Uma placa pode produzir várias peças diferentes. Informe quantas unidades desta peça saem em cada impressão.</p></>}
        {printMode !== "later" && field("yield", "Quantas unidades desta peça saem nesta placa?", yieldValue, setYieldValue, true)}
        {printMode === "prepare" && <><p className="text-sm text-muted-foreground">Salva a placa e sua receita usando o consumo e o tempo desta peça × a quantidade por impressão. Selecione os filamentos do estoque na ficha acima.</p><SearchableItemSelect label="Impressora da placa da peça" value={printerId} onChange={setPrinterId} emptyLabel="Escolher impressora" options={(printers.data || []).map(p => ({ id: p.id, label: p.name }))} />{printers.error && <p role="alert" className="text-destructive">Não foi possível carregar as impressoras.</p>}{field("nonmaterial", "Demais custos por peça, sem filamento (R$)", nonMaterial, setNonMaterial, true)}<p className="text-xs text-muted-foreground">Confirme energia, máquina, acabamento e outros custos. Informe 0 se não houver. Uma nova placa é preparada; impressões antigas mantêm sua configuração.</p></>}
      </div>
    </>}
    </fieldset>
    {save.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{save.error.message}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar edição da peça</Button><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Salvando peça…" : "Salvar peça no produto"}</Button></div>
  </section>;
}
