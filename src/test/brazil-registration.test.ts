import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDocument, formatCep, validCnpj, lookupCnpjRegistration, lookupCepAddress } from "@/lib/brazil-registration";

const company = { cnpj: "19131243000197", razao_social: "OPEN KNOWLEDGE BRASIL", nome_fantasia: "REDE PELO CONHECIMENTO LIVRE", ddd_telefone_1: "1123851939", cep: "01311902", logradouro: "PAULISTA", descricao_tipo_de_logradouro: "AVENIDA", numero: "37", municipio: "SAO PAULO", uf: "SP", descricao_situacao_cadastral: "ATIVA" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());
describe("consultas cadastrais brasileiras", () => {
  it("formats CPF, numeric and alphanumeric CNPJ, and CEP without removing letters", () => {
    expect(formatDocument("19131243000197")).toBe("19.131.243/0001-97");
    expect(formatDocument("00000000e08g12")).toBe("00.000.000/E08G-12");
    expect(formatDocument("52998224725")).toBe("529.982.247-25"); expect(formatCep("75093630")).toBe("75093-630");
    expect(validCnpj("19.131.243/0001-97")).toBe(true); expect(validCnpj("00.000.000/E08G-12")).toBe(true);
    expect(validCnpj("19.131.243/0001-98")).toBe(false); expect(validCnpj("00000000000000")).toBe(false);
  });
  it("does not query a provider for invalid CNPJ check digits", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(lookupCnpjRegistration("19131243000198", new AbortController().signal)).rejects.toThrow("CNPJ inválido");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("falls back when the first CNPJ provider is unavailable and maps only useful company fields", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(company)); vi.stubGlobal("fetch", fetcher);
    const result = await lookupCnpjRegistration("19131243000197", new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result).toMatchObject({ name: company.razao_social, tradeName: company.nome_fantasia, status: "ATIVA", source: "BrasilAPI", address: { cep: "01311-902", street: "AVENIDA PAULISTA", number: "37", city: "SAO PAULO", state: "SP" } });
    expect(result).not.toHaveProperty("qsa");
  });
  it("rejects a mismatched CNPJ response instead of filling another company", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...company, cnpj: "00000000000191" })));
    await expect(lookupCnpjRegistration("19131243000197", new AbortController().signal)).rejects.toThrow("Não foi possível");
  });
  it("uses the alternate CEP provider when ViaCEP returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ erro: true })).mockResolvedValueOnce(response({ cep: "75093630", street: "Rua PB 48", neighborhood: "Parque Brasília", city: "Anápolis", state: "GO" })));
    const result = await lookupCepAddress("75093-630", new AbortController().signal);
    expect(result).toEqual({ cep: "75093-630", street: "Rua PB 48", neighborhood: "Parque Brasília", city: "Anápolis", state: "GO" });
    expect(result).not.toHaveProperty("number"); expect(result).not.toHaveProperty("complement");
  });
  it("reports missing CEP clearly and does not silently succeed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ erro: true })).mockResolvedValueOnce(response({}, 404)));
    await expect(lookupCepAddress("99999999", new AbortController().signal)).rejects.toThrow("CEP não encontrado");
  });
  it("does not start a fallback request after the user cancels", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); }); vi.stubGlobal("fetch", fetcher);
    await expect(lookupCnpjRegistration("19131243000197", controller.signal)).rejects.toThrow("Aborted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
