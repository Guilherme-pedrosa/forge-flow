import type { NfePurchaseData } from './nfe-purchase';
import type { PurchaseMaterial } from './purchase-catalog';
import { purchaseStockQuantity } from './purchase-stock';
import { validateParts, type PaymentPart } from '@/components/shared/InstallmentEditor';

export type NfeStockLink = { itemId: string; name: string; stockQuantity: string; skipStock: boolean };
export const nfeStockLinks = (invoice: NfePurchaseData): NfeStockLink[] => invoice.items.map(item => ({ itemId: '', name: item.editableItemName, stockQuantity: '', skipStock: false }));
export type NfeFinancialDraft = { paymentMethodId: string; partPaymentMethodIds?: string[]; accountId: string; costCenterId: string; parts: PaymentPart[]; createPayables: boolean };

export function buildNfePurchasePayload(invoice: NfePurchaseData, xml: string, links: NfeStockLink[], materials: PurchaseMaterial[], vendorId: string,
  financial: NfeFinancialDraft, receive: boolean) {
  if (!vendorId) throw new Error('Selecione ou cadastre o fornecedor desta compra.');
  if (!invoice.review.itemTotalsMatch || !invoice.review.subtotalMatchesItems || invoice.items.some(item => item.includedInTotal === false))
    throw new Error('Os valores fiscais dos itens precisam ser conferidos. A importação não altera quantidade, preço ou total da nota para forçar o salvamento.');
  if (links.length !== invoice.items.length) throw new Error('Confira os vínculos de todos os itens da nota.');
  const items = invoice.items.map((item,index) => {
    const link = links[index], material = materials.find(material => material.id === link.itemId);
    if (!material && !link.skipStock) throw new Error(`Vincule o item ${index+1} a um insumo, cadastre-o ou confirme que é uma despesa sem estoque.`);
    if (link.itemId && !material) throw new Error(`O insumo do item ${index+1} não está disponível. Atualize os cadastros.`);
    const stock = material ? purchaseStockQuantity(link.stockQuantity) : null;
    if (receive && material && stock === null) throw new Error(`Informe a quantidade de entrada de ${material.name} em ${material.unit}.`);
    return { description:item.fiscalDescription, quantity:item.exact.quantity, unit_price:item.exact.unitPrice, total:item.exact.total,
      cfop:item.cfop || null, ncm:item.ncm || null, inventory_item_id:material?.id || null, stock_quantity:stock,
      notes:`Código do fornecedor: ${item.supplierCode || 'não informado'} · Unidade da nota: ${item.purchaseUnit || 'não informada'}${link.skipStock ? ' · Conferido como despesa/serviço sem estoque' : ''}` };
  });
  let installments: Record<string,unknown>[] = [];
  if (financial.createPayables) {
    if (!financial.parts.length || financial.parts.some((_,index)=>!financial.partPaymentMethodIds?.[index]&&!financial.paymentMethodId)) throw new Error('Confirme a forma de pagamento cadastrada para as parcelas.');
    if (!financial.accountId) throw new Error('Selecione o plano de contas da compra.');
    installments = validateParts(financial.parts, invoice.total).map((part,index) => ({...part,
      description:`Compra NFe ${invoice.nfeNumber} (${index+1}/${financial.parts.length})`,
      vendor_id:vendorId, payment_method_id:financial.partPaymentMethodIds?.[index]||financial.paymentMethodId, account_id:financial.accountId,
      cost_center_id:financial.costCenterId || null, competence_date:invoice.issueDate,
      installment_number:index+1, installment_total:financial.parts.length,
    }));
  }
  return { p_order:{vendor_id:vendorId, order_date:invoice.issueDate, subtotal:invoice.exact.subtotal, discount:invoice.exact.discount,
    shipping:invoice.exact.shipping, additional_costs:invoice.exact.additionalCosts, total:invoice.exact.total,
    nfe_number:invoice.nfeNumber, nfe_key:invoice.nfeKey, nfe_xml:xml, receive_now:receive,
    notes:financial.createPayables ? 'Importação XML conferida; pagamento não baixado automaticamente.' : 'Importação XML conferida sem criar contas a pagar; nenhum pagamento registrado.'},
    p_items:items,p_installments:installments,p_receive:receive };
}

// Display only: the fiscal code never chooses a company payment-method ID or records a settlement.
export const nfePaymentLabel = (code: string) => ({'01':'Dinheiro','02':'Cheque','03':'Cartão de crédito','04':'Cartão de débito',
  '05':'Crédito da loja','10':'Vale alimentação','11':'Vale refeição','12':'Vale presente','13':'Vale combustível','15':'Boleto',
  '16':'Depósito bancário','17':'Pix dinâmico','18':'Transferência bancária','19':'Fidelidade / cashback','20':'Pix estático',
  '21':'Crédito em loja','22':'Pagamento eletrônico não informado','90':'Sem pagamento','99':'Outro'}[code] || `Meio ${code || 'não informado'}`);
