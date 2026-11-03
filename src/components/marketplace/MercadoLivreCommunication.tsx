import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { integrationErrorMessage, type IntegradorBridgeBinding } from "@/lib/mercado-livre-integration";
import { markMercadoLivreConversationRead, readMercadoLivreConversation, readMercadoLivreConversations, readMercadoLivreQuestions, replyMercadoLivre } from "@/lib/mercado-livre-workspace";
import { orderRequest } from "@/lib/sales-order";

type Props = { kind: "messages" | "questions"; binding: IntegradorBridgeBinding; sellerId: string; userId: string };
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "Data não informada";
export function MercadoLivreCommunication(props: Props) {
  const { profile } = useAuth();
  return <Communication key={`${profile?.tenant_id}:${props.userId}:${props.sellerId}:${props.kind}`} {...props} />;
}
function Communication({ kind, binding, sellerId, userId }: Props) {
  const { profile } = useAuth(), qc = useQueryClient();
  const prefix = ["ml_communication", profile?.tenant_id, userId, binding.bridge_id, sellerId];
  const [offset, setOffset] = useState(0), [status, setStatus] = useState<"UNANSWERED" | "ANSWERED" | "ALL">("UNANSWERED");
  const [selectedPack, setSelectedPack] = useState(""), [packInput, setPackInput] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const questions = useQuery({ queryKey: [...prefix, "questions", status, offset], enabled: kind === "questions",
    queryFn: ({ signal }) => readMercadoLivreQuestions(binding, sellerId, status, offset, { userId, signal }), retry: false });
  const conversations = useQuery({ queryKey: [...prefix, "messages", offset], enabled: kind === "messages",
    queryFn: ({ signal }) => readMercadoLivreConversations(binding, sellerId, offset, { userId, signal }), retry: false });
  const thread = useQuery({ queryKey: [...prefix, "thread", selectedPack], enabled: kind === "messages" && !!selectedPack,
    queryFn: ({ signal }) => readMercadoLivreConversation(binding, sellerId, selectedPack, { userId, signal }), retry: false });
  useEffect(() => { if (kind === "messages" && !selectedPack && conversations.data?.items[0]) setSelectedPack(conversations.data.items[0].pack_id); }, [kind, selectedPack, conversations.data]);
  const updateDraft = (id: string, value: string) => setDrafts(previous => ({ ...previous, [id]: value }));
  const refresh = () => { void qc.invalidateQueries({ queryKey: prefix }); };
  const markRead = useMutation({ retry: false, mutationFn: (packId: string) => markMercadoLivreConversationRead(binding, sellerId, packId, { userId }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: prefix }); await qc.invalidateQueries({ queryKey: ["ml_dashboard", profile?.tenant_id, userId, binding.bridge_id, sellerId] }); } });
  const active = kind === "questions" ? questions : conversations;
  const next = active.data?.next_offset;
  return <section aria-label={kind === "questions" ? "Perguntas do Mercado Livre" : "Mensagens do Mercado Livre"} className="space-y-4 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{kind === "questions" ? "Perguntas dos anúncios" : "Mensagens pós-venda"}</h2><p className="text-sm text-muted-foreground">{kind === "questions" ? "Consulte e responda às dúvidas dos compradores nos anúncios desta conta." : "Abra a conversa do pedido e responda pelo Forge."}</p></div><Button variant="outline" disabled={active.isFetching || thread.isFetching} onClick={refresh}>Atualizar {kind === "questions" ? "perguntas" : "conversas"}</Button></div>
    {kind === "questions" && <div className="max-w-xs"><Label htmlFor="ml-question-status">Situação</Label><select id="ml-question-status" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="UNANSWERED">Aguardando resposta</option><option value="ANSWERED">Respondidas</option><option value="ALL">Todas</option></select></div>}
    {active.isLoading && <p role="status">Consultando o Mercado Livre…</p>}
    {active.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(active.error)}</p>}
    {kind === "questions" && questions.data && <>
      <p className="text-sm text-muted-foreground">{questions.data.total} pergunta(s) · {questions.data.items.length} nesta página</p>
      {!questions.data.items.length && <p>Nenhuma pergunta nesta situação.</p>}
      {questions.data.items.map(question => <article key={question.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>Anúncio {question.item_id} · Pergunta {question.id}</span><time>{date(question.asked_at)}</time></div><p className="whitespace-pre-wrap text-sm">{question.text || "Pergunta indisponível no Mercado Livre."}</p>{question.answer ? <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="mb-1 font-medium">Resposta da loja</p><p className="whitespace-pre-wrap">{question.answer.text}</p><p className="mt-2 text-xs text-muted-foreground">{date(question.answer.date)}</p></div> : question.status === "UNANSWERED" ? <ReplyForm key={question.id} binding={binding} sellerId={sellerId} userId={userId} kind="questions" target={question.id} revision={question.revision} value={drafts[question.id] || ""} onChange={value => updateDraft(question.id, value)} onSent={clear => { if (clear) updateDraft(question.id, ""); refresh(); }} /> : <p className="text-sm text-muted-foreground">Esta pergunta foi encerrada pelo Mercado Livre.</p>}</article>)}
    </>}
    {kind === "messages" && <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (/^\d{1,24}$/.test(packInput.trim())) setSelectedPack(packInput.trim()); }}><div className="w-full sm:w-72"><Label htmlFor="ml-chat-order">Abrir conversa por pedido ou pacote</Label><Input id="ml-chat-order" inputMode="numeric" value={packInput} onChange={event => setPackInput(event.target.value)} placeholder="Número do pedido ou pacote" /></div><Button variant="outline" disabled={!/^\d{1,24}$/.test(packInput.trim())}>Abrir conversa</Button></form>
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]"><div className="space-y-2">{conversations.data && !conversations.data.items.length && <p className="text-sm text-muted-foreground">Nenhuma conversa nos pedidos consultados. Você também pode abrir pelo número do pedido.</p>}{conversations.data?.items.map(conversation => <button type="button" key={conversation.pack_id} onClick={() => setSelectedPack(conversation.pack_id)} aria-pressed={selectedPack === conversation.pack_id} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedPack === conversation.pack_id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}><span className="block font-medium">{conversation.buyer_name || `Pedido ${conversation.order_id || conversation.pack_id}`}</span>{conversation.title && <span className="mt-1 block text-xs text-muted-foreground">{conversation.title}</span>}<span className="mt-2 block line-clamp-2">{conversation.last_message}</span><span className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{date(conversation.last_message_at)}</span>{conversation.pending && <span className="font-medium text-primary">Aguardando resposta</span>}</span></button>)}</div>
        <div className="min-w-0 space-y-3 rounded-lg border p-4">{thread.isLoading && <p role="status">Abrindo conversa…</p>}{thread.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(thread.error)}</p>}{!selectedPack && <p className="text-sm text-muted-foreground">Selecione uma conversa.</p>}{thread.data && <><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Conversa do pedido/pacote {thread.data.pack_id}</h3><Button variant="outline" size="sm" disabled={markRead.isPending || thread.isFetching} onClick={() => markRead.mutate(thread.data!.pack_id)}>{markRead.isPending ? "Marcando como lida…" : "Marcar conversa como lida"}</Button></div>{markRead.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(markRead.error)}</p>}<div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">{thread.data.messages.map(message => <div key={message.id} className={`max-w-[92%] rounded-lg p-3 text-sm ${message.from === "seller" ? "ml-auto bg-primary/10" : "mr-auto bg-muted"}`}><p className="mb-1 text-xs font-medium">{message.from === "seller" ? "Elevare3D" : "Comprador"}</p><p className="whitespace-pre-wrap break-words">{message.text}</p><p className="mt-2 text-xs text-muted-foreground">{date(message.date)}{message.status === "pending_review" ? " · Em revisão no Mercado Livre" : message.status === "rejected" ? " · Não entregue pelo Mercado Livre" : ""}</p></div>)}{!thread.data.messages.length && <p className="text-sm text-muted-foreground">Esta conversa ainda não tem mensagens.</p>}</div>{thread.data.can_reply ? <ReplyForm key={thread.data.pack_id} binding={binding} sellerId={sellerId} userId={userId} kind="messages" target={thread.data.pack_id} revision={thread.data.revision} value={drafts[thread.data.pack_id] || ""} onChange={value => updateDraft(thread.data.pack_id, value)} onSent={clear => { if (clear) updateDraft(thread.data!.pack_id, ""); refresh(); }} /> : <p className="text-sm text-muted-foreground">O Mercado Livre não permite responder esta conversa neste momento. Situação: {thread.data.status === "closed" ? "encerrada" : thread.data.status === "blocked" ? "bloqueada" : "consulte o pedido no canal"}.</p>}</>}</div></div>
    </>}
    {active.data && <div className="flex gap-2"><Button variant="outline" disabled={active.isFetching || offset === 0} onClick={() => setOffset(Math.max(0, offset - (kind === "questions" ? 20 : 10)))}>Anterior</Button><Button variant="outline" disabled={active.isFetching || next == null} onClick={() => next != null && setOffset(next)}>Próxima</Button></div>}
  </section>;
}
function ReplyForm({ binding, sellerId, userId, kind, target, revision, value, onChange, onSent }: Props & { target: string; revision: string; value: string; onChange: (value: string) => void; onSent: (clearDraft: boolean) => void }) {
  const request = useRef<{ signature: string; id: string } | null>(null), seenRevision = useRef(revision);
  const [message, setMessage] = useState(""), [attempt, setAttempt] = useState<{ text: string; revision: string; requestId: string } | null>(null);
  const stale = !attempt && seenRevision.current !== revision && !!value.trim();
  const send = useMutation({ retry: false, mutationFn: async () => {
    let current = attempt;
    if (!current) {
      request.current = orderRequest(request.current, JSON.stringify([kind, target, value.trim(), revision]));
      current = { text: value.trim(), revision, requestId: request.current.id }; setAttempt(current);
    }
    const result = await replyMercadoLivre(binding, sellerId, kind, target, current.text, current.revision, current.requestId, { userId });
    return { result, sentText: current.text };
  }, onSuccess: ({ result, sentText }) => {
    request.current = null; setAttempt(null); seenRevision.current = revision;
    const unchanged = value.trim() === sentText;
    setMessage(!unchanged ? "Envio anterior confirmado. Seu novo rascunho foi preservado." : result.status === "pending_review" ? "Resposta recebida pelo Mercado Livre e em revisão." : "Resposta recebida pelo Mercado Livre."); onSent(unchanged);
  }, onError: error => {
    // These fixed server rejections occur before its durable intent/POST.
    if (error && typeof error === "object" && "code" in error && error.code === "bridge_listing_rejected" || /^(Confira o texto antes de enviar:|Confira a resposta e atualize|O atendimento mudou\.|Esta pergunta já foi respondida|O Mercado Livre não permite responder esta conversa|O Mercado Livre recusou o envio)/.test(integrationErrorMessage(error))) { request.current = null; setAttempt(null); }
  } });
  return <form className="space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); if (!send.isPending && !stale && (attempt || value.trim().length >= 2)) send.mutate(); }}><Label htmlFor={`ml-reply-${target}`}>Sua resposta</Label><Textarea id={`ml-reply-${target}`} maxLength={kind === "questions" ? 2000 : 350} value={value} disabled={send.isPending} onChange={event => { if (!value.trim()) seenRevision.current = revision; onChange(event.target.value); setMessage(""); }} placeholder="Escreva a resposta ao comprador" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{value.length}/{kind === "questions" ? 2000 : 350} caracteres</p><Button disabled={send.isPending || stale || !attempt && value.trim().length < 2}>{send.isPending ? "Enviando…" : attempt ? "Conferir envio anterior" : "Enviar resposta no Mercado Livre"}</Button></div>{attempt && !send.isPending && <p className="text-xs text-muted-foreground">O envio anterior será conferido com o mesmo identificador e texto. Seu novo rascunho ficará preservado.</p>}{stale && <p role="alert" className="text-sm">Chegou uma atualização deste atendimento. Confira a conversa antes de enviar sua resposta. <Button type="button" variant="ghost" onClick={() => { seenRevision.current = revision; onChange(value + ""); setMessage("Conversa conferida."); }}>Conferi a atualização</Button></p>}{send.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(send.error)}</p>}{message && <p role="status" className="text-sm">{message}</p>}</form>;
}
