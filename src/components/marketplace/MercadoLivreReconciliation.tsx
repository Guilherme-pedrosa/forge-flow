import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { integrationErrorMessage } from "@/lib/mercado-livre-integration";
import { readMercadoLivreReconciliation } from "@/lib/mercado-livre-reports";
import { MercadoLivreReportPeriodFields, reportDate, reportMoney, useMercadoLivreReportPeriod, type MercadoLivreReportProps } from "./MercadoLivreDashboard";

const paymentStates = { released: "Liberado no Mercado Pago", pending: "A liberar", refunded: "Devolvido", cancelled: "Cancelado", rejected: "Recusado", review: "A conferir" };
export function MercadoLivreReconciliation({ binding, sellerId, userId }: MercadoLivreReportProps) {
  const { profile } = useAuth(), period = useMercadoLivreReportPeriod();
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["ml_reconciliation", profile?.tenant_id, userId, binding.bridge_id, sellerId, period.selected, offset],
    queryFn: ({ signal }) => readMercadoLivreReconciliation(binding, sellerId, period.selected, offset, { userId, signal }), retry: false });
  return <section aria-label="Conciliação do Mercado Livre" className="space-y-4 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Conciliação</h2><p className="text-sm text-muted-foreground">Confira os pedidos, os pagamentos e a liberação do dinheiro no Mercado Pago.</p></div><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar pagamentos</Button></div>
    <MercadoLivreReportPeriodFields period={period} idPrefix="ml-reconciliation" disabled={query.isFetching} onApply={() => { const result = period.apply(); if (result) { if (result === "same" && offset === 0) void query.refetch(); setOffset(0); } }} />
    {query.isLoading && <p role="status">Conferindo os pagamentos no canal…</p>}{query.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(query.error)}</p>}
    {query.data && <><p className="text-sm text-muted-foreground">{query.data.total == null ? "Total a conferir" : `${query.data.total} pedido(s)`} · {query.data.items.length} nesta página · consulta em {reportDate(query.data.checked_at)}</p>
      {!!query.data.issues.length && <div role="status" className="space-y-1 rounded-lg border p-3 text-sm">{query.data.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}
      {!query.data.items.length && <p>Nenhum pedido retornado para este período.</p>}
      {query.data.items.map(order => <article key={order.order_id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">Pedido {order.order_id}</h3><p className="text-xs text-muted-foreground">{({ paid: "Pago", cancelled: "Cancelado", payment_required: "Aguardando pagamento", payment_in_process: "Pagamento em análise" } as Record<string, string>)[order.status] || "Situação a conferir no canal"}</p></div><div className="text-sm"><p>Produtos: <strong>{reportMoney(order.products_gross_amount)}</strong></p><p>Total informado: <strong>{reportMoney(order.reported_total)}</strong></p></div></div>
        {order.payments.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 pr-3">Pagamento</th><th className="py-2 pr-3">Situação</th><th className="py-2 pr-3">Bruto</th><th className="py-2 pr-3">Taxas MP do vendedor</th><th className="py-2 pr-3">Líquido</th><th className="py-2 pr-3">Devolvido</th><th className="py-2">Liberação</th></tr></thead><tbody>{order.payments.map(payment => <tr key={payment.id} className="border-b last:border-0"><td className="py-3 pr-3">{payment.id}</td><td className="py-3 pr-3">{paymentStates[payment.release_state]}{payment.issue && <p className="mt-1 max-w-xs text-xs text-destructive">{payment.issue}</p>}</td><td className="py-3 pr-3 whitespace-nowrap">{reportMoney(payment.gross_amount)}</td><td className="py-3 pr-3 whitespace-nowrap">{reportMoney(payment.fee_amount)}{!!payment.fee_details.length && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Composição informada</summary>{payment.fee_details.map((fee, index) => <p key={index}>{fee.type}: {reportMoney(fee.amount)} · {fee.payer === "collector" ? "vendedor" : fee.payer === "payer" ? "comprador" : "pagador a conferir"}</p>)}</details>}</td><td className="py-3 pr-3 whitespace-nowrap">{reportMoney(payment.net_amount)}</td><td className="py-3 pr-3 whitespace-nowrap">{reportMoney(payment.refunded_amount)}</td><td className="py-3">{reportDate(payment.release_at)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">Nenhum pagamento confirmado na consulta deste pedido.</p>}
      </article>)}
      <div className="flex gap-2"><Button variant="outline" disabled={query.isFetching || !offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</Button><Button variant="outline" disabled={query.isFetching || query.data.next_offset == null} onClick={() => query.data?.next_offset != null && setOffset(query.data.next_offset)}>Próxima</Button></div>
    </>}
  </section>;
}
