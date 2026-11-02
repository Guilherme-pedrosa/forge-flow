type OriginalRow = { index: number; raw: Record<string, unknown> };
type OriginalExtra = OriginalRow & { name: string; cost: number; costInput: string };
type OriginalKit = OriginalRow & { productId: string; quantity: number };
export type ProductExtraDraft = { name: string; cost: number; costInput?: string; original?: OriginalExtra };
export type ProductKitExtraDraft = { productId: string; qty: number; original?: OriginalKit };
export type ProductExtraDrafts = { regular: ProductExtraDraft[]; kits: ProductKitExtraDraft[] };
export type KitExtraComponent = { name: string; unitCost: number | null };
type ResolveKitComponent = (productId: string) => KitExtraComponent | undefined;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function amount(value: unknown, edited = false): number {
  if (value == null || value === "") return 0;
  const text = typeof value === "string" ? value.trim().replace(",", ".") : String(value);
  if (!/^\d+(?:\.\d*)?(?:e[+-]?\d+)?$/i.test(text)) throw new Error("Informe um custo válido para o adicional.");
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || edited && number > 1e9) throw new Error("Informe um custo válido para o adicional.");
  return number;
}
function quantity(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 10000) throw new Error("A quantidade do componente deve ser um inteiro entre 1 e 10000.");
  return number;
}
/** Full decimal text for the editor, including small numbers normally written
 * with an exponent. Opening a row must not round it to display cents. */
export function productExtraCostInput(value: unknown): string {
  if (value == null || value === "") return "";
  amount(value);
  if (typeof value === "string") return value.replace(".", ",");
  const [mantissa, exponent] = String(value).toLowerCase().split("e");
  if (exponent == null) return mantissa.replace(".", ",");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction, point = whole.length + Number(exponent);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return expanded.replace(".", ",");
}

/** Decimal half-up cents, applied only after an operator changes a cost or a
 * kit's component/quantity. Multiplication happens before rounding. */
function editedCents(value: unknown, multiplier = 1): number {
  const number = amount(value, true);
  const [mantissa, exponent = "0"] = String(number).toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = BigInt(whole + fraction) * BigInt(multiplier);
  const shift = Number(exponent) - fraction.length + 2;
  const cents = shift >= 0 ? digits * 10n ** BigInt(shift)
    : (digits * 2n + 10n ** BigInt(-shift)) / (2n * 10n ** BigInt(-shift));
  const result = Number(cents) / 100;
  if (result > 1e9) throw new Error("O custo do adicional está acima do limite.");
  return result;
}
function changedCost(draft: ProductExtraDraft) {
  return !draft.original || draft.cost !== draft.original.cost
    || draft.costInput !== undefined && draft.costInput !== draft.original.costInput;
}
function editedAmount(draft: ProductExtraDraft) {
  const inputChanged = draft.costInput !== undefined && (!draft.original || draft.costInput !== draft.original.costInput);
  return inputChanged ? draft.costInput : draft.cost;
}

/** The raw JSON belongs to its own row even after regular/kit rows are split,
 * removed or reordered in the editor. Unknown fields stay attached to it. */
export function readProductExtraDrafts(value: unknown): ProductExtraDrafts {
  if (value == null) return { regular: [], kits: [] };
  if (!Array.isArray(value)) throw new Error("Os adicionais do produto precisam ser uma lista.");
  const drafts: ProductExtraDrafts = { regular: [], kits: [] };
  value.forEach((row, index) => {
    if (!record(row)) throw new Error("Um adicional do produto possui formato inválido.");
    const raw = structuredClone(row);
    if (raw._kit_product_id != null) {
      if (typeof raw._kit_product_id !== "string" || !raw._kit_product_id.trim()) throw new Error("Confira o produto do componente do kit.");
      const productId = raw._kit_product_id, qty = quantity(raw._kit_qty ?? 1);
      drafts.kits.push({ productId, qty, original: { index, raw, productId, quantity: qty } });
    } else {
      const name = typeof raw.name === "string" ? raw.name : "", cost = amount(raw.cost), costInput = productExtraCostInput(raw.cost);
      drafts.regular.push({ name, cost, costInput, original: { index, raw, name, cost, costInput } });
    }
  });
  return drafts;
}

/** Calling blur on an untouched row is a no-op, including object identity. */
export function normalizeProductExtraCost(draft: ProductExtraDraft): ProductExtraDraft {
  if (!changedCost(draft)) return draft;
  const cost = editedCents(editedAmount(draft));
  return { ...draft, cost, costInput: cost.toFixed(2).replace(".", ",") };
}

/** Serialize edited fields while preserving untouched regular/kit JSON exactly.
 * Current component prices are consulted only for new or changed kit entries. */
export function serializeProductExtraDrafts(regular: ProductExtraDraft[], kits: ProductKitExtraDraft[], resolveKit: ResolveKitComponent): Record<string, unknown>[] {
  const indexed: { index: number; value: Record<string, unknown> }[] = [];
  const used = new Set<number>();
  let nextIndex = Math.max(-1, ...regular.map(row => row.original?.index ?? -1), ...kits.map(row => row.original?.index ?? -1)) + 1;
  const add = (value: Record<string, unknown>, source?: OriginalRow) => {
    const index = source?.index ?? nextIndex++;
    if (used.has(index)) throw new Error("Um adicional foi associado a mais de uma linha original.");
    used.add(index); indexed.push({ index, value });
  };
  for (const row of regular) {
    const costEdited = changedCost(row), nameEdited = !row.original || row.name !== row.original.name;
    if (row.original && !costEdited && !nameEdited) { add(structuredClone(row.original.raw), row.original); continue; }
    const name = row.name.trim(), cost = costEdited ? editedCents(editedAmount(row)) : row.original!.cost;
    if (!name) { if (cost > 0) throw new Error("Informe o nome do adicional com custo."); continue; }
    const result = structuredClone(row.original?.raw ?? {});
    if (nameEdited) result.name = name;
    if (costEdited) result.cost = cost;
    add(result, row.original);
  }
  for (const row of kits) {
    if (row.original && row.productId === row.original.productId && row.qty === row.original.quantity) {
      add(structuredClone(row.original.raw), row.original); continue;
    }
    if (!row.productId.trim()) throw new Error("Selecione o produto do componente do kit.");
    const qty = quantity(row.qty), component = resolveKit(row.productId);
    if (!component || component.unitCost == null) throw new Error("Confira o custo do produto escolhido para o kit.");
    const cost = editedCents(component.unitCost, qty);
    add({ ...structuredClone(row.original?.raw ?? {}), name: `🧩 ${component.name || "Produto"}${qty > 1 ? ` ×${qty}` : ""}`,
      cost, _kit_product_id: row.productId, _kit_qty: qty }, row.original);
  }
  return indexed.sort((left, right) => left.index - right.index).map(row => row.value);
}
