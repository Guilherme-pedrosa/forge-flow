export type RegistrationAddress = { cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string };
export type CnpjRegistration = { name: string; tradeName: string; email: string; phone: string; address: RegistrationAddress; status: string; openedOn: string; activity: string; source: string };
export const cleanDocument = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const cleanCep = (value: string) => value.replace(/\D/g, "");
export const formatCep = (value: string) => cleanCep(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
export function formatDocument(value: string, company = false): string {
  const raw = cleanDocument(value).slice(0, 14);
  return company || raw.length > 11 || /[A-Z]/.test(raw)
    ? raw.replace(/^(.{2})(.)/, "$1.$2").replace(/^(.{6})(.)/, "$1.$2").replace(/^(.{10})(.)/, "$1/$2").replace(/^(.{15})(.)/, "$1-$2")
    : raw.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2").replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, "$1-$2");
}
/** Receita Federal modulus 11, including the alphanumeric CNPJ format (ASCII - 48). */
export function validCnpj(value: string): boolean {
  const raw = cleanDocument(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(raw) || /^(.)\1{13}$/.test(raw)) return false;
  const digit = (base: string, weights: number[]) => {
    const remainder = [...base].reduce((sum, char, i) => sum + (char.charCodeAt(0) - 48) * weights[i], 0) % 11;
    return remainder < 2 ? "0" : String(11 - remainder);
  };
  const first = digit(raw.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return raw.slice(-2) === first + digit(raw.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}
class LookupFailure extends Error { constructor(public status: number) { super("Consulta indisponível"); } }
async function json(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 4500);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
    if (!response.ok) throw new LookupFailure(response.status);
    const result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new LookupFailure(502);
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

export async function lookupCnpjRegistration(value: string, signal: AbortSignal): Promise<CnpjRegistration> {
  const cnpj = cleanDocument(value);
  if (!validCnpj(cnpj)) throw new Error("CNPJ inválido. Confira os 14 caracteres e os dígitos verificadores.");
  const providers = [{ name: "Minha Receita", url: `https://minhareceita.org/${cnpj}` }, { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}` }];
  let notFound = 0;
  for (const provider of providers) {
    try {
      const data = await json(provider.url, signal);
      if (cleanDocument(str(data.cnpj)) !== cnpj || !str(data.razao_social)) throw new LookupFailure(502);
      return { name: str(data.razao_social), tradeName: str(data.nome_fantasia), email: str(data.email), phone: str(data.ddd_telefone_1),
        address: { cep: formatCep(str(data.cep)), street: [str(data.descricao_tipo_de_logradouro), str(data.logradouro)].filter(Boolean).join(" "), number: str(data.numero), complement: str(data.complemento), neighborhood: str(data.bairro), city: str(data.municipio), state: str(data.uf) },
        status: str(data.descricao_situacao_cadastral), openedOn: str(data.data_inicio_atividade), activity: str(data.cnae_fiscal_descricao), source: provider.name };
    } catch (error) { if (signal.aborted) throw error; if (error instanceof LookupFailure && error.status === 404) notFound++; }
  }
  throw new Error(notFound === providers.length ? "CNPJ não encontrado nas bases consultadas. Confira o documento ou preencha manualmente." : "Não foi possível consultar o CNPJ agora. Tente novamente ou preencha os dados manualmente.");
}

export async function lookupCepAddress(value: string, signal: AbortSignal): Promise<Pick<RegistrationAddress, "cep" | "street" | "neighborhood" | "city" | "state">> {
  const cep = cleanCep(value);
  if (cep.length !== 8) throw new Error("Informe um CEP com 8 números.");
  let notFound = 0;
  for (const source of ["viacep", "brasilapi"] as const) {
    try {
      const data = await json(source === "viacep" ? `https://viacep.com.br/ws/${cep}/json/` : `https://brasilapi.com.br/api/cep/v1/${cep}`, signal);
      if (data.erro) throw new LookupFailure(404);
      if (cleanCep(str(data.cep)) !== cep || !str(data.uf || data.state) || !str(data.localidade || data.city)) throw new LookupFailure(502);
      return { cep: formatCep(cep), street: str(data.logradouro || data.street), neighborhood: str(data.bairro || data.neighborhood), city: str(data.localidade || data.city), state: str(data.uf || data.state) };
    } catch (error) { if (signal.aborted) throw error; if (error instanceof LookupFailure && error.status === 404) notFound++; }
  }
  throw new Error(notFound === 2 ? "CEP não encontrado. Confira os números ou informe o endereço manualmente." : "Não foi possível consultar o CEP agora. Tente novamente ou preencha o endereço manualmente.");
}
