import { useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import type { JobTransition } from "@/lib/production-api";
import { nonNegative, requiresProductionMeasurement, type JobStatus } from "@/lib/production";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ProductionTransitionDialog({ value, printers, pending, onClose, onSave }: {
  value: { job: Tables<"jobs">; status: JobStatus };
  printers: Pick<Tables<"printers">, "id" | "name" | "status">[];
  pending: boolean; onClose: () => void; onSave: (value: JobTransition) => void;
}) {
  const { job, status } = value;
  const measured = requiresProductionMeasurement(status, (job as unknown as { inventory_posted_at?: string }).inventory_posted_at);
  const secondary = !!job.secondary_material_id && job.secondary_material_id !== job.material_id;
  const [grams, setGrams] = useState(job.actual_grams?.toString() ?? "");
  const [minutes, setMinutes] = useState(job.actual_time_minutes?.toString() ?? "");
  const [waste, setWaste] = useState(job.waste_grams?.toString() ?? "0");
  const [secondaryGrams, setSecondaryGrams] = useState("");
  const [labor, setLabor] = useState(job.actual_labor_cost?.toString() ?? "");
  const [overhead, setOverhead] = useState(job.actual_overhead?.toString() ?? "");
  const [extrasCost, setExtrasCost] = useState((job as unknown as { actual_extras_cost?: number }).actual_extras_cost?.toString() ?? "");
  const [reason, setReason] = useState(job.failure_reason ?? "");
  const [printerId, setPrinterId] = useState(job.printer_id ?? "");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    try {
      if (!printerId) throw new Error("Selecione a impressora utilizada.");
      const input: JobTransition = { id: job.id, status, printerId: printerId !== job.printer_id ? printerId : undefined };
      if (measured) {
        if (grams === "" || minutes === "" || labor === "" || overhead === "" || extrasCost === "") throw new Error("Preencha os dados reais. Informe zero para custos que não se aplicam.");
        input.actualGrams = nonNegative(grams, "Consumo real");
        input.actualMinutes = nonNegative(minutes, "Tempo real");
        input.wasteGrams = nonNegative(waste, "Perda medida");
        input.actualLaborCost = nonNegative(labor, "Mão de obra");
        input.actualOverhead = nonNegative(overhead, "Custos indiretos");
        input.actualExtrasCost = nonNegative(extrasCost, "Acessórios e embalagem");
        if (input.actualMinutes <= 0 || !Number.isInteger(input.actualMinutes)) throw new Error("Informe o tempo real em minutos inteiros, maior que zero.");
        if (input.wasteGrams > input.actualGrams) throw new Error("A perda é parte do consumo total e não pode ser maior que ele.");
        if (secondary) {
          if (secondaryGrams === "") throw new Error("Informe quanto do consumo total veio do material secundário.");
          input.secondaryActualGrams = nonNegative(secondaryGrams, "Material secundário");
          if (input.secondaryActualGrams > input.actualGrams) throw new Error("O material secundário não pode exceder o consumo total.");
        }
      }
      if (status === "failed" && !reason.trim()) throw new Error("Informe o motivo da falha.");
      input.failureReason = reason.trim() || undefined;
      setError(""); onSave(input);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confira os dados informados."); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
      <form onSubmit={submit} className="space-y-5">
        <DialogHeader>
          <DialogTitle>{status === "failed" ? "Registrar falha e consumo" : measured ? "Apurar execução da impressão" : "Iniciar ordem de impressão"}</DialogTitle>
          <DialogDescription>{job.code} · {job.name}. {measured ? "O lançamento registra custos e estoque na mesma operação, antes de avançar de etapa." : status === "failed" ? "Os custos já apurados serão preservados; registre a causa encontrada no controle de qualidade." : "Atualiza a fila do ERP. A impressão deve ser iniciada no equipamento ou no fatiador."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="transition-printer">Impressora utilizada</Label>
          <Select value={printerId} onValueChange={setPrinterId} disabled={pending || (!!job.printer_id && !["draft", "queued", "reprint"].includes(job.status))}>
            <SelectTrigger id="transition-printer"><SelectValue placeholder="Selecione a impressora" /></SelectTrigger>
            <SelectContent>{printers.map(printer => <SelectItem key={printer.id} value={printer.id} disabled={!measured && ["maintenance", "offline", "error"].includes(printer.status)}>{printer.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {measured && <>
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Consumo total = todo o material usado, incluindo purga, suportes e perdas. Informe a medição do fatiador ou da balança. Estimativa da ordem: {job.est_grams ?? "—"} g · {job.est_time_minutes ?? "—"} min.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="actual-grams">Consumo total real (g)</Label><Input id="actual-grams" inputMode="decimal" type="number" min="0" step="0.01" value={grams} onChange={e => setGrams(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="actual-minutes">Tempo real (minutos)</Label><Input id="actual-minutes" inputMode="decimal" type="number" min="1" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="actual-waste">Desse total, perda (g)</Label><Input id="actual-waste" inputMode="decimal" type="number" min="0" step="0.01" value={waste} onChange={e => setWaste(e.target.value)} required /></div>
            {secondary && <div className="space-y-2"><Label htmlFor="secondary-grams">Desse total, material secundário (g)</Label><Input id="secondary-grams" inputMode="decimal" type="number" min="0" step="0.01" value={secondaryGrams} onChange={e => setSecondaryGrams(e.target.value)} required /></div>}
            <div className="space-y-2"><Label htmlFor="actual-labor">Mão de obra real (R$)</Label><Input id="actual-labor" inputMode="decimal" type="number" min="0" step="0.01" value={labor} onChange={e => setLabor(e.target.value)} placeholder="0,00" required /></div>
            <div className="space-y-2"><Label htmlFor="actual-overhead">Custos indiretos reais (R$)</Label><Input id="actual-overhead" inputMode="decimal" type="number" min="0" step="0.01" value={overhead} onChange={e => setOverhead(e.target.value)} placeholder="0,00" required /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="actual-extras">Acessórios e embalagem (R$)</Label><Input id="actual-extras" inputMode="decimal" type="number" min="0" step="0.01" value={extrasCost} onChange={event => setExtrasCost(event.target.value)} placeholder="0,00" required /><p className="text-xs text-muted-foreground">Materiais comprados à parte, como caixas, ímãs ou chocolates. Não inclua novamente o filamento. Informe zero quando não se aplicar.</p></div>
          </div>
        </>}
        {status === "failed" && <div className="space-y-2"><Label htmlFor="failure-reason">Motivo da falha</Label><Textarea id="failure-reason" value={reason} onChange={e => setReason(e.target.value)} required placeholder="Ex.: descolamento da mesa após 40 minutos" /></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? "Registrando..." : measured ? "Confirmar apuração" : status === "failed" ? "Registrar falha" : "Iniciar no ERP"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
