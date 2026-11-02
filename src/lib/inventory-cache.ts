import type { QueryClient } from "@tanstack/react-query";

/** Stock receipts and manual changes affect the material rate used throughout
 * pricing. Keep the inventory, recipe and import readers on the same revision. */
export async function invalidateInventoryPricing(client: Pick<QueryClient, "invalidateQueries">): Promise<void> {
  await Promise.all([
    "inventory_items", "inventory_movements", "recipe_inventory_items",
    "import-pricing-filaments", "pricing-materials", "pricing-consumables",
    "product_material_recipe", "product_material_requirements", "product_print_plate_preparation",
    "product_pricing_preview", "products", "pricing-products", "quote_products", "piece_spec", "assembly_status",
    "filament-planning", "daily-operations", "capacity_data",
  ].map(key => client.invalidateQueries({ queryKey: [key] })));
}
