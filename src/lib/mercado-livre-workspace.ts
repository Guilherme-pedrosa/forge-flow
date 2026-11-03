import { z } from "zod";
import { requestIntegradorWorkspace, type IntegradorBridgeBinding, type IntegradorWorkspaceAction } from "./mercado-livre-integration";
import { marketplaceRpc } from "./marketplace-orders";

const txt = z.string().max(50000), nullable = txt.nullable(), id = z.string().min(1).max(160), amount = z.number().finite().nonnegative().nullable();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const listingDetailSchema = z.object({ item: z.object({ id, seller_id: id, title: txt, title_field: z.enum(["title", "family_name"]), description: txt, status: txt,
  sub_status: z.array(txt), tags: z.array(txt), price: amount, currency_id: nullable, available_quantity: amount, sold_quantity: amount,
  category_id: nullable, listing_type_id: nullable, catalog_product_id: nullable, user_product_id: nullable, permalink: nullable,
  pictures: z.array(z.object({ id: nullable, url: nullable })) }), editable: z.object({ title: z.boolean(), description: z.boolean(), pause: z.boolean(), activate: z.boolean(), reasons: z.array(txt) }), revision });
export type MercadoLivreListingDetail = z.infer<typeof listingDetailSchema>;
const question = z.object({ id, seller_id: id, item_id: txt, text: txt, status: txt, asked_at: nullable, answer: z.object({ text: txt, date: nullable }).nullable(), revision });
const message = z.object({ id, from: z.enum(["seller", "buyer"]), text: txt, status: txt, date: nullable });
export const conversationSchema = z.object({ pack_id: id, seller_id: id, messages: z.array(message).max(40), status: txt, substatus: nullable,
  can_reply: z.boolean(), pending: z.boolean(), last_message_at: nullable, revision });
export type MercadoLivreConversation = z.infer<typeof conversationSchema>;
const page = { offset: z.number().int().nonnegative(), limit: z.number().int().positive(), total: z.number().int().nonnegative(), next_offset: z.number().int().nonnegative().nullable() };
export const questionsSchema = z.object({ ...page, items: z.array(question).max(20) });
export type MercadoLivreQuestions = z.infer<typeof questionsSchema>;
export const conversationsSchema = z.object({ ...page, items: z.array(z.object({ pack_id: id, order_id: nullable, title: nullable, buyer_name: nullable, last_message: txt, last_message_at: nullable, pending: z.boolean() })).max(20) });
export type MercadoLivreConversations = z.infer<typeof conversationsSchema>;
const attributeValue = z.object({ id, name: txt });
export const publicationDraftSchema = z.object({ category_id: id.optional(), category_confirmed: z.boolean().optional(), listing_type_id: z.enum(["gold_special", "gold_pro"]).optional(),
  mode: z.enum(["own", "catalog", "link"]).optional(), catalog_product_id: id.optional(), reference_item_id: id.optional(),
  title: z.string().max(1000).optional(), description: txt.optional(), picture_urls: z.array(z.string().url().max(2048)).max(12).optional(), gtin: z.string().max(32).optional(), without_gtin: z.boolean().optional(),
  attributes: z.array(z.object({ id, value_id: id.optional(), value_name: txt.optional() })).max(100).optional(), shipping: z.object({ mode: z.literal("me2"), free_shipping: z.boolean(), local_pick_up: z.boolean() }).optional() });
export type MercadoLivrePublicationDraft = z.infer<typeof publicationDraftSchema>;
const signedAmount = z.number().finite().nullable();
export const publicationQuoteSchema = z.object({ revision, forge_revision: revision, quoted_at: id, account_id: id, product_id: id, seller_id: id,
  unit_cost: amount, cost_revision: id, policy_revision: id, unit_price: amount, category_id: nullable,
  quotes: z.array(z.object({ listing_type_id: z.enum(["gold_special", "gold_pro"]), official_revision: revision, commission_amount: amount, commission_percent: amount, fixed_fee: amount,
    shipping_cost: amount, shipping_coverage: nullable, receives: signedAmount, profit: signedAmount, margin_percent: signedAmount, tax_provision: amount,
    complete: z.boolean(), issues: z.array(txt).max(100) })).max(2),
  assumptions: z.object({ tax_provision_percent: amount, minimum_margin_percent: amount }) });
