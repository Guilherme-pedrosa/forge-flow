import { describe, expect, it } from "vitest";
import { expectedSettlementNet, marketplaceResultAdjustments, newSettlementForm, prepareMarketplaceSettlement, settlementNumbers } from "./marketplace-settlements";
import { calculateFinancialResult } from "./financial-result";
import { effectiveStatus, outstandingAmount } from "./finance";

const today="2026-10-10";
const payout = () => ({...newSettlementForm(today),external_reference:"EXTRATO-123",gross_amount:"100,00",fees:"10",freight:"5",retained_amount:"20",net_amount:"65",bank_account_id:"bank-qa"});
describe("conciliação manual do extrato do canal",()=>{
 it("separa bruto, compensação de despesas, retenção e líquido real",()=>{
  expect(prepareMarketplaceSettlement("payout",payout(),today)).toMatchObject({gross_amount:100,fees:10,freight:5,retained_amount:20,net_amount:65});
  expect(expectedSettlementNet("payout",settlementNumbers(payout()))).toBe(65);
 });
 it("retido integral não cria dinheiro fictício ou banco obrigatório",()=>{
  expect(prepareMarketplaceSettlement("payout",{...payout(),fees:"",freight:"",retained_amount:"100",net_amount:"0",bank_account_id:""},today)).toMatchObject({net_amount:0,bank_account_id:null});
 });
 it("estorno do principal retido exige origem e não cria saída de caixa fictícia",()=>{
  const form={...payout(),fees:"",freight:"",retained_amount:"",net_amount:"0",bank_account_id:"",related_settlement_id:"original-held"};
  expect(prepareMarketplaceSettlement("hold_reversal",form,today)).toMatchObject({gross_amount:100,net_amount:0,bank_account_id:null});
  expect(()=>prepareMarketplaceSettlement("hold_reversal",{...form,related_settlement_id:""},today)).toThrow("origem");
 });
 it("estorno referencia o repasse e registra débito líquido após crédito de custos",()=>{
  const form={...payout(),gross_amount:"20",fees:"",freight:"",retained_amount:"",fee_credit:"2",net_amount:"-18",related_settlement_id:"original-qa"};
  expect(prepareMarketplaceSettlement("refund",form,today)).toMatchObject({gross_amount:20,fee_credit:2,net_amount:-18,related_settlement_id:"original-qa"});
 });
 it("crédito de tarifas após liquidação não precisa criar outro bruto/receita",()=>{
  const form={...payout(),gross_amount:"0",fees:"",freight:"",retained_amount:"",fee_credit:"2",net_amount:"2",related_settlement_id:"original-qa"};
  expect(prepareMarketplaceSettlement("adjustment",form,today)).toMatchObject({gross_amount:0,net_amount:2});
 });
 it.each(["64,99","65,01","100"])("rejeita líquido %s que não coincide com o extrato",net=>expect(()=>prepareMarketplaceSettlement("payout",{...payout(),net_amount:net},today)).toThrow("difere"));
 it.each(["1,999","NaN","Infinity","-1"])("rejeita custo inválido %s",fees=>expect(()=>prepareMarketplaceSettlement("payout",{...payout(),fees},today)).toThrow());
 it("rejeita datas inexistentes/futuras, banco ausente, referência ausente e estorno sem origem",()=>{
  expect(()=>prepareMarketplaceSettlement("payout",{...payout(),transaction_date:"2026-02-30"},today)).toThrow("datas");
  expect(()=>prepareMarketplaceSettlement("payout",{...payout(),transaction_date:"2026-10-11"},today)).toThrow("datas");
  expect(()=>prepareMarketplaceSettlement("payout",{...payout(),bank_account_id:""},today)).toThrow("conta bancária");
  expect(()=>prepareMarketplaceSettlement("payout",{...payout(),external_reference:" "},today)).toThrow("referência");
  expect(()=>prepareMarketplaceSettlement("refund",{...payout(),retained_amount:"",net_amount:"-115"},today)).toThrow("origem");
 });
});

describe("resultado gerencial sem duplicação da venda",()=>{
 const sale=[{amount:100,status:"received",competence_date:today}];
 const costs=[{amount:10,status:"paid",competence_date:today,origin_type:"marketplace_settlement",chart_of_accounts:{account_type:"expense"}},{amount:5,status:"paid",competence_date:today,origin_type:"marketplace_settlement",chart_of_accounts:{account_type:"expense"}}];
 it("repasse100 menos despesas15 e produto30 resulta55, independente do líquido85",()=>{
  const result=calculateFinancialResult(sale,costs,[],[],30);
  expect(result).toMatchObject({grossRevenue:100,totalRevenue:100,opExpenses:15,totalCMV:30,netResult:55});
 });
 it("estorno20 e crédito de tarifas2 viram receita80/despesas13, preservando gross100",()=>{
  const adjustments=marketplaceResultAdjustments([{kind:"refund",amount_signed:-20},{kind:"fee_credit",amount_signed:-2},{kind:"fee",amount_signed:10}]);
  const result=calculateFinancialResult(sale,costs,[],[],30,0,0,adjustments);
  expect(result).toMatchObject({grossRevenue:100,totalRevenue:80,opExpenses:13,marketplaceRefunds:20,marketplaceExpenseCredits:2,netResult:37});
 });
 it("estorno integral e devolução integral das despesas deixam custo de produto real30 como perda",()=>{
  const result=calculateFinancialResult(sale,costs,[],[],30,0,0,{refunds:100,expenseCredits:15});
  expect(result).toMatchObject({grossRevenue:100,totalRevenue:0,opExpenses:0,netResult:-30});
 });
 it("retido integral estornado preserva o bruto histórico na DRE e desconta contra receita uma vez",()=>{
  const title={amount:100,amount_received:0,marketplace_cancelled_gross:100,status:"reversed",competence_date:today,due_date:today};
  expect(calculateFinancialResult([title],[],[],[],0,0,0,{refunds:100,expenseCredits:0})).toMatchObject({grossRevenue:100,totalRevenue:0,netResult:0});
  expect(outstandingAmount(title)).toBe(0);
  expect(effectiveStatus(title,today)).toBe("cancelled");
 });
 it("saldo80 recebido mais20 retido estornado encerra previsão sem fingir recebimento100",()=>{
  const title={amount:100,amount_received:80,marketplace_cancelled_gross:20,status:"received",competence_date:today,due_date:today};
  expect(outstandingAmount(title)).toBe(0);
  expect(title.amount_received).toBe(80);
  expect(calculateFinancialResult([title],costs,[],[],30,0,0,{refunds:20,expenseCredits:0})).toMatchObject({grossRevenue:100,totalRevenue:80,opExpenses:15,netResult:35});
  expect(outstandingAmount({...title,marketplace_cancelled_gross:undefined,status:"partial"})).toBe(20);
 });
});
