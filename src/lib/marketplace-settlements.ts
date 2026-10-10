import { localDate, money, validDate } from "./finance";

export type MarketplaceSettlementKind = "payout" | "release" | "refund" | "hold_reversal" | "adjustment";
export const settlementLabels = { payout: "Repasse ou retenção", release: "Liberação de retenção", refund: "Estorno do bruto já liquidado", hold_reversal: "Estorno de principal retido (sem repasse)", adjustment: "Crédito ou débito posterior do canal" };
export type SettlementNumbers = { gross_amount: number; fees: number; freight: number; other_debit: number; retained_amount: number; fee_credit: number; freight_credit: number; other_credit: number };
export type SettlementValues = SettlementNumbers & { external_reference: string; transaction_date: string; competence_date: string; bank_account_id: string | null; related_settlement_id: string | null; notes: string; net_amount: number };
export type SettlementForm = { [K in keyof SettlementValues]: string };
export type MarketplaceReceivablePosition = { receivable_id: string; tenant_id: string; description: string; gross_title_amount: number; liquidated_gross: number; cancelled_gross: number; due_date: string; status: string; order_id: string; order_code: string; gross_sale_amount: number; marketplace_order_id: string; external_order_id: string; account_id: string; account_name: string; channel: string; retained_open: number; outstanding_gross: number; available_gross: number; net_bank: number; refunded_gross: number; fees: number; freight: number; other_debit: number; fee_credit: number; freight_credit: number; other_credit: number };
export type MarketplaceSettlement = SettlementValues & { id: string; kind: MarketplaceSettlementKind; receivable_id: string; liquidated_gross: number; bank_transaction_id: string | null; created_at: string };
const numericFields = ["gross_amount", "fees", "freight", "other_debit", "retained_amount", "fee_credit", "freight_credit", "other_credit"] as const;
export function settlementNumbers(form: Pick<SettlementForm, typeof numericFields[number]>): SettlementNumbers {
  return Object.fromEntries(numericFields.map(key => {
    const raw = form[key].trim() || "0";
    const value = money(raw);
    // Existing money() rounds general finance inputs; settlement evidence must already have cents.
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    if (Math.abs(Number(normalized) * 100 - Math.round(Number(normalized) * 100)) > 0.000001 || value < 0 || value > 100000000) throw new Error("Use custos/créditos não negativos, até duas casas decimais e dentro do limite.");
    return [key, value];
  })) as SettlementNumbers;
}
export function expectedSettlementNet(kind: MarketplaceSettlementKind, values: SettlementNumbers): number {
  return money((kind === "refund" ? -values.gross_amount : kind === "hold_reversal" ? 0 : values.gross_amount - values.retained_amount) - values.fees - values.freight - values.other_debit + values.fee_credit + values.freight_credit + values.other_credit);
}
export function prepareMarketplaceSettlement(kind: MarketplaceSettlementKind, form: SettlementForm, today = localDate()): SettlementValues {
  if (!Object.prototype.hasOwnProperty.call(settlementLabels, kind)) throw new Error("Natureza da conciliação inválida.");
  const values = settlementNumbers(form);
  if (kind === "adjustment" ? values.gross_amount !== 0 : values.gross_amount <= 0) throw new Error(kind === "adjustment" ? "Ajuste posterior não movimenta o bruto da venda." : "Informe o bruto do evento, maior que zero.");
  if (kind === "adjustment" && values.fees + values.freight + values.other_debit + values.fee_credit + values.freight_credit + values.other_credit === 0) throw new Error("Informe o custo ou crédito do ajuste posterior.");
  if (kind !== "payout" && values.retained_amount !== 0) throw new Error("Liberação ou estorno não criam outra retenção.");
  if (values.retained_amount > values.gross_amount) throw new Error("A retenção supera o bruto do evento.");
  if (!validDate(form.transaction_date) || form.transaction_date > today || !validDate(form.competence_date) || form.competence_date > today) throw new Error("Informe datas válidas de extrato e competência, até hoje.");
  const reference = form.external_reference.trim();
  if (!reference || reference.length > 160 || form.notes.length > 1000) throw new Error("Informe a referência real do extrato, até 160 caracteres; observações até 1000.");
  if (kind !== "payout" && !form.related_settlement_id) throw new Error("Selecione a conciliação de origem da retenção ou do estorno.");
  const net = money(form.net_amount);
  const normalizedNet = form.net_amount.trim().includes(",") ? form.net_amount.trim().replace(/\./g, "").replace(",", ".") : form.net_amount.trim();
  if (Math.abs(Number(normalizedNet) * 100 - Math.round(Number(normalizedNet) * 100)) > 0.000001 || Math.abs(net) > 100000000) throw new Error("Líquido do banco inválido; use centavos.");
  const expected = expectedSettlementNet(kind, values);
  if (net !== expected) throw new Error("O valor do banco difere do bruto, custos, créditos e retenção. Confira a composição do extrato.");
  if (net !== 0 && !form.bank_account_id) throw new Error("Selecione a conta bancária do valor efetivamente recebido/debitado.");
  return { ...values, external_reference: reference, transaction_date: form.transaction_date, competence_date: form.competence_date,
    bank_account_id: form.bank_account_id || null, related_settlement_id: form.related_settlement_id || null, notes: form.notes.trim(), net_amount: net };
}
export function newSettlementForm(today = localDate()): SettlementForm {
  return { external_reference: "", transaction_date: today, competence_date: today, bank_account_id: "", related_settlement_id: "", notes: "", net_amount: "", gross_amount: "", fees: "", freight: "", other_debit: "", retained_amount: "", fee_credit: "", freight_credit: "", other_credit: "" };
}
export function marketplaceResultAdjustments(components: { kind: string; amount_signed: number | string }[]) {
  let refunds = 0, expenseCredits = 0;
  for (const component of components) {
    const value = money(component.amount_signed);
    if (component.kind === "refund") refunds -= value;
    else if (["fee_credit", "freight_credit", "other_credit"].includes(component.kind)) expenseCredits -= value;
  }
  return { refunds: money(refunds), expenseCredits: money(expenseCredits) };
}
