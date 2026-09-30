import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { assemblyRows } from "@/lib/assembly";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { AssemblyWorkspace } from "@/components/production/AssemblyWorkspace";
export default function Componentes() {
  const { profile } = useAuth(); const [params, setParams] = useSearchParams(); const productId = params.get("produto") || "";
  const products = useQuery({ queryKey: ["products", "assembly", profile?.tenant_id], enabled: !!profile, queryFn: () => assemblyRows<{ id: string; name: string; sku: string | null; assembly_enabled: boolean }>("products", "id,name,sku,assembly_enabled", { tenant_id: profile!.tenant_id, is_active: true, is_component: false }, "name") });
  return <div className="space-y-5"><PageHeader title="Componentes e montagem" description="Produza partes em lotes independentes e monte somente quando todos os componentes estiverem disponíveis." breadcrumbs={[{ label: "Produção" }, { label: "Componentes e montagem" }]} />
    <div className="rounded-lg border bg-card p-4"><Label htmlFor="assembly-product">Produto vendido</Label><div className="mt-2"><SearchableItemSelect id="assembly-product" label="Produto vendido" value={productId} onChange={value => setParams(value ? { produto: value } : {})} emptyLabel="Selecione o produto completo" searchPlaceholder="Digite nome ou SKU do produto…" options={(products.data || []).map(p => ({ id: p.id, label: p.name, description: [p.sku, p.assembly_enabled ? "" : "Montagem não ativada"].filter(Boolean).join(" · ") }))} /></div>{products.error && <p role="alert">{products.error.message}</p>}</div>
    {profile && productId && <AssemblyWorkspace key={productId} productId={productId} tenantId={profile.tenant_id} />}
  </div>;
}
