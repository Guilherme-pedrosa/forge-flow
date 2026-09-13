import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileBox, Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readJobProduction, prepareJobPrintFile, downloadJobPrintFile, filePreparationHint, type JobProductionReview } from "@/lib/production-files";
import { orderRequest } from "@/lib/sales-order";
import { productionQueryKeys } from "@/lib/production-api";

const quantity = (value: number | null) => value == null ? "Não informado" : value.toLocaleString("pt-BR");
const currency = (value: number | null) => value == null ? "Não apurado" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type PrinterOption = { id: string; name: string; model: string; status: string };

export function ProductionFileDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const review = useQuery({ queryKey: ["job_production_review", profile?.tenant_id, jobId], queryFn: () => readJobProduction(jobId), enabled: !!profile });
  const machines = useQuery({ queryKey: ["production_file_printers", profile?.tenant_id], enabled: !!profile, queryFn: async () => {
    const { data, error } = await supabase.from("printers").select("id,name,model,status").eq("is_active", true).order("name");
    if (error) throw error; return data;
  } });
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Arquivo e receita da ordem</DialogTitle><DialogDescription>{review.data?.code || "Preparação de produção"} · versão preservada para conferir antes de imprimir.</DialogDescription></DialogHeader>
    {review.isLoading || machines.isLoading ? <p className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" />Consultando preparação…</p> : review.error || machines.error ? <div role="alert" className="space-y-3 text-sm text-destructive"><p>{review.error?.message || machines.error?.message}</p><Button variant="outline" onClick={() => { review.refetch(); machines.refetch(); }}>Tentar novamente</Button></div> : review.data && profile ? <ProductionFileForm key={`${jobId}-${review.data.file?.captured_at ?? "initial"}`} review={review.data} printers={machines.data ?? []} tenantId={profile.tenant_id} onBusy={setBusy} onRefresh={() => review.refetch()} onClose={onClose} /> : null}
  </DialogContent></Dialog>;
}

