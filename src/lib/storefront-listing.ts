export type StorefrontCategoryOption = { slug: string; name: string };

export function storefrontCategoryOptions(site: { content?: { categories?: unknown } } | null): StorefrontCategoryOption[] {
  const categories = site?.content?.categories;
  if (!Array.isArray(categories)) return [];
  return categories.flatMap(category => category?.enabled === true
    && typeof category.slug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(category.slug) && category.slug.length <= 80
    && typeof category.name === "string" && category.name.trim()
    ? [{ slug: category.slug, name: category.name.trim() }] : []);
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
export function findStorefrontCategory(value: string, categories: StorefrontCategoryOption[]) {
  return categories.find(category => normalize(category.slug) === normalize(value))
    ?? categories.find(category => normalize(category.name) === normalize(value));
}

export function storefrontPublicationError(product: { is_active: boolean; photo_url: string | null; sale_price: number | null }, priceOverride: string): string | null {
  if (!product.is_active) return "Ative o produto no cadastro do Forge antes de publicar.";
  const price = priceOverride.trim() === "" ? Number(product.sale_price) : Number(priceOverride.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) return "Informe um preço de venda maior que zero no Forge ou no campo Preço específico na loja.";
  if (!product.photo_url || !/^https:\/\/[^/@]+(\/|$)/.test(product.photo_url)) return "A foto do cadastro não possui um endereço HTTPS válido. Confira a foto em Editar produto e fotos.";
  return null;
}
