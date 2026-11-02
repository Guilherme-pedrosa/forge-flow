/** Local XML extraction and review proposals; no writes or side effects. */
export const MAX_NFE_XML_BYTES = 5 * 1024 * 1024;
const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
type Decimal = { raw: string; value: number };
type Money = Decimal & { cents: number };
export class NfeImportError extends Error {
  constructor(public code: "too_large" | "unsafe_xml" | "invalid_xml" | "missing_field" | "invalid_number", message: string) {
    super(message); this.name = "NfeImportError";
  }
}
export type NfeSupplier = {
  name: string; tradeName: string; document: string; documentType: "CNPJ" | "CPF" | null;
  stateRegistration: string; substituteStateRegistration: string; municipalRegistration: string;
  economicActivityCode: string; taxRegimeCode: string; phone: string; email: string;
  address: { street: string; number: string; complement: string; district: string; municipalityCode: string;
    municipality: string; state: string; postalCode: string; countryCode: string; country: string };
};
export type NfePurchaseItem = {
  number: string; fiscalDescription: string; description: string; editableItemName: string;
  supplierCode: string; ean: string; tributaryEan: string; ncm: string; cfop: string;
  quantity: number; purchaseUnit: string; unitPrice: number; total: number;
  tributaryQuantity: number | null; tributaryUnit: string; tributaryUnitPrice: number | null;
  discount: number; shipping: number; insurance: number; otherCosts: number; includedInTotal: boolean | null;
  exact: { quantity: string; unitPrice: string; total: string; discount: string; shipping: string; insurance: string; otherCosts: string;
    tributaryQuantity: string | null; tributaryUnitPrice: string | null };
  inventoryItemId: string; stockQuantity: string;
};
export type NfePayment = {
  code: string; description: string; amount: number; amountExact: string; amountCents: number;
  timingCode: string; date: string; payerDocument: string; payerState: string;
  card: { integrationCode: string; brandCode: string; authorization: string; acquirerDocument: string } | null;
};
export type NfeDuplicate = {
  number: string; dueDate: string; amount: number; amountExact: string; amountCents: number;
};
export type NfePurchaseData = {
  nfeNumber: string; series: string; nfeKey: string; issueDate: string; issuedAt: string;
  vendorName: string; vendorDoc: string; supplier: NfeSupplier; items: NfePurchaseItem[];
  subtotal: number; discount: number; shipping: number; additionalCosts: number; total: number;
  exact: { subtotal: string; discount: string; shipping: string; additionalCosts: string; total: string };
  cents: { subtotal: number; discount: number; shipping: number; additionalCosts: number; total: number };
  totalComponents: Record<string, string>;
  payments: NfePayment[]; change: number; changeExact: string;
  billing: { invoiceNumber: string; originalAmount: string | null; discount: string | null; netAmount: string | null; duplicates: NfeDuplicate[] };
  review: { warnings: string[]; itemTotalsMatch: boolean; subtotalMatchesItems: boolean;
    duplicatesMatchTotal: boolean | null; duplicateDatesComplete: boolean; paymentsMatchTotal: boolean | null };
  /** A payment code/date in an XML is not confirmation of our cash movement. */
  markPaid: false;
};
/** Superset of the former Compras inline parser types; fiscal metadata is retained. */
export type NfeData = NfePurchaseData;
export type NfeItem = NfePurchaseItem;
function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(node => node.localName === name && (!node.namespaceURI || node.namespaceURI === NFE_NS));
}
const child = (parent: Element | undefined, name: string) => parent ? children(parent, name)[0] : undefined;
const rawText = (parent: Element | undefined, name: string) => child(parent, name)?.textContent ?? "";
const text = (parent: Element | undefined, name: string) => rawText(parent, name).trim();
function decimal(raw: string, label: string, places: number, required = true): Decimal {
  if (!raw && !required) raw = "0";
  if (!raw) throw new NfeImportError("missing_field", `O XML não informa ${label}.`);
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`);
  const value = Number(raw);
  if (!pattern.test(raw) || !Number.isFinite(value) || value < 0 || value > 1e9)
    throw new NfeImportError("invalid_number", `Confira ${label} no XML; o valor decimal é inválido.`);
  return { raw, value };
}
function money(raw: string, label: string, required = true): Money {
  const parsed = decimal(raw, label, 2, required);
  const [whole, fraction = ""] = parsed.raw.split(".");
  return { ...parsed, cents: Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) };
}
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : ""; const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
function roundedProductCents(quantity: string, unitPrice: string): number {
  const ratio = (raw: string): [bigint, bigint] => {
    const [whole, fraction = ""] = raw.split("."); return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
  };
  const [q, qs] = ratio(quantity), [p, ps] = ratio(unitPrice), scale = qs * ps;
  return Number((q * p * 100n * 2n + scale) / (2n * scale));
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Throws an actionable error. Only an explicit user confirmation can create stock/payables. */
export function parseNfePurchaseXml(xmlText: string): NfePurchaseData {
  if (typeof xmlText !== "string" || !xmlText.trim()) throw new NfeImportError("invalid_xml", "Selecione um XML de NF-e válido.");
  if (xmlText.length > MAX_NFE_XML_BYTES || new TextEncoder().encode(xmlText).byteLength > MAX_NFE_XML_BYTES)
    throw new NfeImportError("too_large", "O XML deve ter até 5 MB.");
  if (/<\s*!\s*(?:DOCTYPE|ENTITY)\b/i.test(xmlText))
    throw new NfeImportError("unsafe_xml", "O XML contém uma declaração de entidade ou DOCTYPE não permitida.");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const elements = Array.from(doc.getElementsByTagName("*"));
  if (elements.some(node => node.localName === "parsererror") || elements.length > 50000)
    throw new NfeImportError("invalid_xml", "O arquivo XML está malformado ou excede o limite de estrutura.");
  const invoices = elements.filter(node => node.localName === "infNFe" && (!node.namespaceURI || node.namespaceURI === NFE_NS));
  if (invoices.length !== 1) throw new NfeImportError("invalid_xml", "Selecione um XML com uma única NF-e.");
  const invoice = invoices[0], ide = child(invoice, "ide"), emit = child(invoice, "emit"), address = child(emit, "enderEmit");
  const totals = child(child(invoice, "total"), "ICMSTot");
  if (!ide || !emit || !totals) throw new NfeImportError("missing_field", "O XML deve conter identificação, fornecedor e totais da NF-e.");
  const nfeKey = (invoice.getAttribute("Id") ?? "").replace(/^NFe/, "");
  if (!/^\d{44}$/.test(nfeKey)) throw new NfeImportError("missing_field", "A chave da NF-e deve conter 44 dígitos.");
  const issuedAt = text(ide, "dhEmi") || text(ide, "dEmi"), issueDate = issuedAt.slice(0, 10);
  if (!validDate(issueDate)) throw new NfeImportError("missing_field", "O XML não informa uma data de emissão válida.");
  const supplier: NfeSupplier = {
    name: text(emit, "xNome"), tradeName: text(emit, "xFant"), document: text(emit, "CNPJ") || text(emit, "CPF"),
    documentType: text(emit, "CNPJ") ? "CNPJ" : text(emit, "CPF") ? "CPF" : null,
    stateRegistration: text(emit, "IE"), substituteStateRegistration: text(emit, "IEST"), municipalRegistration: text(emit, "IM"),
    economicActivityCode: text(emit, "CNAE"), taxRegimeCode: text(emit, "CRT"), phone: text(address, "fone"), email: text(emit, "email"),
    address: { street: text(address, "xLgr"), number: text(address, "nro"), complement: text(address, "xCpl"), district: text(address, "xBairro"),
      municipalityCode: text(address, "cMun"), municipality: text(address, "xMun"), state: text(address, "UF"), postalCode: text(address, "CEP"),
      countryCode: text(address, "cPais"), country: text(address, "xPais") },
  };
  const details = children(invoice, "det");
  if (!details.length || details.length > 500) throw new NfeImportError("invalid_xml", "A NF-e deve conter de 1 a 500 itens.");
  let itemTotalsMatch = true, lineSumCents = 0;
  const warnings: string[] = [];
  const items = details.map((det, index): NfePurchaseItem => {
    const prod = child(det, "prod"), label = `o item ${index + 1}`, fiscalDescription = rawText(prod, "xProd");
    if (!prod || !fiscalDescription.trim()) throw new NfeImportError("missing_field", `O XML não informa a descrição de ${label}.`);
    const quantity = decimal(text(prod, "qCom"), `a quantidade de ${label}`, 4);
    if (quantity.value <= 0) throw new NfeImportError("invalid_number", `A quantidade de ${label} deve ser maior que zero.`);
    const unitPrice = decimal(text(prod, "vUnCom"), `o preço unitário de ${label}`, 10);
    const tributaryQuantity = text(prod, "qTrib") ? decimal(text(prod, "qTrib"), `a quantidade tributável de ${label}`, 4) : null;
    const tributaryUnitPrice = text(prod, "vUnTrib") ? decimal(text(prod, "vUnTrib"), `o preço tributável de ${label}`, 10) : null;
    const total = money(text(prod, "vProd"), `o valor de ${label}`), discount = money(text(prod, "vDesc"), `o desconto de ${label}`, false);
    const shipping = money(text(prod, "vFrete"), `o frete de ${label}`, false), insurance = money(text(prod, "vSeg"), `o seguro de ${label}`, false);
    const other = money(text(prod, "vOutro"), `outras despesas de ${label}`, false);
    const inclusion = text(prod, "indTot");
    if (inclusion !== "0") lineSumCents += total.cents;
    if (roundedProductCents(quantity.raw, unitPrice.raw) !== total.cents) {
      itemTotalsMatch = false; warnings.push(`Item ${index + 1}: quantidade × preço não corresponde ao valor fiscal. Confira sem substituir o valor do XML.`);
    }
    if (inclusion === "0") warnings.push(`Item ${index + 1} está marcado como fora do total da NF-e. Confira antes de importar.`);
    return { number: det.getAttribute("nItem") ?? "", fiscalDescription, description: fiscalDescription, editableItemName: fiscalDescription.trim(),
      supplierCode: text(prod, "cProd"), ean: text(prod, "cEAN"), tributaryEan: text(prod, "cEANTrib"), ncm: text(prod, "NCM"), cfop: text(prod, "CFOP"),
      quantity: quantity.value, purchaseUnit: text(prod, "uCom"), unitPrice: unitPrice.value, total: total.value,
      tributaryQuantity: tributaryQuantity?.value ?? null, tributaryUnit: text(prod, "uTrib"), tributaryUnitPrice: tributaryUnitPrice?.value ?? null,
      discount: discount.value, shipping: shipping.value,
      insurance: insurance.value, otherCosts: other.value, includedInTotal: inclusion === "1" ? true : inclusion === "0" ? false : null,
      exact: { quantity: quantity.raw, unitPrice: unitPrice.raw, total: total.raw, discount: discount.raw, shipping: shipping.raw, insurance: insurance.raw, otherCosts: other.raw,
        tributaryQuantity: tributaryQuantity?.raw ?? null, tributaryUnitPrice: tributaryUnitPrice?.raw ?? null },
      inventoryItemId: "", stockQuantity: "" };
  });
  const subtotal = money(text(totals, "vProd"), "o subtotal"), discount = money(text(totals, "vDesc"), "o desconto total", false);
  const shipping = money(text(totals, "vFrete"), "o frete total", false), total = money(text(totals, "vNF"), "o total da NF-e");
  const additionalCents = total.cents - subtotal.cents + discount.cents - shipping.cents;
  const totalComponents = Object.fromEntries(Array.from(totals.children).filter(node => !node.namespaceURI || node.namespaceURI === NFE_NS)
    .map(node => [node.localName, node.textContent?.trim() ?? ""]));
  const paymentsParent = child(invoice, "pag"), paymentNodes = paymentsParent ? children(paymentsParent, "detPag") : [];
  if (paymentNodes.length > 120) throw new NfeImportError("invalid_xml", "O XML excede 120 formas de pagamento.");
  const payments = paymentNodes.map((node, index): NfePayment => {
    const amount = money(text(node, "vPag"), `o valor da forma de pagamento ${index + 1}`), card = child(node, "card");
    return { code: text(node, "tPag"), description: text(node, "xPag"), amount: amount.value, amountExact: amount.raw, amountCents: amount.cents,
      timingCode: text(node, "indPag"), date: text(node, "dPag"), payerDocument: text(node, "CNPJPag"), payerState: text(node, "UFPag"),
      card: card ? { integrationCode: text(card, "tpIntegra"), brandCode: text(card, "tBand"), authorization: text(card, "cAut"), acquirerDocument: text(card, "CNPJ") } : null };
  });
  const change = money(text(paymentsParent, "vTroco"), "o troco", false), billing = child(invoice, "cobr"), fat = child(billing, "fat");
  const duplicatesNodes = billing ? children(billing, "dup") : [];
  if (duplicatesNodes.length > 120) throw new NfeImportError("invalid_xml", "O XML excede 120 duplicatas.");
  const duplicates = duplicatesNodes.map((node, index): NfeDuplicate => {
    const amount = money(text(node, "vDup"), `o valor da duplicata ${index + 1}`);
    return { number: text(node, "nDup"), dueDate: text(node, "dVenc"), amount: amount.value, amountExact: amount.raw, amountCents: amount.cents };
  });
  const subtotalMatchesItems = lineSumCents === subtotal.cents;
  const duplicatesMatchTotal = duplicates.length ? duplicates.reduce((sum, duplicate) => sum + duplicate.amountCents, 0) === total.cents : null;
  const duplicateDatesComplete = duplicates.every(duplicate => validDate(duplicate.dueDate));
  const paymentsMatchTotal = payments.length ? payments.reduce((sum, payment) => sum + payment.amountCents, 0) - change.cents === total.cents : null;
  if (!subtotalMatchesItems) warnings.push("A soma dos itens que compõem a nota não corresponde ao subtotal fiscal. Confira o XML.");
  if (duplicatesMatchTotal === false) warnings.push("A soma das duplicatas difere do total da nota. Confirme os valores em aberto; nenhuma parcela será inventada.");
  if (!duplicateDatesComplete) warnings.push("Há duplicata sem vencimento válido. Confirme a data antes de gerar contas a pagar.");
  if (paymentsMatchTotal === false) warnings.push("Os pagamentos declarados, descontado o troco, diferem do total da nota. Confira as condições da compra.");
  const optionalBillingMoney = (key: string) => text(fat, key) ? money(text(fat, key), `o campo ${key} da fatura`).raw : null;
  return { nfeNumber: text(ide, "nNF"), series: text(ide, "serie"), nfeKey, issueDate, issuedAt,
    vendorName: supplier.tradeName || supplier.name, vendorDoc: supplier.document, supplier, items,
    subtotal: subtotal.value, discount: discount.value, shipping: shipping.value, additionalCosts: additionalCents / 100, total: total.value,
    exact: { subtotal: subtotal.raw, discount: discount.raw, shipping: shipping.raw, additionalCosts: formatCents(additionalCents), total: total.raw },
    cents: { subtotal: subtotal.cents, discount: discount.cents, shipping: shipping.cents, additionalCosts: additionalCents, total: total.cents }, totalComponents,
    payments, change: change.value, changeExact: change.raw, billing: { invoiceNumber: text(fat, "nFat"),
      originalAmount: optionalBillingMoney("vOrig"), discount: optionalBillingMoney("vDesc"), netAmount: optionalBillingMoney("vLiq"), duplicates },
    review: { warnings, itemTotalsMatch, subtotalMatchesItems, duplicatesMatchTotal, duplicateDatesComplete, paymentsMatchTotal }, markPaid: false };
}

/** Legacy object/null adapter. New import screens can use the strict parser to show its error. */
export function parseNfeXml(xmlText: string): NfePurchaseData | null {
  try { return parseNfePurchaseXml(xmlText); }
  catch (error) { if (error instanceof NfeImportError) return null; throw error; }
}

export type NfeInventoryCandidate = {
  id: string; name: string; unit: string; is_active?: boolean; category?: string | null; sku?: string | null;
  material_code?: string | null; color?: string | null; color_code?: string | null;
  ean?: string | null; barcode?: string | null; vendor_id?: string | null;
  supplierCodes?: { supplierDocument: string; code: string }[];
};
export type NfeInventoryProposal = { itemId: string; score: number; reasons: string[] };
function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9+]+/g, " ").trim(); }
const exactCode = (value: string) => value.trim().toUpperCase();
function phrase(haystack: string, needle: string): boolean { return !!needle && ` ${haystack} `.includes(` ${needle} `); }
function knownMaterial(value: string): string | null {
  const n = normalized(value);
  for (const code of ["PLA CF", "PLA SILK", "PLA+", "PETG CF", "PA CF", "PETG", "PLA", "ABS", "ASA", "TPU", "PVA", "HIPS", "PC", "PA"])
    if (phrase(n, code) || code === "PLA+" && phrase(n, "PLA PLUS")) return code;
  return null;
}
/** Every proposal requires confirmation. No item, mass or unit conversion is assigned. */
export function suggestNfeInventory(item: NfePurchaseItem, candidates: NfeInventoryCandidate[], options: {
  productStockItemIds: Iterable<string>; supplierDocument: string; vendorId?: string | null;
}): { candidates: NfeInventoryProposal[]; proposal: NfeInventoryProposal | null; ambiguous: boolean; requiresConfirmation: true; autoAssignItemId: null } {
  const owned = new Set(options.productStockItemIds), description = normalized(item.fiscalDescription), sourceMaterial = knownMaterial(item.fiscalDescription);
  const sourceCodes = [item.ean, item.tributaryEan].filter(code => /^\d{8}$|^\d{12,14}$/.test(code));
  const sourceSupplierCode = exactCode(item.supplierCode), supplierDocument = options.supplierDocument.replace(/\D/g, "");
  const ignoredWords = new Set(["FILAMENTO", "IMPRESSORA", "3D", "BOBINA", "ROLO", "KG", "G", "UN", "UNID", "PARA", "DE"]);
  const tokens = (value: string) => new Set(normalized(value).split(" ").filter(token => token.length > 1 && !/^\d+$/.test(token) && !ignoredWords.has(token)));
  const sourceTokens = tokens(item.fiscalDescription);
  const ranked: NfeInventoryProposal[] = [];
  for (const candidate of candidates) {
    if (owned.has(candidate.id) || candidate.is_active === false || ["product", "finished_product"].includes(candidate.category ?? "")) continue;
    let score = 0; const reasons: string[] = [];
    if (sourceCodes.some(code => code === candidate.ean || code === candidate.barcode)) { score += 140; reasons.push("EAN coincide"); }
    if (sourceSupplierCode && candidate.supplierCodes?.some(code => !!supplierDocument && code.supplierDocument.replace(/\D/g, "") === supplierDocument && exactCode(code.code) === sourceSupplierCode)) {
      score += 130; reasons.push("Código confirmado deste fornecedor coincide");
    } else if (sourceSupplierCode && exactCode(candidate.sku ?? "") === sourceSupplierCode) {
      const sameVendor = !!options.vendorId && candidate.vendor_id === options.vendorId;
      score += sameVendor ? 110 : 65; reasons.push(sameVendor ? "SKU e fornecedor coincidem" : "SKU coincide; confira o fornecedor");
    }
    const candidateMaterial = knownMaterial(candidate.material_code ?? "");
    if (sourceMaterial && candidateMaterial) {
      if (sourceMaterial === candidateMaterial) { score += 35; reasons.push("Material coincide"); }
      else { score -= 90; reasons.push("Material diverge; confira"); }
    }
    if ([candidate.color, candidate.color_code].some(color => color && phrase(description, normalized(color)))) { score += 35; reasons.push("Cor coincide"); }
    const candidateTokens = tokens(candidate.name), union = new Set([...sourceTokens, ...candidateTokens]);
    const overlap = [...candidateTokens].filter(token => sourceTokens.has(token)).length;
    if (overlap > 0) { score += Math.round(30 * overlap / union.size); reasons.push("Descrição semelhante"); }
    if (score >= 25) ranked.push({ itemId: candidate.id, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId));
  const ambiguous = ranked.length > 1 && ranked[0].score - ranked[1].score < 15;
  return { candidates: ranked.slice(0, 8), proposal: !ambiguous && ranked[0]?.score >= 70 ? ranked[0] : null,
    ambiguous, requiresConfirmation: true, autoAssignItemId: null };
}