export type MercadoLivrePublicationQuote = z.infer<typeof publicationQuoteSchema>;
export const publicationSchema = z.object({ revision, forge_revision: revision, publication_sku: id, complete: z.boolean(), product_id: id, account_id: id, seller_id: id,
  product: z.object({ id, name: txt, sku: nullable, description: txt, photos: z.array(z.object({ url: txt, width: z.number(), height: z.number() })), material_name: nullable,
    dimensions: z.unknown().nullable(), shipping_package: z.unknown().nullable() }), price: z.object({ unit_price: amount, currency: nullable, acceptance_id: nullable }), stock: z.object({ available: amount }),
  category: z.object({ id, name: txt }).nullable(), category_suggestions: z.array(z.object({ category_id: id, category_name: txt, domain_name: nullable.optional() })),
  attributes: z.array(z.object({ id, name: txt, required: z.boolean(), value_type: nullable, values: z.array(attributeValue) })),
  resolved_attributes: z.array(z.object({ id, value_id: txt.optional(), value_name: txt.optional() })), draft: publicationDraftSchema,
  mode: z.enum(["own", "catalog", "link"]).optional(), description_required: z.boolean().optional(), title_field: z.enum(["title", "family_name"]).optional(), pricing_quote: publicationQuoteSchema.nullable().optional(),
  missing: z.array(z.object({ field: txt, message: txt })), issues: z.array(txt), manual_confirmation_required: z.literal(true) });
export type MercadoLivrePublication = z.infer<typeof publicationSchema>;
const receipt = z.object({ confirmed: z.literal(true), action: txt, request_id: id, item_id: id, item: listingDetailSchema, accepted_revision: revision, replayed: z.boolean(), linked: z.boolean().optional() });
export type MercadoLivreOperationReceipt = z.infer<typeof receipt>;
const replyReceipt = z.object({ confirmed: z.literal(true), action: z.enum(["question_reply", "message_reply"]), request_id: id, target_id: id, replayed: z.boolean(), status: txt.optional() });
type Context = { userId: string; signal?: AbortSignal };
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new Error("O Mercado Livre não confirmou todos os dados desta operação. Atualize a consulta para conferir."); return r.data; }
async function call<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, binding: IntegradorBridgeBinding, action: IntegradorWorkspaceAction, seller: string, payload: Record<string, unknown>, context: Context): Promise<T> {
  const value = parse(schema, await requestIntegradorWorkspace(binding, action, seller, payload, context));
  const result = value as Record<string, unknown>;
  const object = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const mismatch = () => { throw new Error("A confirmação não corresponde à conta e à operação selecionadas. Atualize a consulta antes de continuar."); };
  if (action === "listing_details") { const item = object(result.item); if (item.seller_id !== seller || item.id !== payload.item_id) mismatch(); }
  if (["listing_edit", "listing_status", "publication_commit"].includes(action)) {
    const item = object(object(result.item).item);
    if (result.action !== action || result.request_id !== payload.request_id || result.accepted_revision !== payload.expected_revision || item.seller_id !== seller
      || result.item_id !== item.id || action !== "publication_commit" && result.item_id !== payload.item_id || action === "publication_commit" && result.linked !== true) mismatch();
  }
  if (action === "publication_prepare" && (result.seller_id !== seller || result.account_id !== payload.account_id || result.product_id !== payload.product_id)) mismatch();
  if (action === "publication_quote" && (result.seller_id !== seller || result.account_id !== payload.account_id || result.product_id !== payload.product_id
    || payload.unit_price !== undefined && result.unit_price !== payload.unit_price)) mismatch();
  if (action === "publication_quote_accept" && (result.seller_id !== seller || result.account_id !== payload.account_id || result.product_id !== payload.product_id
    || result.request_id !== payload.request_id || result.quote_revision !== payload.expected_quote_revision || result.unit_price !== payload.unit_price
    || result.listing_type_id !== payload.listing_type_id)) mismatch();
  if (action === "message_read" && (result.seller_id !== seller || result.pack_id !== payload.pack_id)) mismatch();
  if (action === "message_mark_read" && result.pack_id !== payload.pack_id) mismatch();
  if (action === "questions_list" && (result.items as { seller_id: string }[]).some(item => item.seller_id !== seller)) mismatch();
  if (["question_reply", "message_reply"].includes(action) && (result.action !== action || result.request_id !== payload.request_id || result.target_id !== (payload.question_id || payload.pack_id))) mismatch();
  return value;
}
export const readMercadoLivreListing = (binding: IntegradorBridgeBinding, seller: string, itemId: string, context: Context) => call(listingDetailSchema, binding, "listing_details", seller, { item_id: itemId }, context);
export const changeMercadoLivreListing = (binding: IntegradorBridgeBinding, seller: string, itemId: string, changes: { title?: string; description?: string }, expected: string, requestId: string, context: Context) =>
  call(receipt, binding, "listing_edit", seller, { item_id: itemId, changes, expected_revision: expected, request_id: requestId, acknowledge_marketplace_write: true }, context);
