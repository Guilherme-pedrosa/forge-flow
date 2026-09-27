import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assemblyKeys, assemblyRpc, readAssemblyStatus } from "@/lib/assembly";
import { positiveInteger } from "@/lib/production";
import { orderRequest } from "@/lib/sales-order";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImportedModelImage } from "@/components/comercial/ImportedModelImage";
export default function ProductAssemblySetup({ productId, tenantId, onBusyChange, onDraftChange }: { productId: string; tenantId: string; onBusyChange?: (value: boolean) => void; onDraftChange?: (value: boolean) => void }) {
  const { toast } = useToast(); const qc = useQueryClient(); const [adding, setAdding] = useState(false); const [name, setName] = useState(""); const [yieldValue, setYield] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const status = useQuery({ queryKey: ["assembly_status", tenantId, productId, "setup"], queryFn: () => readAssemblyStatus(productId, 1) });
  const operation = useMutation({ mutationFn: async (action: "toggle" | "add") => {
    if (action === "toggle") return assemblyRpc("configure_product_assembly", { p_product_id: productId, p_enabled: !status.data?.enabled });
    if (!name.trim()) throw new Error("Informe o nome do componente.");
    const units = yieldValue.trim() ? positiveInteger(yieldValue, "Rendimento por impressão", 10000) : null;
    request.current = orderRequest(request.current, JSON.stringify([productId, name.trim(), units]));
    return assemblyRpc("add_product_component", { p_product_id: productId, p_label: name.trim(), p_units: units, p_request_id: request.current.id });
  }, onSuccess: async (_, action) => { if (action === "add") { setAdding(false); setName(""); setYield(""); request.current = null; } await Promise.all(assemblyKeys.map(key => qc.invalidateQueries({ queryKey: [key] }))); toast({ title: action === "add" ? "Componente cadastrado; prepare os materiais na placa abaixo" : "Controle de montagem atualizado" }); }, onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }) });
  useEffect(() => { onBusyChange?.(operation.isPending); return () => onBusyChange?.(false); }, [operation.isPending, onBusyChange]);
  useEffect(() => { onDraftChange?.(adding); return () => onDraftChange?.(false); }, [adding, onDraftChange]);
  return <section aria-label="Configurar componentes e montagem" className="space-y-3 rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">Produto composto de partes impressas</h3><p className="text-sm text-muted-foreground">Cada conjunto tem suas peças, lotes e saldo. A montagem consome um conjunto de cada componente para formar o produto final.</p>
    {status.error && <p role="alert">{status.error.message}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant={status.data?.enabled ? "outline" : "default"} disabled={operation.isPending || !status.data?.components.length} onClick={() => operation.mutate("toggle")}>{status.data?.enabled ? "Desativar controle de montagem" : "Ativar controle de montagem"}</Button><Button type="button" variant="outline" disabled={operation.isPending} onClick={() => setAdding(!adding)}>Adicionar componente</Button>{status.data?.enabled && <Button variant="outline" asChild><Link to={`/producao/componentes?produto=${productId}`}>Gerenciar lotes e montagem</Link></Button>}</div>
    {!!status.data?.components.length && <p className="text-sm">Composição: {status.data.components.map(part => part.label).join(" + ")}.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{status.data?.components.filter(part => part.parts?.length).map(part => <article key={part.plate_id} className="rounded-lg border bg-background p-3"><ImportedModelImage src={part.photo_url || null} alt={part.label} className="h-28 w-full object-contain" /><h4 className="mt-2 font-medium">{part.label}</h4><ul className="mt-1 text-sm text-muted-foreground">{part.parts!.map((piece, index) => <li key={index}>{piece.quantity_per_product != null ? `${piece.quantity_per_product} × ` : ""}{piece.name}{piece.name_source === "unknown" ? " · nome não informado pelo autor" : ""}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Placa {part.plate_index} · {part.units_per_print == null ? "Rendimento a confirmar" : `${part.units_per_print} produto(s) por impressão`}</p></article>)}</div>
    {adding && <div className="space-y-3 border-t pt-3"><div><Label htmlFor="component-name">Nome do componente</Label><Input id="component-name" placeholder="Ex.: corpo da maçã, caule, folha" value={name} onChange={e => setName(e.target.value)} /></div><div><Label htmlFor="component-yield">Quantos produtos esta placa atende por impressão?</Label><Input id="component-yield" type="number" min={1} placeholder="Ex.: 20 caules atendem 20 maçãs" value={yieldValue} onChange={e => setYield(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Pode deixar em branco e preparar depois. Para 10 pares de metades, informe 10.</p></div><Button type="button" disabled={operation.isPending} onClick={() => operation.mutate("add")}>Salvar componente</Button></div>}
  </section>;
}
