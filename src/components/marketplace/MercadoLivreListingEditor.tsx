import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { changeMercadoLivreListing, changeMercadoLivreListingStatus, readMercadoLivreListing, type MercadoLivreListingDetail } from "@/lib/mercado-livre-workspace";
import { integrationErrorMessage, publicListingUrl, type IntegradorBridgeBinding } from "@/lib/mercado-livre-integration";
import { orderRequest } from "@/lib/sales-order";

type Props = { binding: IntegradorBridgeBinding; sellerId: string; itemId: string; userId: string; onClose: () => void; onChanged: () => void | Promise<void> };
const money = (value: number | null) => value == null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const reasons: Record<string, string> = { catalog_controls_content: "O conteúdo deste anúncio é controlado pelo catálogo do Mercado Livre.", title_has_sales_or_unknown_sales: "O título não pode ser alterado após vendas ou sem confirmar o histórico.", user_product_family_requires_review: "Este anúncio pertence a uma família de produtos e exige a edição permitida pelo canal.", moderation_or_pause_requires_review: "O anúncio tem uma restrição do canal que precisa ser conferida antes da reativação." };
export function MercadoLivreListingEditor(props: Props) {
  const { profile } = useAuth();
  return <Editor key={`${profile?.tenant_id}:${props.userId}:${props.sellerId}:${props.itemId}`} {...props} />;
}
function Editor({ binding, sellerId, itemId, userId, onClose, onChanged }: Props) {
  const { profile } = useAuth(), qc = useQueryClient();
  const key = ["ml_listing_detail", profile?.tenant_id, userId, binding.bridge_id, sellerId, itemId];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readMercadoLivreListing(binding, sellerId, itemId, { userId, signal }), retry: false });
  const [draft, setDraft] = useState<{ title: string; description: string; revision: string } | null>(null), [message, setMessage] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const accept = (value: MercadoLivreListingDetail) => { qc.setQueryData(key, value); setDraft({ title: value.item.title, description: value.item.description, revision: value.revision }); };
  useEffect(() => { if (query.data && !draft) setDraft({ title: query.data.item.title, description: query.data.item.description, revision: query.data.revision }); }, [query.data, draft]);
  const changes: { title?: string; description?: string } = {};
  if (draft && query.data) { if (draft.title.trim() !== query.data.item.title) changes.title = draft.title.trim(); if (draft.description.trim() !== query.data.item.description) changes.description = draft.description.trim(); }
  const operation = useMutation({ mutationFn: async (action: "edit" | "active" | "paused") => {
    if (!draft || !query.data) throw new Error("Atualize o anúncio antes de salvar.");
    request.current = orderRequest(request.current, JSON.stringify([action, itemId, draft.revision, changes]));
    return action === "edit" ? changeMercadoLivreListing(binding, sellerId, itemId, changes, draft.revision, request.current.id, { userId })
      : changeMercadoLivreListingStatus(binding, sellerId, itemId, action, draft.revision, request.current.id, { userId });
  }, onSuccess: async result => { if (!alive.current) return; accept(result.item); request.current = null; setMessage("Alteração confirmada no Mercado Livre."); await onChanged(); } });
  const value = query.data, busy = operation.isPending, stale = !!value && !!draft && draft.revision !== value.revision;
  const link = value && publicListingUrl(value.item.permalink);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Gerenciar anúncio</DialogTitle><DialogDescription>{itemId} · Mercado Livre</DialogDescription></DialogHeader>
    {query.isLoading && <p role="status">Consultando o anúncio…</p>}{query.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(query.error)}</p>}
    {value && draft && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p>Situação: <strong>{({ active: "Ativo", paused: "Pausado", closed: "Encerrado", under_review: "Em revisão" } as Record<string, string>)[value.item.status] || "A conferir no canal"}</strong></p>{link && <a href={link} target="_blank" rel="noreferrer" className="underline">Abrir anúncio no Mercado Livre</a>}</div>
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm"><div><p className="text-muted-foreground">Preço no canal</p><p className="font-medium">{money(value.item.price)}</p></div><div><p className="text-muted-foreground">Estoque no canal</p><p className="font-medium">{value.item.available_quantity ?? "Não informado"}</p></div></div>
      <div className="space-y-2"><Label htmlFor="ml-edit-title">Título</Label><Input id="ml-edit-title" value={draft.title} maxLength={60} disabled={busy || !value.editable.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); setMessage(""); }} /></div>
      <div className="space-y-2"><Label htmlFor="ml-edit-description">Descrição para o cliente</Label><Textarea id="ml-edit-description" className="min-h-52" value={draft.description} maxLength={5000} disabled={busy || !value.editable.description} onChange={event => { setDraft({ ...draft, description: event.target.value }); setMessage(""); }} /></div>
      {!!value.editable.reasons.length && <div className="space-y-1 text-xs text-muted-foreground">{value.editable.reasons.map(reason => <p key={reason}>{reasons[reason] || "O canal limita algumas alterações deste anúncio."}</p>)}</div>}
      {stale && <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm"><p>O anúncio mudou no canal. Seus textos foram preservados.</p><details><summary className="cursor-pointer">Conferir o texto atual do canal</summary><p className="mt-2 font-medium">{value.item.title}</p><p className="mt-1 whitespace-pre-wrap">{value.item.description}</p></details><Button variant="outline" disabled={busy} onClick={() => setDraft({ ...draft, revision: value.revision })}>Conferi e quero manter meus textos</Button></div>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || stale || !Object.keys(changes).length || "title" in changes && !value.editable.title || "description" in changes && !value.editable.description} onClick={() => operation.mutate("edit")}>Salvar título e descrição no Mercado Livre</Button>{value.editable.pause && <Button variant="outline" disabled={busy || stale || !!Object.keys(changes).length} onClick={() => operation.mutate("paused")}>Pausar anúncio</Button>}{value.editable.activate && <Button variant="outline" disabled={busy || stale || !!Object.keys(changes).length} onClick={() => operation.mutate("active")}>Ativar anúncio</Button>}</div>
      <p className="text-xs text-muted-foreground">Estoque e preços são atualizados pelos vínculos com o produto do Forge, na tela Estoque e preços.</p>
    </div>}
    {operation.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(operation.error)}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy || query.isFetching} onClick={async () => { const result = await query.refetch(); if (result.data && !draft) accept(result.data); }}>Consultar versão atual</Button><Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button></div>
  </DialogContent></Dialog>;
}
