import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Edit, Loader2, Plus, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { allRows, currency } from "@/lib/finance";
import { invalidateInventoryPricing } from "@/lib/inventory-cache";
import type { FilamentRegistrationItem } from "@/lib/filament-registration";
import { materialColorSwatch } from "@/lib/material-identity";
import { FilamentRegistration } from "@/components/estoque/FilamentRegistration";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FilamentSpools = lazy(() => import("./FilamentSpools"));

export default function Bobinas() {
  const { profile } = useAuth(); const { toast } = useToast(); const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ item: FilamentRegistrationItem | null } | null>(null);
  const [physicalVisited, setPhysicalVisited] = useState(false);
  const query = useQuery({ queryKey: ["inventory_items", profile?.tenant_id, "filaments"], enabled: !!profile?.tenant_id,
    queryFn: () => allRows((from, to) => supabase.from("inventory_items").select("*")
      .eq("tenant_id", profile!.tenant_id).eq("category", "filament").eq("is_active", true)
      .in("unit", ["g", "kg"]).order("name").order("id").range(from, to)) });
  const requested = params.get("novo") === "1";
  useEffect(() => {
    if (!requested) return;
    setEditor({ item: null });
    setParams(previous => { const next = new URLSearchParams(previous); next.delete("novo"); return next; }, { replace: true });
  }, [requested, setParams]);
  const items = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (query.data ?? []).filter(item => !term || [item.name, item.material_code, item.color, item.brand]
      .some(value => value?.toLocaleLowerCase("pt-BR").includes(term)));
  }, [query.data, search]);
  async function saved() {
    setEditor(null); await invalidateInventoryPricing(qc);
    toast({ title: "Filamento salvo", description: "O cadastro e o saldo estão disponíveis no estoque e na precificação." });
  }
  return <div className="space-y-5">
    <PageHeader title="Filamentos" description="Cadastre cada material e cor. Controle o saldo manualmente ou pelas compras recebidas."
      actions={<><Button variant="outline" asChild><Link to="/estoque/compras">Compras</Link></Button><Button onClick={() => setEditor({ item: null })}><Plus className="mr-2 h-4 w-4" />Novo filamento</Button></>} />
    <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">Cada cor tem seu próprio saldo e custo. Use <strong>Editar</strong> para informar a quantidade disponível. As compras recebidas somam ao estoque e atualizam o custo médio automaticamente.</div>
    <div className="relative max-w-lg"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar filamento" className="pl-9" placeholder="Buscar por material, cor ou marca…" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {query.isPending ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando filamentos…</p>
      : query.error ? <div role="alert" className="rounded-xl border p-4">Não foi possível carregar os filamentos. <Button variant="link" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
        : <section aria-label="Estoque de filamentos" className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-left text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-4">Filamento / cor</th><th className="p-4">Marca</th><th className="p-4 text-right">Estoque</th><th className="p-4 text-right">Custo médio / kg</th><th className="p-4"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{items.map(item => <tr key={item.id} className="border-t"><td className="p-4"><div className="flex items-center gap-2">{item.color_hex && <span className="h-5 w-5 shrink-0 rounded-full border" style={{ backgroundColor: materialColorSwatch(item.color_hex) }} />}<div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{[item.material_code, item.color].filter(Boolean).join(" · ")}</p></div></div></td>
              <td className="p-4">{item.brand || "—"}</td><td className="whitespace-nowrap p-4 text-right">{(Number(item.current_stock) / (item.unit === "g" ? 1000 : 1)).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} kg</td>
              <td className="whitespace-nowrap p-4 text-right">{Number(item.avg_cost) > 0 ? currency(Number(item.avg_cost) * (item.unit === "g" ? 1000 : 1)) : "A informar"}</td>
              <td className="p-4 text-right"><Button size="sm" variant="outline" aria-label={`Editar ${item.name}`} onClick={() => setEditor({ item })}><Edit className="mr-2 h-4 w-4" />Editar</Button></td></tr>)}</tbody>
          </table>{!items.length && <p className="p-8 text-center text-muted-foreground">{search ? "Nenhum filamento encontrado." : "Cadastre o primeiro filamento por material e cor. O saldo pode ser informado agora ou entrar por uma compra."}</p>}
        </section>}
    <details className="rounded-xl border bg-card p-4" onToggle={event => { if (event.currentTarget.open) setPhysicalVisited(true); }}><summary className="cursor-pointer text-sm font-medium">Controle de bobinas e localização (opcional)</summary>
      {physicalVisited && <div className="mt-5"><Suspense fallback={<p role="status">Carregando controle físico…</p>}><FilamentSpools /></Suspense></div>}
    </details>
    {editor && <FilamentRegistration key={editor.item?.id ?? "new"} item={editor.item} onClose={() => setEditor(null)} onSaved={saved} />}
  </div>;
}
