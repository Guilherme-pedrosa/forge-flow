import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Repasses from "@/pages/financeiro/Repasses";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), positions: [] as any[], history: [] as any[], error: null as any }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
 rpc: mock.rpc,
 from: (table: string) => {
  const builder: any = { select: () => builder, eq: () => builder, neq: () => builder, order: () => builder, range: () => builder,
   then: (resolve: any, reject: any) => Promise.resolve({ data: table === "marketplace_receivable_positions" ? mock.positions : table === "marketplace_settlements" ? mock.history : [{ id: "bank", name: "Banco real" }], error: table === "marketplace_receivable_positions" ? mock.error : null }).then(resolve, reject),
  }; return builder;
 },
} }));
const position = (fields={}) => ({ receivable_id:"title",tenant_id:"tenant",description:"Venda confirmada",gross_title_amount:100,liquidated_gross:0,cancelled_gross:0,due_date:"2026-10-20",status:"open",order_id:"order",order_code:"PV-100",gross_sale_amount:100,marketplace_order_id:"inbox",external_order_id:"CHANNEL-100",account_id:"shop",account_name:"Loja real",channel:"shopee",retained_open:0,outstanding_gross:100,available_gross:100,net_bank:0,refunded_gross:0,fees:0,freight:0,other_debit:0,fee_credit:0,freight_credit:0,other_credit:0,...fields });
beforeEach(()=>{mock.positions=[position()];mock.history=[];mock.error=null;mock.rpc.mockReset();mock.toast.mockReset();mock.rpc.mockResolvedValue({data:"settlement",error:null});});
afterEach(cleanup);
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={["/financeiro/repasses?titulo=title"]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Repasses/></MemoryRouter></QueryClientProvider>);}
const edit=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});

describe("Conciliação manual de repasses",()=>{
 it("preenche o título pelo link e preserva UUID no retry de uma composição bruto100/custos15/retido20/líquido65",async()=>{
  mock.rpc.mockResolvedValueOnce({data:null,error:{message:"Timeout; tente novamente"}}).mockResolvedValueOnce({data:"settlement",error:null});
  mount();
  await waitFor(()=>expect(screen.getByLabelText("Bruto deste evento")).toHaveValue("100"));
  edit("Referência do extrato do canal","STATEMENT-LINE-1");edit("Tarifas debitadas pelo canal","10");edit("Frete cobrado do vendedor","5");edit("Retido no canal","20");edit("Líquido real no banco","65");
  fireEvent.click(screen.getByRole("button",{name:"Registrar conciliação"}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({variant:"destructive",description:expect.stringContaining("Timeout")})));
  fireEvent.click(screen.getByRole("button",{name:"Registrar conciliação"}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(2));
  expect(mock.rpc.mock.calls[0][0]).toBe("record_marketplace_settlement");
  const first=mock.rpc.mock.calls[0][1],second=mock.rpc.mock.calls[1][1];
  expect(first.p_values).toMatchObject({gross_amount:100,fees:10,freight:5,retained_amount:20,net_amount:65,bank_account_id:"bank"});
  expect(second).toEqual(first);expect(first.p_request_id).toBeTruthy();
  await waitFor(()=>expect(screen.getByLabelText("Referência do extrato do canal")).toHaveValue(""));
 });
 it("estorna a retenção da origem com líquido zero e nenhum banco obrigatório",async()=>{
  mock.positions=[position({retained_open:100,available_gross:0})];mock.history=[{id:"held",kind:"payout",external_reference:"HELD-LINE",gross_amount:100,liquidated_gross:0,retained_amount:100,fees:0,freight:0,other_debit:0,fee_credit:0,freight_credit:0,other_credit:0,net_amount:0,transaction_date:"2026-10-10"}];
  mount();await waitFor(()=>expect(screen.getByLabelText("Bruto deste evento")).toHaveValue("0"));
  edit("Natureza","hold_reversal");edit("Conciliação de origem","held");edit("Referência do extrato do canal","HELD-REVERSAL");edit("Conta do banco","");
  expect(screen.getByLabelText("Bruto da venda estornado")).toHaveValue("100");expect(screen.getByLabelText("Líquido real no banco")).toHaveValue("0");
  fireEvent.click(screen.getByRole("button",{name:"Registrar conciliação"}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({p_kind:"hold_reversal",p_values:{gross_amount:100,net_amount:0,related_settlement_id:"held",bank_account_id:null}});
 });
 it("mostra ativação explícita e nenhum formulário quando a nova estrutura não existe",async()=>{
  mock.error={code:"PGRST205",message:"Missing view"};mock.positions=[];mount();
  expect(await screen.findByText("A conciliação de repasses ainda precisa ser ativada nesta empresa.")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Abrir contas a receber"})).toHaveAttribute("href","/financeiro/receber");
  expect(screen.queryByRole("button",{name:"Registrar conciliação"})).not.toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
 });
});