export const changeMercadoLivreListingStatus = (binding: IntegradorBridgeBinding, seller: string, itemId: string, status: "active" | "paused", expected: string, requestId: string, context: Context) =>
  call(receipt, binding, "listing_status", seller, { item_id: itemId, status, expected_revision: expected, request_id: requestId, acknowledge_marketplace_write: true }, context);
export const readMercadoLivreQuestions = (binding: IntegradorBridgeBinding, seller: string, status: "UNANSWERED" | "ANSWERED" | "ALL", offset: number, context: Context) => call(questionsSchema, binding, "questions_list", seller, { status, offset }, context);
export const readMercadoLivreConversations = (binding: IntegradorBridgeBinding, seller: string, offset: number, context: Context) => call(conversationsSchema, binding, "messages_list", seller, { offset }, context);
export const readMercadoLivreConversation = (binding: IntegradorBridgeBinding, seller: string, packId: string, context: Context) => call(conversationSchema, binding, "message_read", seller, { pack_id: packId }, context);
export const markMercadoLivreConversationRead = (binding: IntegradorBridgeBinding, seller: string, packId: string, context: Context) =>
  call(z.object({ marked_read: z.literal(true), pack_id: id }), binding, "message_mark_read", seller, { pack_id: packId, acknowledge_marketplace_write: true }, context);
export const replyMercadoLivre = (binding: IntegradorBridgeBinding, seller: string, kind: "questions" | "messages", target: string, text: string, expected: string, requestId: string, context: Context) =>
  call(replyReceipt, binding, kind === "questions" ? "question_reply" : "message_reply", seller, { [kind === "questions" ? "question_id" : "pack_id"]: target, text, expected_revision: expected, request_id: requestId, acknowledge_marketplace_write: true }, context);
export const prepareMercadoLivrePublication = (binding: IntegradorBridgeBinding, seller: string, accountId: string, productId: string, draft: MercadoLivrePublicationDraft, context: Context) =>
  call(publicationSchema, binding, "publication_prepare", seller, { account_id: accountId, product_id: productId, draft }, context);
export const publishMercadoLivreProduct = (binding: IntegradorBridgeBinding, seller: string, accountId: string, productId: string, draft: MercadoLivrePublicationDraft, expected: string, requestId: string, context: Context) =>
  call(receipt, binding, "publication_commit", seller, { account_id: accountId, product_id: productId, draft, expected_revision: expected, request_id: requestId, acknowledge_marketplace_write: true }, context);
