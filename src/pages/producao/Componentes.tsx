import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { assemblyRows } from "@/lib/assembly";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { AssemblyWorkspace } from "@/components/production/AssemblyWorkspace";
export default function Componentes() {
  const { profile } = useAuth(); const [params, setParams] = useSearchParams(); const productId = params.get("produto") || "";
  const products = useQuery({ queryKey: ["products", "assembly", profile?.tenant_id], enabled: !!profile, queryFn: () => assemblyRows<{ id: string; name: string; assembly_enabled: boolean }>("products", "id,name,assembly_enabled", { tenant_id: profile!.tenant_id, is_active: true }, "name") });
  return <div className="space-y-5"><PageHeader title="Componentes e montagem" description="Produza partes em lotes independentes e monte somente quando todos os componentes estiverem disponíveis." breadcrumbs={[{ label: "Produção" }, { label: "Componentes e montagem" }]} />
    <div className="rounded-lg border bg-card p-4"><Label htmlFor="assembly-product">Produto vendido</Label><select id="assembly-product" className="mt-2 h-11 w-full rounded-md border bg-background px-3 text-sm" value={productId} onChange={e => setParams(e.target.value ? { produto: e.target.value } : {})}><option value="">Selecione o produto completo</option>{products.data?.map(p => <option key={p.id} value={p.id}>{p.name}{p.assembly_enabled ? "" : " · montagem não ativada"}</option>)}</select>{products.error && <p role="alert">{products.error.message}</p>}</div>
    {profile && productId && <AssemblyWorkspace key={productId} productId={productId} tenantId={profile.tenant_id} />}
  </div>;
}
