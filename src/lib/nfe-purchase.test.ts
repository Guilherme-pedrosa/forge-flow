import { describe, expect, it } from "vitest";
import { MAX_NFE_XML_BYTES, NfeImportError, parseNfePurchaseXml, parseNfeXml, suggestNfeInventory, type NfeInventoryCandidate } from "./nfe-purchase";

const key = "35261112345678000123550010000001231234567890";
const itemXml = `<det nItem="1"><prod><cProd>PLA-BR-01</cProd><cEAN>7891234567895</cEAN><xProd>Filamento PLA Branco 1,75 mm - 1kg (descrição fiscal)</xProd><NCM>39169090</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>50.0000000000</vUnCom><vProd>100.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>KG</uTrib><qTrib>2.0000</qTrib><vUnTrib>50.0000000000</vUnTrib><vFrete>4.20</vFrete><vSeg>0.10</vSeg><vDesc>0.30</vDesc><vOutro>0.20</vOutro><indTot>1</indTot></prod></det>`;
const paymentsXml = `<pag><detPag><indPag>0</indPag><tPag>17</tPag><vPag>40.00</vPag><dPag>2026-11-02</dPag></detPag><detPag><indPag>1</indPag><tPag>03</tPag><vPag>64.20</vPag><card><tpIntegra>2</tpIntegra><CNPJ>11222333000144</CNPJ><tBand>01</tBand><cAut>AUTORIZACAO-123</cAut></card></detPag><vTroco>0.00</vTroco></pag>`;
const billingXml = `<cobr><fat><nFat>FAT-123</nFat><vOrig>104.50</vOrig><vDesc>0.30</vDesc><vLiq>104.20</vLiq></fat><dup><nDup>001-A</nDup><dVenc>2026-11-17</dVenc><vDup>34.10</vDup></dup><dup><nDup>002-B</nDup><dVenc>2027-01-04</dVenc><vDup>70.10</vDup></dup></cobr>`;
function fixture(changes: { items?: string; payments?: string; billing?: string; totals?: string; emit?: string } = {}) {
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}" versao="4.00"><ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-11-02T09:40:00-03:00</dhEmi></ide>${changes.emit ?? `<emit><CNPJ>12345678000123</CNPJ><xNome>Fornecedor Razão Social Ltda</xNome><xFant>Loja das Cores</xFant><enderEmit><xLgr>Rua das Impressões</xLgr><nro>42</nro><xCpl>Sala 3</xCpl><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>São Paulo</xMun><UF>SP</UF><CEP>01001000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais><fone>1133334444</fone></enderEmit><IE>123456789</IE><IEST>111222</IEST><IM>9876</IM><CNAE>2229303</CNAE><CRT>3</CRT><email>fiscal@qa.invalid</email></emit>`}${changes.items ?? itemXml}<total><ICMSTot>${changes.totals ?? `<vProd>100.00</vProd><vFrete>4.20</vFrete><vSeg>0.10</vSeg><vDesc>0.30</vDesc><vOutro>0.20</vOutro><vNF>104.20</vNF>`}</ICMSTot></total>${changes.billing ?? billingXml}${changes.payments ?? paymentsXml}</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`;
}
const stock = (id: string, changes: Partial<NfeInventoryCandidate> = {}): NfeInventoryCandidate => ({ id, name: "PLA Branco", unit: "g", category: "filament", material_code: "PLA", color: "Branco", color_code: "WHITE", is_active: true, ...changes });
const options = { productStockItemIds: [] as string[], supplierDocument: "12345678000123", vendorId: "vendor" };

