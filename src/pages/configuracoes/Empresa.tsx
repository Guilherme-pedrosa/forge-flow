import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Empresa() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [energyCostKwh, setEnergyCostKwh] = useState("");
  const [laborCostHour, setLaborCostHour] = useState("");
  const [overheadPercent, setOverheadPercent] = useState("");
  const [targetMargin, setTargetMargin] = useState("");

  const parseLocaleNumber = (value: string) => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return 0;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  const { data: tenant, isLoading } = useQuery({
    queryKey: ["tenant"],
    queryFn: async () => {
      if (!profile) return null;
      const { data, error } = await supabase.from("tenants").select("*").eq("id", profile.tenant_id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setCurrency(tenant.currency);
      setTimezone(tenant.timezone);
      const s = tenant.settings as any || {};
      setEnergyCostKwh(s.energy_cost_kwh?.toString() || "");
      setLaborCostHour(s.labor_cost_hour?.toString() || "");
      setOverheadPercent(s.overhead_percent?.toString() || "");
      setTargetMargin(s.target_margin?.toString() || "");
    }
  }, [tenant]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const settings = {
        ...((tenant?.settings as any) || {}),
        energy_cost_kwh: parseLocaleNumber(energyCostKwh),
        labor_cost_hour: parseLocaleNumber(laborCostHour),
        overhead_percent: parseLocaleNumber(overheadPercent),
        target_margin: parseLocaleNumber(targetMargin),
      };
      const { data, error } = await supabase
        .from("tenants")
        .update({ name, currency, timezone, settings })
        .eq("id", profile.tenant_id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Sem permissão para salvar configurações da empresa.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tenant"] }); toast({ title: "Configurações salvas" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Configurações da Empresa" description="Parâmetros gerais do ERP"
        breadcrumbs={[{ label: "Configurações" }, { label: "Empresa" }]}
        actions={<Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Salvar</Button>}
      />

      <div className="grid gap-6 max-w-2xl">
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Dados da Empresa</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Moeda</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div className="col-span-2"><Label>Fuso Horário</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Custos de Produção</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Custo Energia (R$/kWh)</Label><Input type="number" step="0.01" value={energyCostKwh} onChange={(e) => setEnergyCostKwh(e.target.value)} placeholder="0.85" /></div>
            <div><Label>Custo Mão de Obra (R$/h)</Label><Input type="number" step="0.01" value={laborCostHour} onChange={(e) => setLaborCostHour(e.target.value)} placeholder="25.00" /></div>
            <div><Label>Overhead (%)</Label><Input type="number" step="0.1" value={overheadPercent} onChange={(e) => setOverheadPercent(e.target.value)} placeholder="15" /></div>
            <div><Label>Margem Alvo (%)</Label><Input type="number" step="0.1" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} placeholder="40" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
