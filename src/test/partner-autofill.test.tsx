import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerDialog } from "@/components/comercial/PartnerDialog";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
const company = { cnpj: "19131243000197", razao_social: "OPEN KNOWLEDGE BRASIL", nome_fantasia: "REDE LIVRE", cep: "01311902", descricao_tipo_de_logradouro: "AVENIDA", logradouro: "PAULISTA", numero: "37", complemento: "ANDAR 4", bairro: "BELA VISTA", municipio: "SAO PAULO", uf: "SP", descricao_situacao_cadastral: "ATIVA" };
const address = { cep: "75093-630", logradouro: "Rua PB 48", bairro: "Parque Brasília", localidade: "Anápolis", uf: "GO" };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const mount = (kind: "customer" | "vendor" = "customer") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(<QueryClientProvider client={client}><PartnerDialog kind={kind} open onClose={close} /></QueryClientProvider>);
  return { close };
};
beforeEach(() => { mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: "saved-partner", error: null }); mock.toast.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("cadastro com CNPJ e CEP automáticos", () => {
  it("recognizes a pasted CNPJ from the default individual form and saves the filled registration", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(company)); vi.stubGlobal("fetch", fetcher); const { close } = mount();
    fireEvent.change(screen.getByLabelText("CPF / CNPJ"), { target: { value: "19131243000197" } });
    await waitFor(() => expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("OPEN KNOWLEDGE BRASIL"));
    expect(screen.getByLabelText("Tipo de pessoa")).toHaveValue("company");
    expect(screen.getByLabelText("CPF / CNPJ")).toHaveValue("19.131.243/0001-97");
    expect(screen.getByLabelText("Nome fantasia")).toHaveValue("REDE LIVRE");
    expect(screen.getByLabelText("CEP")).toHaveValue("01311-902"); expect(screen.getByLabelText("Número")).toHaveValue("37");
    expect(screen.getByText(/Situação cadastral: ATIVA/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const payload = mock.rpc.mock.calls[0][1];
    expect(payload.p_data).toMatchObject({ name: company.razao_social, document: "19.131.243/0001-97", address: { cep: "01311-902", city: "SAO PAULO" }, registration_details: { person_type: "company", trade_name: "REDE LIVRE" } });
    expect(JSON.stringify(payload)).not.toContain("_key");
  });
  it("looks up CEP without blur, preserving number, complement and edits made during the request", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher); mount("vendor");
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "57" } });
    fireEvent.change(screen.getByLabelText("Complemento"), { target: { value: "Galpão B" } });
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "75093630" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Logradouro"), { target: { value: "Rua digitada manualmente" } });
    finish(response(address)); await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("Anápolis"));
    expect(screen.getByLabelText("Logradouro")).toHaveValue("Rua digitada manualmente");
    expect(screen.getByLabelText("Número")).toHaveValue("57"); expect(screen.getByLabelText("Complemento")).toHaveValue("Galpão B");
  });
  it("ignores a slow CNPJ response after the document is replaced", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response({ ...company, cnpj: "00000000000191", razao_social: "BANCO DO BRASIL" })); vi.stubGlobal("fetch", fetcher); mount();
    fireEvent.change(screen.getByLabelText("CPF / CNPJ"), { target: { value: "19131243000197" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("CPF / CNPJ"), { target: { value: "00000000000191" } });
    await waitFor(() => expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("BANCO DO BRASIL"));
    finish(response(company));
    await waitFor(() => expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("BANCO DO BRASIL"));
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("cannot fill the next address when the queried address is removed", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher); mount();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar endereço" }));
    fireEvent.change(screen.getAllByLabelText("CEP")[0], { target: { value: "75093630" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    fireEvent.click(screen.getAllByRole("button", { name: "Remover endereço" })[0]); finish(response(address));
    await waitFor(() => expect(screen.getAllByLabelText("CEP")).toHaveLength(1));
    expect(screen.getByLabelText("Cidade")).toHaveValue(""); expect(screen.getByLabelText("Logradouro")).toHaveValue("");
  });
  it("shows an invalid CNPJ error and keeps manual fields editable", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); mount();
    fireEvent.change(screen.getByLabelText("CPF / CNPJ"), { target: { value: "19131243000198" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CNPJ inválido");
    expect(screen.getByLabelText("Razão social / nome *")).toBeEnabled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
