import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { marketplaceDb, marketplaceRpc } from "@/lib/marketplace-orders";

type ProductOption = { id: string; name: string; sku: string | null };
type Binding = { id: string; external_item_id: string; external_variant_id: string; external_sku: string; product_id: string; requires_manual_review: boolean };
type Draft = Omit<Binding, "id">;
type Props = {
  accountId: string;
  tenantId: string;
  productOptions: ProductOption[];
  catalogLoading?: boolean;
  catalogError?: string | null;
  onCatalogRetry?: () => void;
};
const emptyDraft = (): Draft => ({ external_item_id: "", external_variant_id: "", external_sku: "", product_id: "", requires_manual_review: false });
const pageSize = 20;
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Confira o acesso e tente novamente.";

// A new account gets a fresh form, page and mutation state. A late response from
// the previous account cannot replace this account's draft or error message.
export function MarketplaceBindings(props: Props) {
  return <AccountBindings key={`${props.tenantId}:${props.accountId}`} {...props} />;
}

function AccountBindings({ accountId, tenantId, productOptions, catalogLoading = false, catalogError, onCatalogRetry }: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<Binding | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const bindings = useQuery({
    queryKey: ["marketplace_sku_bindings", tenantId, accountId, page],
    enabled: !!tenantId && !!accountId,
    queryFn: async () => {
      const read = (columns: string) => marketplaceDb.from("marketplace_sku_bindings")
        .select(columns, { count: "exact" })
        .eq("tenant_id", tenantId).eq("account_id", accountId)
        .order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      const legacyColumns = "id,external_item_id,external_variant_id,external_sku,product_id";
      let response = await read(`${legacyColumns},requires_manual_review`);
      let reviewAvailable = true;
      if (response.error && isMissingDatabaseStructure(response.error)) {
        response = await read(legacyColumns);
        reviewAvailable = false;
      }
      if (response.error) throw response.error;
      return { rows: (response.data ?? []) as unknown as Binding[], count: response.count, reviewAvailable };
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      // On an edit, use the stored identity, even if a form control was changed
      // outside the UI. This action corrects the destination, not the identity.
      const identity = editing ?? draft;
      const item = identity.external_item_id.trim(), variant = identity.external_variant_id.trim(), sku = identity.external_sku.trim();
      if (!item && !sku) throw new Error("Informe o anúncio ou o SKU externo do vínculo.");
      if ([item, variant, sku].some(value => value.length > 160)) throw new Error("Use até 160 caracteres em cada identificação externa.");
      if (!productOptions.some(product => product.id === draft.product_id)) throw new Error("Selecione um produto ativo no ERP.");
      if (!editing) {
        // The save RPC is an upsert. A duplicate creation must not silently
        // change an existing product or clear its personalisation requirement.
        const { data: existing, error } = await marketplaceDb.from("marketplace_sku_bindings").select(bindings.data?.reviewAvailable ? "id,product_id,requires_manual_review" : "id,product_id")
          .eq("tenant_id", tenantId).eq("account_id", accountId)
          .eq("external_item_id", item).eq("external_variant_id", variant).eq("external_sku", sku).maybeSingle();
        if (error) throw error;
        if (existing) {
          const current = existing as unknown as Pick<Binding, "product_id" | "requires_manual_review">;
          // A timed-out save may already have committed. The intended state is
          // confirmed without changing a duplicate or clearing another flag.
          if (current.product_id === draft.product_id && (!bindings.data?.reviewAvailable || current.requires_manual_review === draft.requires_manual_review)) return;
          throw new Error("Já existe um vínculo com esta identidade. Use Corrigir produto para alterar o destino ou a conferência.");
        }
      }
      await marketplaceRpc("save_marketplace_sku_binding", {
        p_account_id: accountId, p_external_item_id: item, p_external_variant_id: variant,
        p_external_sku: sku, p_product_id: draft.product_id,
        // Preserve a concurrent review requirement on a new unchecked binding;
        // clearing that requirement is an explicit edit of an existing binding.
        ...(bindings.data?.reviewAvailable ? { p_requires_manual_review: editing || draft.requires_manual_review ? draft.requires_manual_review : null } : {}),
      });
    },
    onSuccess: () => {
      setSaveError(""); setSaved(true); setEditing(null); setDraft(emptyDraft());
      void qc.invalidateQueries({ queryKey: ["marketplace_sku_bindings", tenantId, accountId] });
      void qc.invalidateQueries({ queryKey: ["marketplace_review_bindings", tenantId, accountId] });
      void qc.invalidateQueries({ queryKey: ["marketplace_orders", accountId] });
    },
    onError: error => { setSaveError(errorMessage(error)); setSaved(false); },
  });
  const patch = (change: Partial<Draft>) => { setDraft(current => ({ ...current, ...change })); setSaveError(""); setSaved(false); };
  function edit(row: Binding) {
    setEditing(row); setDraft({ external_item_id: row.external_item_id, external_variant_id: row.external_variant_id, external_sku: row.external_sku, product_id: row.product_id, requires_manual_review: row.requires_manual_review ?? false });
    setSaveError(""); setSaved(false);
  }
  function cancelEdit() { setEditing(null); setDraft(emptyDraft()); setSaveError(""); setSaved(false); }
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  if (bindings.error && isMissingDatabaseStructure(bindings.error)) return <section aria-label="Vínculos de anúncios" className="rounded-xl border bg-card p-4 space-y-2">
    <h2 className="font-semibold">Vínculos de anúncios</h2>
    <p role="status" className="text-sm text-muted-foreground">O cadastro de vínculos ainda precisa ser ativado no banco.</p>
    <Button variant="outline" onClick={() => void bindings.refetch()}>Verificar ativação</Button>
  </section>;
  const busy = save.isPending || bindings.isLoading || !!bindings.error || catalogLoading || !!catalogError || !tenantId || !accountId;
  const rows = bindings.data?.rows ?? [];
  const total = bindings.data?.count;
  const hasNext = total == null ? rows.length === pageSize : (page + 1) * pageSize < total;
  return <section aria-label="Vínculos de anúncios" className="rounded-xl border bg-card p-4 space-y-4">
    <div className="space-y-1"><h2 className="font-semibold">Vínculos de anúncios</h2>
      <p className="text-sm text-muted-foreground">Vincule anúncios, variações e SKUs desta conta aos produtos do ERP antes da primeira venda. Preencha a identidade que aparece nos pedidos; o vínculo usa a combinação exata dos três campos.</p>
    </div>
    {bindings.error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">Não foi possível carregar os vínculos. {errorMessage(bindings.error)} <Button variant="outline" onClick={() => void bindings.refetch()}>Tentar novamente</Button></div>}
    {catalogError && <div role="alert" className="text-sm text-destructive">Não foi possível carregar os produtos. {catalogError}{onCatalogRetry && <Button variant="outline" onClick={onCatalogRetry}>Recarregar produtos</Button>}</div>}
    {bindings.data && !bindings.data.reviewAvailable && <p role="status" className="text-sm text-muted-foreground">A exigência de conferência dos vínculos ficará disponível após sua ativação no banco. O vínculo de produto continua disponível.</p>}
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">{editing ? "Corrigir produto de destino" : "Cadastrar vínculo antes da venda"}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="binding-item">Anúncio</Label><Input id="binding-item" maxLength={160} value={draft.external_item_id} disabled={!!editing} onChange={event => patch({ external_item_id: event.target.value })} /></div>
          <div><Label htmlFor="binding-variant">Variação</Label><Input id="binding-variant" maxLength={160} value={draft.external_variant_id} disabled={!!editing} onChange={event => patch({ external_variant_id: event.target.value })} /></div>
          <div><Label htmlFor="binding-sku">SKU externo</Label><Input id="binding-sku" maxLength={160} value={draft.external_sku} disabled={!!editing} onChange={event => patch({ external_sku: event.target.value })} /></div>
          <div><Label htmlFor="binding-product">Produto no ERP</Label><select id="binding-product" className={selectClass} value={draft.product_id} onChange={event => patch({ product_id: event.target.value })}>
            <option value="">Selecione um produto ativo</option>
            {draft.product_id && !productOptions.some(product => product.id === draft.product_id) && <option value={draft.product_id} disabled>Produto indisponível — escolha um ativo</option>}
            {productOptions.map(product => <option key={product.id} value={product.id}>{product.sku ? `${product.sku} · ` : ""}{product.name}</option>)}
          </select></div>
        </div>
        {bindings.data?.reviewAvailable && <div className="space-y-1"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.requires_manual_review} onChange={event => patch({ requires_manual_review: event.target.checked })} /><span>Exige conferência antes de organizar</span></label><p className="text-xs text-muted-foreground">Use em personalizações ou arquivos enviados pelo comprador. A exigência permanece neste vínculo e impede a organização automática ou em lote; confira e confirme manualmente em Pedidos. Esta marcação não registra aprovação da arte.</p></div>}
        {editing && <p className="text-xs text-muted-foreground">A identidade externa permanece igual. A correção alcança próximos pedidos e rascunhos; vendas já organizadas conservam o histórico e precisam de revisão própria.</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit">{save.isPending ? "Salvando vínculo…" : saveError ? "Tentar salvar novamente" : editing ? "Salvar destino" : "Cadastrar vínculo"}</Button>{editing && <Button type="button" variant="outline" onClick={cancelEdit}>Cancelar edição</Button>}</div>
      </fieldset>
      {saveError && <p role="alert" className="text-sm text-destructive">Não foi possível salvar o vínculo. {saveError}</p>}
      {saved && <p role="status" className="text-sm text-emerald-700">Vínculo salvo para esta conta.</p>}
    </form>
    <div className="space-y-2">
      {bindings.isLoading ? <p className="text-sm">Carregando vínculos…</p> : !bindings.error && !rows.length ? <p className="text-sm text-muted-foreground">Nenhum vínculo cadastrado nesta conta.</p> : rows.map(row => <article key={row.id} className="rounded-lg border p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="min-w-0 break-words"><p>Anúncio: {row.external_item_id || "—"} · Variação: {row.external_variant_id || "—"} · SKU: {row.external_sku || "—"}</p><p className="text-muted-foreground">Produto: {productOptions.find(product => product.id === row.product_id)?.name ?? "Produto indisponível"}</p>{row.requires_manual_review && <p className="text-amber-700">Conferência obrigatória antes de organizar: personalização ou arquivo do comprador.</p>}</div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => edit(row)}>Corrigir produto</Button>
      </article>)}
      {!bindings.error && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={page === 0 || bindings.isFetching || save.isPending} onClick={() => setPage(current => current - 1)}>Página anterior</Button><p className="text-xs text-muted-foreground">Página {page + 1}{total != null ? ` · ${total} vínculo(s)` : ""}</p><Button type="button" variant="outline" disabled={!hasNext || bindings.isFetching || save.isPending} onClick={() => setPage(current => current + 1)}>Próxima página</Button></div>}
    </div>
  </section>;
}
