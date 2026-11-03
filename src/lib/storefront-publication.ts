import { marketplaceRpc } from "./marketplace-orders";

export type StorefrontPublicationReceipt = { saved: true; listing_id: string; product_updated_at: string; listing_updated_at: string; replayed: boolean };
export type StorefrontPublicationSave = { p_channel_id: string; p_product_id: string; p_product_changes: Record<string, unknown>;
  p_settings: { published: boolean; category: string; price_override: number | null; made_to_order: boolean; lead_days: number };
  p_expected_product_updated_at: string; p_expected_listing_updated_at: string | null; p_request_id: string };
export async function saveStorefrontPublication(payload: StorefrontPublicationSave): Promise<StorefrontPublicationReceipt> {
  const value = await marketplaceRpc<unknown>("save_storefront_product_details", payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("O salvamento da publicação não foi confirmado. Tente conferir a mesma operação novamente.");
  const row = value as Record<string, unknown>;
  if (row.saved !== true || typeof row.listing_id !== "string" || !row.listing_id || typeof row.product_updated_at !== "string" || !row.product_updated_at
    || typeof row.listing_updated_at !== "string" || !row.listing_updated_at || typeof row.replayed !== "boolean")
    throw new Error("O salvamento da publicação não foi confirmado. Tente conferir a mesma operação novamente.");
  return { saved: true, listing_id: row.listing_id, product_updated_at: row.product_updated_at, listing_updated_at: row.listing_updated_at, replayed: row.replayed };
}
