import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marketplaceRpc as rpc } from "@/lib/marketplace-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ShippingSettings = { origin_zip: string; handling_days: number; enabled: boolean; mode: string; provider: string };
export function LoraceShipping({ channelId }: { channelId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["lorace-shipping-settings", channelId], queryFn: () => rpc<ShippingSettings>("storefront_shipping_settings", { p_channel_id: channelId }) });
  const [zip, setZip] = useState("");
  const [handling, setHandling] = useState("0");
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (query.data && !dirty) { setZip(query.data.origin_zip); setHandling(String(query.data.handling_days)); setEnabled(query.data.enabled); }
  }, [query.data, dirty]);
  const save = useMutation({ mutationFn: () => rpc("save_storefront_shipping_settings", {
    p_channel_id: channelId, p_origin_zip: zip.replace(/\D/g, ""), p_handling_days: Number(handling), p_enabled: enabled,
  }), onSuccess: async () => {
    await query.refetch(); setDirty(false);
    void client.invalidateQueries({ queryKey: ["lorace-payment-config", channelId] });
  } });
  return <section className="mb-5 space-y-3 rounded-xl border bg-card p-5">
    <h2 className="text-lg font-semibold">Frete pelos Correios</h2>
    <p className="text-sm text-muted-foreground">PAC e SEDEX pelo contrato utilizado na Selovac. O cliente calcula por CEP usando as medidas e o peso embalado cadastrados em cada produto.</p>
    {query.data && <p className="text-sm">{query.data.enabled ? `Cálculo habilitado · origem ${query.data.origin_zip.replace(/(\d{5})(\d{3})/, "$1-$2")}` : "Cálculo ainda não habilitado"}</p>}
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
    <details><summary className="cursor-pointer text-sm font-medium">Configurar origem e preparação</summary>
      <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">CEP de origem<Input inputMode="numeric" autoComplete="postal-code" maxLength={9} required pattern="[0-9]{5}-?[0-9]{3}" value={zip} onChange={event => { setZip(event.target.value); setDirty(true); save.reset(); }} /></label>
          <label className="text-sm">Preparação adicional (dias úteis)<Input type="number" min={0} max={30} required value={handling} onChange={event => { setHandling(event.target.value); setDirty(true); save.reset(); }} /></label>
        </div>
        <p className="text-xs text-muted-foreground">A preparação é somada ao maior prazo de produção dos produtos sob encomenda e ao prazo de transporte dos Correios.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setDirty(true); save.reset(); }} />Habilitar cálculo de frete no site</label>
        <Button type="submit" disabled={query.isPending || !!query.error || save.isPending}>{save.isPending ? "Salvando…" : "Salvar configuração de frete"}</Button>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        {save.isSuccess && !dirty && <p role="status" className="text-sm">Configuração de frete salva.</p>}
      </form>
    </details>
  </section>;
}