export function ProductionFileForm({ review, printers, tenantId, onBusy, onRefresh, onClose }: {
  review: JobProductionReview; printers: PrinterOption[]; tenantId: string; onBusy: (busy: boolean) => void; onRefresh: () => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState(review.file?.id || (review.file_options.length === 1 ? review.file_options[0].id : ""));
  const [printerId, setPrinterId] = useState(review.printer?.id || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRef<ReturnType<typeof orderRequest> | null>(null);
  const saving = (value: boolean) => { setBusy(value); onBusy(value); };
  const save = async () => {
    setError(""); setSaved(false); saving(true);
    try {
      request.current = orderRequest(request.current, JSON.stringify({ jobId: review.job_id, sourceId, printerId, reason: reason.trim() }));
      await prepareJobPrintFile(review.job_id, sourceId, printerId, reason, request.current.id);
      [...productionQueryKeys, "job_production_review"].forEach(key => qc.invalidateQueries({ queryKey: [key] }));
      setSaved(true); onRefresh();
    } catch (caught) { setError((caught as Error).message); }
    finally { saving(false); }
  };
  const download = async () => {
    if (!review.file) return;
    setError(""); saving(true);
    try { await downloadJobPrintFile(review.file, tenantId); }
    catch (caught) { setError((caught as Error).message); }
    finally { saving(false); }
  };
  return <div className="space-y-5 min-w-0">
    <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
      <p className="font-medium">{review.origin === "approved_order" ? "Receita preservada do pedido aprovado" : review.origin === "reprint" ? "Receita preservada da ordem original" : review.origin === "catalog" ? "Receita preservada na criação da ordem" : "Ordem sem receita congelada"}</p>
      {review.plate && <p>Placa {review.plate.plate_index} · {review.plate.label}</p>}
      <p>{quantity(review.planned_quantity)} unidade(s) planejada(s) · {currency(review.est_total_cost)} previsto.</p>
      <p className="text-xs text-muted-foreground">Alterar o catálogo depois não substitui os materiais, cores e custos desta ordem. O saldo abaixo é atual e ainda não está reservado.</p>
    </div>
    <section className="space-y-3"><h3 className="font-semibold">Materiais e cores da receita</h3>
      {!review.requirements.length ? <p className="text-sm text-muted-foreground">Receita não identificada para esta ordem.</p> : review.requirements.map((line, index) => <div key={`${line.item_id}-${index}`} className="rounded-lg border p-3 space-y-1 text-sm">
        <p className="font-medium break-words">{line.name || line.item_name || "Material da receita"}</p>
        <p className="text-muted-foreground">{[...new Set([line.material_type, line.material_code, line.color, line.color_code].filter(Boolean))].join(" · ") || "Material/cor precisam de identificação"}</p>
        <p>{quantity(line.required_grams)} g previstos · saldo {quantity(line.current_stock_grams)} g</p>
        <p className="text-xs text-muted-foreground">Item exato do estoque · {line.recipe_version ? `receita v${line.recipe_version}` : "versão preservada"}</p>
      </div>)}
    </section>
    {review.manual_accounting_supported === false && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Esta receita tem três ou mais materiais. Registre o consumo de todos os filamentos pela apuração Bambu. A conclusão manual aceita até dois materiais e não pode registrar esta receita por completo.</p>}
    <section className="space-y-3"><h3 className="flex items-center gap-2 font-semibold"><FileBox className="h-4 w-4" />Arquivo desta execução</h3>
      {review.file ? <div className="rounded-xl border p-4 space-y-3">
        <p className="font-medium break-all">{review.file.file_name || "Arquivo preservado"}</p>
        <p className="text-sm text-muted-foreground">{filePreparationHint(review.file.file_name)}</p>
        {review.file.origin === "file_added_after_recipe" && <p className="text-xs text-muted-foreground">Arquivo associado após a receita, com justificativa registrada. A receita aprovada foi preservada.</p>}
        <Button variant="outline" className="h-auto max-w-full whitespace-normal py-2" disabled={busy} onClick={download}><Download className="mr-2 h-4 w-4 shrink-0" />Baixar arquivo privado</Button>
      </div> : <div className="rounded-xl border border-dashed p-4 space-y-3"><p className="text-sm">Nenhum arquivo definido para esta placa.</p>{!review.file_options.length && <Button variant="outline" asChild><Link to="/comercial/produtos">Cadastrar arquivo no produto</Link></Button>}</div>}
    </section>
    {review.issues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm space-y-2"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 shrink-0" />Pendências de preparação</p><ul className="list-disc pl-5 space-y-1">{review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}
    <div className="rounded-xl bg-muted/40 p-4 text-sm space-y-2"><p className="flex items-center gap-2 font-medium"><Printer className="h-4 w-4" />Envio pelo Bambu Studio ou Connect</p><p>Baixe o arquivo, confira a placa e os filamentos na máquina indicada e envie pelo software Bambu. O ERP não possui envio direto configurado.</p><p className="text-xs text-muted-foreground">A compatibilidade do fatiamento, do bico e do mapeamento AMS deve ser conferida no software Bambu. Preparar ou baixar aqui não inicia a impressora.</p></div>
    {review.can_prepare && review.file_options.length > 0 && <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border p-4">
      <legend className="px-1 text-sm font-semibold">Preparar arquivo e impressora</legend>
      <div className="space-y-1.5"><Label htmlFor="prepare-print-source">Versão do arquivo</Label><Select value={sourceId} onValueChange={setSourceId} disabled={!!review.file || busy}><SelectTrigger id="prepare-print-source"><SelectValue placeholder="Selecione a versão" /></SelectTrigger><SelectContent>{review.file_options.map(file => <SelectItem key={file.id} value={file.id}>{file.file_name || file.label || "Arquivo de impressão"}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="prepare-print-printer">Impressora</Label><Select value={printerId} onValueChange={setPrinterId} disabled={busy}><SelectTrigger id="prepare-print-printer"><SelectValue placeholder="Selecione a impressora" /></SelectTrigger><SelectContent>{printers.map(machine => <SelectItem key={machine.id} value={machine.id} disabled={["maintenance", "offline", "error"].includes(machine.status)}>{machine.name} · {machine.model}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="prepare-print-reason">Justificativa da preparação</Label><Input id="prepare-print-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: arquivo da placa conferido para esta máquina" /></div>
      <Button disabled={busy} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar preparação</Button>
    </fieldset>}
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="text-sm text-emerald-700">Preparação salva. Nenhum comando foi enviado à impressora.</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button></DialogFooter>
  </div>;
}
