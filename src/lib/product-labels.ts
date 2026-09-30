import { positiveInteger, nonNegative } from "./production";
export type ProductLabel = {
  name: string;
  sku: string;
  price: number;
  quantity: number;
};
export type LabelOptions = {
  mode: "none" | "url" | "pix";
  url: string;
  pixKey: string;
  receiver: string;
  city: string;
  pixAmount: boolean;
  showPrice: boolean;
};
export function crc16(payload: string) {
  let crc = 0xffff;
  for (const code of new TextEncoder().encode(payload)) {
    crc ^= code << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const tlv = (id: string, value: string) => {
  const size = new TextEncoder().encode(value).length;
  if (size > 99) throw new Error("Conteúdo do Pix excede o tamanho permitido.");
  return id + String(size).padStart(2, "0") + value;
};
const ascii = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 .-]/g, "")
    .trim();
/** BCB Manual de Padrões para Iniciação do Pix, 2.6. Static QR only. */
export function staticPix(
  key: string,
  receiver: string,
  city: string,
  amount?: number,
) {
  key = key.trim();
  receiver = ascii(receiver);
  city = ascii(city);
  if (
    !/^(?:\d{11}|\d{14}|\+[1-9]\d{7,14}|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/.test(
      key,
    ) ||
    key.length > 77
  )
    throw new Error(
      "Informe uma chave Pix válida: CPF/CNPJ sem pontuação, telefone com +55, e-mail ou chave aleatória.",
    );
  if (!receiver || receiver.length > 25 || !city || city.length > 15)
    throw new Error(
      "Informe o recebedor (até 25 caracteres) e a cidade (até 15).",
    );
  if (
    amount !== undefined &&
    (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99)
  )
    throw new Error("O valor do Pix deve ser maior que zero.");
  const payload =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", key)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (amount === undefined ? "" : tlv("54", amount.toFixed(2))) +
    tlv("58", "BR") +
    tlv("59", receiver) +
    tlv("60", city) +
    tlv("62", tlv("05", "***")) +
    "6304";
  return payload + crc16(payload);
}
export function labelQr(label: ProductLabel, options: LabelOptions) {
  if (options.mode === "none") return "";
  if (options.mode === "pix")
    return staticPix(
      options.pixKey,
      options.receiver,
      options.city,
      options.pixAmount ? label.price : undefined,
    );
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new Error("Informe um endereço HTTPS para o QR.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.length > 500
  )
    throw new Error(
      "Use um endereço HTTPS sem credenciais e de até 500 caracteres.",
    );
  return url.href;
}
export function validateLabels(labels: ProductLabel[], options: LabelOptions) {
  if (!labels.length) throw new Error("Adicione pelo menos um produto.");
  let count = 0;
  for (const label of labels) {
    if (!label.name.trim() || label.name.length > 200 || label.sku.length > 80)
      throw new Error("Revise o nome (até 200 caracteres) e o SKU (até 80).");
    count += positiveInteger(label.quantity, "Etiquetas", 500);
    if (options.showPrice || (options.mode === "pix" && options.pixAmount)) {
      if (!Number.isFinite(label.price)) throw new Error("Informe o preço da etiqueta ou desative a exibição de preço.");
      nonNegative(label.price, "Preço");
    }
    labelQr(label, options);
  }
  if (count > 500) throw new Error("Gere até 500 etiquetas por arquivo.");
  return count;
}
export async function productLabelsPdf(
  labels: ProductLabel[],
  options: LabelOptions,
) {
  validateLabels(labels, options);
  const [{ jsPDF }, QRCode] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const qrCache = new Map<string, string>();
  let index = 0;
  for (const label of labels) {
    const payload = labelQr(label, options);
    if (payload && !qrCache.has(payload))
      qrCache.set(
        payload,
        await QRCode.toDataURL(payload, {
          errorCorrectionLevel: "M",
          margin: 4,
          width: 400,
        }),
      );
    for (let copy = 0; copy < label.quantity; copy++, index++) {
      const cell = index % 18;
      if (index > 0 && cell === 0) pdf.addPage();
      const x = 10 + (cell % 3) * 64;
      const y = 10 + Math.floor(cell / 3) * 46;
      pdf.setDrawColor(185);
      pdf.setLineWidth(0.2);
      pdf.roundedRect(x, y, 62, 44, 1, 1);
      const textWidth = payload ? 31 : 54;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      const nameLines = pdf.splitTextToSize(label.name, textWidth) as string[];
      if (nameLines.length > 4)
        nameLines.splice(
          3,
          nameLines.length - 3,
          nameLines[3].replace(/.{3}$/, "..."),
        );
      pdf.text(nameLines, x + 4, y + 6);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const skuLines = pdf.splitTextToSize(
        label.sku || "Sem SKU",
        textWidth,
      ) as string[];
      pdf.text(skuLines.slice(0, 2), x + 4, y + 26);
      if (options.showPrice) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        const price = label.price.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        if (pdf.getTextWidth(price) > 54)
          pdf.setFontSize((12 * 54) / pdf.getTextWidth(price));
        pdf.text(price, x + 4, y + 39);
      }
      if (payload) {
        pdf.addImage(qrCache.get(payload)!, "PNG", x + 35, y + 3, 25, 25);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6);
        pdf.text(
          options.mode === "pix" ? "Pix" : "Saiba mais",
          x + 47.5,
          y + 30,
          { align: "center" },
        );
      }
    }
  }
  pdf.setProperties({
    title: "Etiquetas de produtos",
    subject: "Etiquetas 62 x 44 mm - imprimir em tamanho real",
  });
  return pdf;
}