describe("NF-e XML purchase extraction draft", () => {
  it("offers the original object/null contract while retaining all extracted metadata", () => {
    expect(parseNfeXml(fixture())).toEqual(parseNfePurchaseXml(fixture()));
    expect(parseNfeXml("<invalid>")).toBeNull();
    expect(parseNfeXml("<!DOCTYPE NFe>" + fixture())).toBeNull();
  });
  it("reads default and prefixed namespaces and preserves fiscal text and identifiers separately", () => {
    const xml = fixture();
    const prefixed = xml.replace('xmlns="http://www.portalfiscal.inf.br/nfe"', 'xmlns:n="http://www.portalfiscal.inf.br/nfe"').replace(/<(\/?)([A-Za-z][\w]*)/g, "<$1n:$2");
    expect(parseNfePurchaseXml(prefixed)).toEqual(parseNfePurchaseXml(xml));
    const result = parseNfePurchaseXml(xml), item = result.items[0];
    expect(result).toMatchObject({ nfeNumber: "123", series: "1", nfeKey: key, issueDate: "2026-11-02", issuedAt: "2026-11-02T09:40:00-03:00" });
    expect(item).toMatchObject({ fiscalDescription: "Filamento PLA Branco 1,75 mm - 1kg (descrição fiscal)", description: "Filamento PLA Branco 1,75 mm - 1kg (descrição fiscal)", supplierCode: "PLA-BR-01", ean: "7891234567895", tributaryEan: "SEM GTIN", quantity: 2, purchaseUnit: "UN", inventoryItemId: "", stockQuantity: "" });
    item.editableItemName = "PLA Branco da Elevare";
    expect(item.fiscalDescription).toBe("Filamento PLA Branco 1,75 mm - 1kg (descrição fiscal)");
    expect(item.exact).toMatchObject({ quantity: "2.0000", unitPrice: "50.0000000000", total: "100.00", shipping: "4.20", discount: "0.30", tributaryQuantity: "2.0000", tributaryUnitPrice: "50.0000000000" });
    expect(item).toMatchObject({ purchaseUnit: "UN", tributaryUnit: "KG", quantity: 2, tributaryQuantity: 2 });
    expect(item).not.toHaveProperty("massPerPackage"); expect(item).not.toHaveProperty("spoolCapacity");
  });
  it("extracts known supplier identity, full address, registrations and contact without choosing a stored supplier", () => {
    expect(parseNfePurchaseXml(fixture()).supplier).toEqual({ name: "Fornecedor Razão Social Ltda", tradeName: "Loja das Cores", document: "12345678000123", documentType: "CNPJ", stateRegistration: "123456789", substituteStateRegistration: "111222", municipalRegistration: "9876", economicActivityCode: "2229303", taxRegimeCode: "3", phone: "1133334444", email: "fiscal@qa.invalid", address: { street: "Rua das Impressões", number: "42", complement: "Sala 3", district: "Centro", municipalityCode: "3550308", municipality: "São Paulo", state: "SP", postalCode: "01001000", countryCode: "1058", country: "BRASIL" } });
  });
  it("retains absent supplier fields as blank and recognizes CPF without invented contact/address", () => {
    const supplier = parseNfePurchaseXml(fixture({ emit: "<emit><CPF>12345678901</CPF><xNome>Pessoa Fornecedora</xNome></emit>" })).supplier;
    expect(supplier).toMatchObject({ documentType: "CPF", document: "12345678901", tradeName: "", phone: "", email: "", address: { street: "", number: "", postalCode: "" } });
  });
  it("reconciles money in integer cents, retains XML components and charges freight/discount exactly once", () => {
    const result = parseNfePurchaseXml(fixture());
    expect(result.cents).toEqual({ subtotal: 10000, discount: 30, shipping: 420, additionalCosts: 30, total: 10420 });
    expect(result.exact).toEqual({ subtotal: "100.00", discount: "0.30", shipping: "4.20", additionalCosts: "0.30", total: "104.20" });
    expect(result.totalComponents).toMatchObject({ vProd: "100.00", vSeg: "0.10", vOutro: "0.20", vNF: "104.20" });
    expect(result.review).toMatchObject({ itemTotalsMatch: true, subtotalMatchesItems: true });
  });
  it("uses decimal multiplication at half-cent boundaries and never replaces a mismatched fiscal total", () => {
    const xml = fixture({ items: itemXml.replace("2.0000", "1.0000").replace("50.0000000000", "1.0050000000").replace("100.00", "1.01"), totals: "<vProd>1.01</vProd><vNF>1.01</vNF>", billing: "", payments: "" });
    expect(parseNfePurchaseXml(xml).review.itemTotalsMatch).toBe(true);
    const mismatch = parseNfePurchaseXml(xml.replace("<vProd>1.01</vProd>", "<vProd>1.00</vProd>"));
    expect(mismatch.items[0].total).toBe(1); expect(mismatch.items[0].exact.unitPrice).toBe("1.0050000000");
    expect(mismatch.review.itemTotalsMatch).toBe(false); expect(mismatch.review.warnings.join(" ")).toContain("valor fiscal");
  });
  it("preserves mixed payment methods, raw codes, card metadata and dates without marking anything paid", () => {
    const result = parseNfePurchaseXml(fixture());
    expect(result.payments).toEqual([{ code: "17", description: "", amount: 40, amountExact: "40.00", amountCents: 4000, timingCode: "0", date: "2026-11-02", payerDocument: "", payerState: "", card: null }, { code: "03", description: "", amount: 64.2, amountExact: "64.20", amountCents: 6420, timingCode: "1", date: "", payerDocument: "", payerState: "", card: { integrationCode: "2", brandCode: "01", authorization: "AUTORIZACAO-123", acquirerDocument: "11222333000144" } }]);
    expect(result.markPaid).toBe(false); expect(result.review.paymentsMatchTotal).toBe(true);
    expect(result.payments[0]).not.toHaveProperty("payment_method_id"); expect(result.payments[0]).not.toHaveProperty("paid_at");
  });
  it("keeps real irregular duplicate dates/amounts/order rather than generating monthly installments", () => {
    const result = parseNfePurchaseXml(fixture());
    expect(result.billing).toEqual({ invoiceNumber: "FAT-123", originalAmount: "104.50", discount: "0.30", netAmount: "104.20", duplicates: [{ number: "001-A", dueDate: "2026-11-17", amount: 34.1, amountExact: "34.10", amountCents: 3410 }, { number: "002-B", dueDate: "2027-01-04", amount: 70.1, amountExact: "70.10", amountCents: 7010 }] });
    expect(result.review.duplicatesMatchTotal).toBe(true); expect(result.review.duplicateDatesComplete).toBe(true);
  });
  it("retains exact 0.10+0.20 duplicate totals without floating-point failures", () => {
    const result = parseNfePurchaseXml(fixture({ items: itemXml.replace("2.0000", "3.0000").replace("50.0000000000", "0.1000000000").replace("100.00", "0.30"), totals: "<vProd>0.30</vProd><vNF>0.30</vNF>", payments: "", billing: "<cobr><dup><nDup>A</nDup><dVenc>2026-12-01</dVenc><vDup>0.10</vDup></dup><dup><nDup>B</nDup><dVenc>2027-02-01</dVenc><vDup>0.20</vDup></dup></cobr>" }));
    expect(result.cents.total).toBe(30); expect(result.review.duplicatesMatchTotal).toBe(true);
  });
  it("leaves absent billing/payments empty instead of assuming one payable or cash payment", () => {
    const result = parseNfePurchaseXml(fixture({ billing: "", payments: "" }));
    expect(result.billing.duplicates).toEqual([]); expect(result.payments).toEqual([]); expect(result.markPaid).toBe(false);
    expect(result.review).toMatchObject({ duplicatesMatchTotal: null, paymentsMatchTotal: null });
  });
  it("flags duplicate mismatch/missing or invalid dates and leaves the actual XML values intact", () => {
    const result = parseNfePurchaseXml(fixture({ billing: billingXml.replace("2026-11-17", "2026-02-30").replace("70.10", "60.10") }));
    expect(result.billing.duplicates[0].dueDate).toBe("2026-02-30"); expect(result.billing.duplicates[1].amountExact).toBe("60.10");
    expect(result.review).toMatchObject({ duplicatesMatchTotal: false, duplicateDatesComplete: false });
  });
  it("handles declared change exactly and keeps unknown payment codes", () => {
    const result = parseNfePurchaseXml(fixture({ payments: "<pag><detPag><tPag>99</tPag><xPag>Condição específica</xPag><vPag>110.00</vPag></detPag><vTroco>5.80</vTroco></pag>" }));
    expect(result.payments[0]).toMatchObject({ code: "99", description: "Condição específica" }); expect(result.changeExact).toBe("5.80"); expect(result.review.paymentsMatchTotal).toBe(true);
  });
  it.each(["<!DOCTYPE nfeProc [<!ENTITY x SYSTEM 'file:///credentials'>]>", "<!DOCTYPE nfeProc>", "<!ENTITY x 'expansion'>"])("rejects unsafe XML declarations before DOM parsing: %s", declaration => {
    expect(() => parseNfePurchaseXml(declaration + fixture())).toThrow(/DOCTYPE/);
  });
  it("rejects oversized UTF-8 payloads, malformed XML, wrong/multiple NF-e and invalid fiscal decimals", () => {
    expect(() => parseNfePurchaseXml("x".repeat(MAX_NFE_XML_BYTES + 1))).toThrow(/5 MB/);
    expect(() => parseNfePurchaseXml("é".repeat(MAX_NFE_XML_BYTES / 2 + 1))).toThrow(/5 MB/);
    expect(() => parseNfePurchaseXml("<NFe>broken")).toThrow(NfeImportError);
    expect(() => parseNfePurchaseXml(fixture().replace(/http:\/\/www\.portalfiscal\.inf\.br\/nfe/g, "urn:wrong"))).toThrow(/única NF-e/);
    expect(() => parseNfePurchaseXml(`<batch>${fixture()}${fixture()}</batch>`)).toThrow(/única NF-e/);
    for (const raw of ["NaN", "-2", "1e2", "2,00", "2.00001"])
      expect(() => parseNfePurchaseXml(fixture().replace("<qCom>2.0000</qCom>", `<qCom>${raw}</qCom>`))).toThrow(/decimal/);
    expect(() => parseNfePurchaseXml(fixture().replace("<vDup>34.10</vDup>", "<vDup>34.101</vDup>"))).toThrow(/decimal/);
  });
});

