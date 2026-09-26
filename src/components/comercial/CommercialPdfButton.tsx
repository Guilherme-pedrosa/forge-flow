import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { CommercialDocument, DocumentCustomer } from "@/lib/commercial-document";

export function CommercialPdfButton({ document, tenantId, orderId, sourceQuoteId, disabled }: {
  document: CommercialDocument; tenantId?: string; orderId?: string; sourceQuoteId?: string | null; disabled?: boolean;
}) {
  const { toast } = useToast(); const pending = useRef(false); const [loading, setLoading] = useState(false);
  const download = async () => {
    if (pending.current || disabled || !tenantId) return;
    pending.current = true; setLoading(true);
    try {
      const [{ downloadCommercialPdf }, { commercialPdfAssets }, company] = await Promise.all([
        import("@/lib/commercial-pdf"), import("@/lib/commercial-pdf-assets"),
        supabase.from("tenants").select("name,logo_url,settings").eq("id", tenantId).single(),
      ]);
      if (company.error || !company.data) throw new Error("Não foi possível carregar os dados da empresa. Tente novamente.");
      const content: CommercialDocument = { ...document };
      if (sourceQuoteId) {
        const quote = await supabase.from("sales_quotes").select("customer_snapshot,payment_schedule").eq("id", sourceQuoteId).eq("tenant_id", tenantId).single();
        if (quote.error) throw new Error("Não foi possível carregar as condições da proposta de origem.");
        const source = quote.data as unknown as { customer_snapshot: DocumentCustomer | null; payment_schedule?: CommercialDocument["payments"] };
        if (source.customer_snapshot) content.customer = source.customer_snapshot;
        content.payments = source.payment_schedule;
      }
      if (orderId && !content.payments?.length) {
        const payments = await supabase.from("accounts_receivable").select("amount,due_date").eq("tenant_id", tenantId).eq("origin_type", "order").eq("origin_id", orderId).order("due_date");
        if (payments.error) throw new Error("Não foi possível carregar as condições de pagamento. Tente novamente.");
        if (payments.data?.length) content.payments = payments.data;
      }
      const { assets, missingImages } = await commercialPdfAssets(content, company.data);
      await downloadCommercialPdf(content, company.data, assets);
      toast({ title: "PDF baixado", description: missingImages ? "O documento foi gerado. Algumas imagens estavam indisponíveis e não foram incluídas." : "O arquivo está pronto para enviar ao cliente." });
    } catch (error) {
      toast({ title: "Não foi possível gerar o PDF", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally { pending.current = false; setLoading(false); }
  };
  return <Button variant="outline" size="sm" onClick={download} disabled={disabled || loading || !tenantId || !document.items.length} aria-busy={loading}>
    {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}{loading ? "Gerando PDF…" : "Baixar PDF"}
  </Button>;
}
