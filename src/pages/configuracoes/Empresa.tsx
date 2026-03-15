import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, Save, Upload, Building2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Empresa() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [energyCostKwh, setEnergyCostKwh] = useState("");
  const [laborCostHour, setLaborCostHour] = useState("");
  const [overheadPercent, setOverheadPercent] = useState("");
  const [targetMargin, setTargetMargin] = useState("");

  // Company details stored in settings
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);

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
      setLogoPreview(tenant.logo_url || null);
      const s = (tenant.settings as any) || {};
      setEnergyCostKwh(s.energy_cost_kwh?.toString() || "");
      setLaborCostHour(s.labor_cost_hour?.toString() || "");
      setOverheadPercent(s.overhead_percent?.toString() || "");
      setTargetMargin(s.target_margin?.toString() || "");
      setCnpj(s.cnpj || "");
      setPhone(s.phone || "");
      setEmail(s.email || "");
      setStreet(s.address?.street || "");
      setNumber(s.address?.number || "");
      setComplement(s.address?.complement || "");
      setNeighborhood(s.address?.neighborhood || "");
      setCity(s.address?.city || "");
      setState(s.address?.state || "");
      setZip(s.address?.zip || "");
    }
  }, [tenant]);

  const lookupCnpj = async () => {
    const clean = cnpj.replace(/\D/g, "");
    if (clean.length !== 14) {
      toast({ title: "CNPJ inválido", description: "Informe 14 dígitos", variant: "destructive" });
      return;
    }
    setLookingUpCnpj(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
      if (!res.ok) throw new Error("CNPJ não encontrado");
      const d = await res.json();
      if (d.razao_social) setName(d.razao_social);
      if (d.email) setEmail(d.email);
      if (d.ddd_telefone_1) setPhone(d.ddd_telefone_1);
      if (d.logradouro) setStreet(d.logradouro);
      if (d.numero) setNumber(d.numero);
      if (d.complemento) setComplement(d.complemento);
      if (d.bairro) setNeighborhood(d.bairro);
      if (d.municipio) setCity(d.municipio);
      if (d.uf) setState(d.uf);
      if (d.cep) setZip(d.cep);
      toast({ title: "CNPJ encontrado", description: d.razao_social });
    } catch (e: any) {
      toast({ title: "Erro na consulta", description: e.message, variant: "destructive" });
    } finally {
      setLookingUpCnpj(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");

      let logo_url = tenant?.logo_url || null;

      // Upload logo if changed
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `${profile.tenant_id}/logo.${ext}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, logoFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("attachments").getPublicUrl(path);
        logo_url = urlData.publicUrl;
      }

      const settings = {
        ...((tenant?.settings as any) || {}),
        energy_cost_kwh: parseLocaleNumber(energyCostKwh),
        labor_cost_hour: parseLocaleNumber(laborCostHour),
        overhead_percent: parseLocaleNumber(overheadPercent),
        target_margin: parseLocaleNumber(targetMargin),
        cnpj,
        phone,
        email,
        address: { street, number, complement, neighborhood, city, state, zip },
      };
      const { data, error } = await supabase
        .from("tenants")
        .update({ name, currency, timezone, settings, logo_url })
        .eq("id", profile.tenant_id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Sem permissão para salvar configurações da empresa.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant"] });
      setLogoFile(null);
      toast({ title: "Configurações salvas" });
    },
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
        {/* Logo */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Building2 className="h-4 w-4" /> Logo da Empresa</h3>
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden bg-muted/30">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> Enviar Logo
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG ou JPG, máx. 2MB</p>
            </div>
          </div>
        </div>

        {/* Company data */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Dados da Empresa</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Label>CNPJ</Label>
              <div className="flex gap-2">
                <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                <Button variant="outline" size="icon" onClick={lookupCnpj} disabled={lookingUpCnpj} title="Consultar CNPJ">
                  {lookingUpCnpj ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div><Label>Nome / Razão Social</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@empresa.com" /></div>
            <div><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" /></div>
            <div><Label>Moeda</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div><Label>Fuso Horário</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
          </div>
        </div>

        {/* Address */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Endereço</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-1"><Label>CEP</Label><Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="00000-000" /></div>
            <div className="col-span-1"><Label>UF</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} /></div>
            <div className="col-span-2"><Label>Rua</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} /></div>
            <div><Label>Número</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div><Label>Complemento</Label><Input value={complement} onChange={(e) => setComplement(e.target.value)} /></div>
            <div><Label>Bairro</Label><Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} /></div>
            <div><Label>Cidade</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          </div>
        </div>

        {/* Production costs */}
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
