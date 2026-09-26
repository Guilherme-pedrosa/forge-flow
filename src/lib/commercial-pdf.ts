import { jsPDF } from "jspdf";
import { autoTable, type UserOptions } from "jspdf-autotable";
import { documentAddress, documentDate, documentFilename, documentMoney, documentStatus, type CommercialDocument, type DocumentCompany } from "./commercial-document";

export interface PdfImage { data: string; width: number; height: number }
export interface PdfAssets { logo?: PdfImage | null; items?: Map<string, PdfImage> }
const color = { ink: "#203331", muted: "#607370", brand: "#386F68", pale: "#F0F6F4", line: "#DCE6E2", white: "#FFFFFF" };
const margin = 16, width = 178, bottom = 278;
// The built-in PDF font supports Portuguese. Normalize typography and remove unsupported emoji/control glyphs.
export const pdfText = (value: unknown) => String(value ?? "").normalize("NFC").replace(/[\u2010-\u2015]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/[^\x20-\x7e\xa0-\xff\n]/g, "").trim();

/** Vector text and tables: searchable, sharp on A4, with no print dialog or screenshots. */
export function createCommercialPdf(document: CommercialDocument, company: DocumentCompany, assets: PdfAssets = {}) {
  if (!document.items.length) throw new Error("Inclua ao menos um item antes de baixar o PDF.");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  const title = document.kind === "quote" ? "ORÇAMENTO" : "PEDIDO DE VENDA";
  doc.setProperties({ title: `${title} ${document.code}`, subject: "Documento comercial", author: company.name, creator: "Forge Flow" });
  doc.setLanguage("pt-BR");
  const settings = company.settings && typeof company.settings === "object" ? company.settings as Record<string, unknown> : {};
  const setFont = (size = 10, bold = false, ink = color.ink) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(ink); };
  const lines = (text: unknown, maxWidth: number, size = 10, bold = false): string[] => {
    setFont(size, bold); return doc.splitTextToSize(pdfText(text), maxWidth) as string[];
  };
  const text = (value: unknown, x: number, y: number, size = 10, bold = false, ink = color.ink) => {
    setFont(size, bold, ink); doc.text(pdfText(value), x, y);
  };
  const rule = (y: number) => { doc.setDrawColor(color.line); doc.setLineWidth(0.3); doc.line(margin, y, margin + width, y); };
  const image = (asset: PdfImage, x: number, y: number, w: number, h: number) => {
    const scale = Math.min(w / asset.width, h / asset.height);
    const iw = asset.width * scale, ih = asset.height * scale;
    doc.addImage(asset.data, "PNG", x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, "FAST");
  };
  const continuedHeader = () => {
    text(company.name, margin, 18, 11, true);
    setFont(9, false, color.muted); doc.text(pdfText(document.code), 194, 18, { align: "right" }); rule(24);
  };
  const newPage = () => { doc.addPage(); continuedHeader(); return 34; };
  let y = 18;
  if (assets.logo) image(assets.logo, margin, y, 24, 24);
  const companyX = assets.logo ? 46 : margin;
  const companyWidth = assets.logo ? 78 : 108;
  const companyName = lines(company.name, companyWidth, 17, true);
  setFont(17, true); doc.text(companyName, companyX, 23);
  let companyY = 23 + companyName.length * 6.2;
  const phone = String(settings.phone || "").replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  const companyDetails = [settings.cnpj ? `CNPJ ${settings.cnpj}` : "", phone, settings.email, documentAddress(settings.address)].filter(Boolean);
  for (const detail of companyDetails) {
    const wrapped = lines(detail, companyWidth, 8.5);
    setFont(8.5, false, color.muted); doc.text(wrapped, companyX, companyY); companyY += wrapped.length * 3.8 + 0.5;
  }
  text(document.kind === "quote" ? "PROPOSTA COMERCIAL" : "DOCUMENTO COMERCIAL", 134, 20, 7.5, true, color.brand);
  text(title, 134, 29, document.kind === "quote" ? 19 : 13, true);
  const codeLines = lines(document.code, 60, 10, true);
  setFont(10, true); doc.text(codeLines, 134, 36);
  let metadataY = 36 + codeLines.length * 4.5;
  text(`Data: ${documentDate(document.date)}`, 134, metadataY, 8.5, false, color.muted);
  metadataY += 5;
  text(documentStatus(document.status), 134, metadataY, 8.5, true, document.status === "cancelled" || document.status === "rejected" ? "#A73D3D" : color.brand);
  y = Math.max(54, companyY + 6, metadataY + 8); rule(y); y += 9;

  const customer = document.customer;
  const customerLines = [customer.document ? `CPF/CNPJ: ${customer.document}` : "", [customer.phone, customer.email].filter(Boolean).join(" | "), documentAddress(customer.address)].filter(Boolean).flatMap(value => lines(value, 116, 9));
  const nameLines = lines(customer.name || "Cliente não informado", 116, 12, true);
  const customerHeight = Math.max(30, 15 + nameLines.length * 5 + customerLines.length * 4.2);
  doc.setFillColor(color.pale); doc.roundedRect(margin, y, width, customerHeight, 2, 2, "F");
  text("CLIENTE", 21, y + 7, 7.5, true, color.brand);
  setFont(12, true); doc.text(nameLines, 21, y + 14);
  if (customerLines.length) { setFont(9, false, color.muted); doc.text(customerLines, 21, y + 15 + nameLines.length * 5, { lineHeightFactor: 1.3 }); }
  const sideLabel = document.kind === "quote" ? "VALIDADE DA PROPOSTA" : "PREVISÃO DE ENTREGA";
  text(sideLabel, 145, y + 7, 7, true, color.brand);
  text(documentDate(document.kind === "quote" ? document.validUntil : document.dueDate), 145, y + 14, 10, true);
  y += customerHeight + 10;
  text("ITENS DO DOCUMENTO", margin, y, 8, true, color.brand); y += 4;

  const table = (options: UserOptions) => {
    autoTable(doc, {
      theme: "plain", margin: { left: margin, right: margin, top: 32, bottom: 21 },
      styles: { font: "helvetica", fontSize: 9, textColor: color.ink, cellPadding: 4, overflow: "linebreak", valign: "middle", lineColor: color.line, lineWidth: { bottom: 0.2 } },
      headStyles: { fillColor: color.brand, textColor: color.white, fontSize: 8, fontStyle: "bold", cellPadding: 4 },
      alternateRowStyles: { fillColor: "#F7F9F8" }, rowPageBreak: "avoid", showHead: "everyPage",
      willDrawPage: data => { if (data.pageNumber > 1) continuedHeader(); }, ...options,
    });
    return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  };
  y = table({
    startY: y, head: [["#", "PRODUTO / DESCRIÇÃO", "QTD.", "VALOR UNIT.", "TOTAL"]],
    body: document.items.map((item, index) => [String(index + 1), pdfText([item.description, item.details].filter(Boolean).join("\n")),
      Number(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 }), documentMoney(item.unitPrice), documentMoney(item.total)]),
    columnStyles: { 0: { cellWidth: 9, textColor: color.muted }, 1: { cellWidth: 87, fontSize: 10 }, 2: { cellWidth: 16, halign: "center" }, 3: { cellWidth: 32, halign: "right" }, 4: { cellWidth: 34, halign: "right", fontStyle: "bold" } },
    didParseCell: data => {
      if (data.column.index === 0) { data.cell.styles.cellPadding = { left: 1, right: 1, top: 4, bottom: 4 }; data.cell.styles.halign = "center"; }
      if (data.column.index === 2) data.cell.styles.halign = "center";
      if (data.column.index >= 3) data.cell.styles.halign = "right";
      if (data.section === "body" && data.column.index === 1) {
        const item = document.items[data.row.index];
        if (item.imageUrl && assets.items?.has(item.imageUrl)) { data.cell.styles.cellPadding = { left: 26, right: 4, top: 4, bottom: 4 }; data.cell.styles.minCellHeight = 26; }
      }
    },
    didDrawCell: data => {
      if (data.section === "body" && data.column.index === 1) {
        const asset = assets.items?.get(document.items[data.row.index]?.imageUrl || "");
        if (asset) image(asset, data.cell.x + 3, data.cell.y + 4, 19, Math.min(19, data.cell.height - 8));
      }
    },
  }) + 9;

  if (y + 50 > bottom) y = newPage();
  text("ENTREGA", margin, y + 3, 8, true, color.brand);
  text(documentDate(document.dueDate), margin, y + 10, 11, true);
  const addressLines = lines(document.deliveryAddress || "", 95, 9);
  if (addressLines.length && addressLines[0]) { setFont(9, false, color.muted); doc.text(addressLines.slice(0, 4), margin, y + 17); }
  if (!document.payments?.length) {
    text("PAGAMENTO", margin, y + 35, 8, true, color.brand);
    text(document.paymentDueDate ? `Vencimento em ${documentDate(document.paymentDueDate)}` : "A combinar", margin, y + 42, 10);
  }
  const totalsX = 124, totalsW = 70;
  [["Subtotal", documentMoney(document.subtotal)], ["Frete", documentMoney(document.shipping)], ["Desconto", document.discount ? `- ${documentMoney(document.discount)}` : documentMoney(0)]].forEach(([label, value], index) => {
    text(label, totalsX + 4, y + 3 + index * 7, 9, false, color.muted);
    setFont(10); doc.text(value, 190, y + 3 + index * 7, { align: "right" });
  });
  doc.setFillColor(color.brand); doc.roundedRect(totalsX, y + 23, totalsW, 21, 2, 2, "F");
  text("TOTAL", totalsX + 5, y + 30, 8, true, color.white);
  const totalText = documentMoney(document.total);
  setFont(18, true, color.white);
  doc.setFontSize(Math.min(18, 18 * 60 / Math.max(60, doc.getTextWidth(totalText))));
  doc.text(totalText, 189, y + 39, { align: "right" });
  y += 50;
  if (document.payments?.length) {
    // Keep short payment schedules together, including their section heading.
    if (y + Math.min(16 + document.payments.length * 12, 244) > bottom) y = newPage();
    text("CONDIÇÕES DE PAGAMENTO", margin, y, 8, true, color.brand);
    y = table({ startY: y + 4, head: [["PARCELA", "VENCIMENTO", "VALOR"]],
      body: document.payments.map((part, index) => [`${index + 1} / ${document.payments!.length}`, documentDate(part.due_date), documentMoney(part.amount)]),
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 91 }, 2: { cellWidth: 52, halign: "right" } },
    }) + 10;
  }
  const writeParagraph = (heading: string, content: string) => {
    if (y + 20 > bottom) y = newPage();
    text(heading, margin, y, 8, true, color.brand); y += 7;
    const contentLines = lines(content, width, 10);
    for (const line of contentLines) { if (y + 5 > bottom) y = newPage(); text(line, margin, y, 10); y += 4.8; }
    y += 6;
  };
  // Preserve the complete delivery address even when it is unusually long.
  if (addressLines.length > 4) writeParagraph("ENDEREÇO DE ENTREGA COMPLETO", document.deliveryAddress!);
  if (document.notes?.trim()) writeParagraph("CONDIÇÕES E OBSERVAÇÕES", document.notes);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); rule(282);
    text(company.name, margin, 288, 8, true, color.brand);
    setFont(8, false, color.muted); doc.text(pdfText(`${document.code}  |  Página ${page} de ${pages}`), 194, 288, { align: "right" });
  }
  return doc;
}

export async function downloadCommercialPdf(document: CommercialDocument, company: DocumentCompany, assets?: PdfAssets) {
  const pdf = createCommercialPdf(document, company, assets);
  await pdf.save(documentFilename(document), { returnPromise: true });
}