describe("NF-e stock matching proposals", () => {
  const item = () => parseNfePurchaseXml(fixture()).items[0];
  it("excludes all product-owned, inactive and finished-product rows even when EAN is exact", () => {
    const result = suggestNfeInventory(item(), [stock("owned", { ean: "7891234567895" }), stock("inactive", { is_active: false, ean: "7891234567895" }), stock("finished", { category: "product", ean: "7891234567895" }), stock("material")], { ...options, productStockItemIds: ["owned"] });
    expect(result.candidates.map(row => row.itemId)).toEqual(["material"]); expect(result.autoAssignItemId).toBe(null); expect(result.requiresConfirmation).toBe(true);
  });
  it("ranks EAN and supplier-specific codes before descriptive identity without selecting stock or converting packages", () => {
    const source = item(), result = suggestNfeInventory(source, [stock("name"), stock("supplier", { supplierCodes: [{ supplierDocument: "12.345.678/0001-23", code: "PLA-BR-01" }] }), stock("ean", { ean: "7891234567895" })], options);
    expect(result.candidates.map(row => row.itemId)).toEqual(["ean", "supplier", "name"]);
    expect(result.ambiguous).toBe(true); expect(result.proposal).toBe(null); expect(source.inventoryItemId).toBe(""); expect(source.stockQuantity).toBe("");
  });
  it("offers a unique material/color match only for confirmation and does not infer package mass from description", () => {
    const result = suggestNfeInventory(item(), [stock("white"), stock("black", { name: "PLA Preto", color: "Preto", color_code: "BLACK" }), stock("petg", { name: "PETG Branco", material_code: "PETG" })], options);
    expect(result.proposal?.itemId).toBe("white"); expect(result.autoAssignItemId).toBe(null);
    expect(result).not.toHaveProperty("stockQuantity"); expect(result).not.toHaveProperty("massPerPackage");
  });
  it("does not propose either duplicate-looking filament and never transfers a supplier code across vendors", () => {
    const ambiguous = suggestNfeInventory(item(), [stock("A"), stock("B")], options);
    expect(ambiguous.ambiguous).toBe(true); expect(ambiguous.proposal).toBe(null);
    const differentVendor = suggestNfeInventory(item(), [stock("other", { supplierCodes: [{ supplierDocument: "99999999000199", code: "PLA-BR-01" }] })], options);
    expect(differentVendor.candidates[0].reasons).not.toContain("Código confirmado deste fornecedor coincide");
  });
  it("keeps PLA+, Silk and CF distinct from plain PLA and ignores SEM GTIN as an identifier", () => {
    const source = { ...item(), fiscalDescription: "Filamento PLA+ Branco", ean: "SEM GTIN", tributaryEan: "SEM GTIN" };
    const result = suggestNfeInventory(source, [stock("plain", { ean: "SEM GTIN" }), stock("plus", { name: "PLA+ Branco", material_code: "PLA+" })], options);
    expect(result.candidates[0].itemId).toBe("plus"); expect(result.candidates.some(row => row.reasons.includes("EAN coincide"))).toBe(false);
  });
  it("does not collapse distinct supplier code punctuation into an asserted exact match", () => {
    const source = { ...item(), supplierCode: "CODE-01" };
    const result = suggestNfeInventory(source, [stock("other", { sku: "CODE/01", supplierCodes: [{ supplierDocument: options.supplierDocument, code: "CODE 01" }] })], options);
    expect(result.candidates[0].reasons.every(reason => !/SKU|Código confirmado/.test(reason))).toBe(true);
  });
});