const categoryPath = z.array(z.object({ id, name: txt })).max(30);
const categoriesSchema = z.object({ items: z.array(z.object({ id, name: txt, domain_name: nullable.optional(), path: z.union([categoryPath, txt]).optional(), leaf: z.boolean().nullable().optional() })).max(1000), path: categoryPath.optional() });
export const searchMercadoLivreCategories = (binding: IntegradorBridgeBinding, seller: string, q: string, context: Context) =>
  call(categoriesSchema, binding, "publication_categories", seller, { q }, context);
export const browseMercadoLivreCategories = (binding: IntegradorBridgeBinding, seller: string, categoryId: string | undefined, context: Context) =>
  call(categoriesSchema, binding, "publication_categories", seller, categoryId ? { category_id: categoryId } : {}, context);
export const searchMercadoLivreCatalog = (binding: IntegradorBridgeBinding, seller: string, q: string, context: Context) =>
  call(z.object({ items: z.array(z.object({ id, name: txt, domain_id: nullable, category_id: nullable, permalink: nullable,
    attributes: z.array(z.object({ id, name: txt, value_name: nullable })).max(100) })).max(50) }), binding, "publication_catalog_search", seller, { q }, context);
export const readMercadoLivrePublicationReference = (binding: IntegradorBridgeBinding, seller: string, reference: string, context: Context) =>
  call(z.object({ mode: z.enum(["own", "catalog"]), catalog_product_id: nullable, reference_item_id: nullable, title: txt, description: nullable, category_id: nullable,
    pictures: z.array(z.object({ url: txt })).max(20), attributes: z.array(z.object({ id, value_id: txt.optional(), value_name: txt.optional() })).max(100), issues: z.array(txt).max(100) }),
  binding, "publication_reference", seller, { reference }, context);
export const quoteMercadoLivrePublication = (binding: IntegradorBridgeBinding, seller: string, accountId: string, productId: string, draft: MercadoLivrePublicationDraft, context: Context, unitPrice?: number) =>
  call(publicationQuoteSchema, binding, "publication_quote", seller, { account_id: accountId, product_id: productId, draft, ...(unitPrice !== undefined ? { unit_price: unitPrice } : {}) }, context);
export const acceptMercadoLivrePublicationQuote = (binding: IntegradorBridgeBinding, seller: string, accountId: string, productId: string, draft: MercadoLivrePublicationDraft,
  unitPrice: number, listingTypeId: "gold_special" | "gold_pro", expectedQuoteRevision: string, requestId: string, context: Context) =>
  call(z.object({ confirmed: z.literal(true), account_id: id, product_id: id, seller_id: id, acceptance_id: id, unit_price: z.number().finite().positive(),
    listing_type_id: z.enum(["gold_special", "gold_pro"]), request_id: id, quote_revision: revision, replayed: z.boolean() }), binding, "publication_quote_accept", seller,
  { account_id: accountId, product_id: productId, draft, unit_price: unitPrice, listing_type_id: listingTypeId, expected_quote_revision: expectedQuoteRevision, request_id: requestId, acknowledge_marketplace_write: true }, context);
export type MercadoLivreProductDetails = { name: string; description: string; dimensions: { length_mm: number | null; width_mm: number | null; height_mm: number | null };
  shipping_package: { length_cm: number | null; width_cm: number | null; height_cm: number | null; weight_grams: number | null }; photos: string[] };
export async function saveMercadoLivreProductDetails(accountId: string, productId: string, changes: MercadoLivreProductDetails, expected: string, requestId: string) {
  return parse(z.object({ saved: z.literal(true), product_id: id, revision, replayed: z.boolean() }), await marketplaceRpc("save_marketplace_publication_details", {
    p_account_id: accountId, p_product_id: productId, p_changes: changes, p_expected_revision: expected, p_request_id: requestId,
  }));
}
