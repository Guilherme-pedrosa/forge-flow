import type { MakerWorldPlate, MakerWorldVariant } from "../../supabase/functions/_shared/makerworld";
import type { ProductExternalImport } from "./makerworld-import";

export type ImportedPart = {
  source_key: string; name: string; photo_url: string | null;
  quantity_per_product: number | null; quantity_per_plate: number | null;
  name_source: "source" | "file" | "manual" | "unknown";
};
export type ImportedComponent = {
  index: number; label: string; photo_url: string | null; units_per_plate: number | null;
  weight_grams: number | null; time_seconds: number | null; parts: ImportedPart[];
};
export type ImportedComposition = { profile_id: string; enabled: boolean; plates: ImportedComponent[] };

export function selectedImportVariant(reference: ProductExternalImport): MakerWorldVariant | null {
  const profile = reference.profiles.find(p => p.instance_id === reference.selected_profile_id);
  return profile && [profile, ...profile.variants].find(p => p.profile_id === reference.selected_variant_profile_id) || null;
}

// Translate explicit source labels only. Never identify geometry from a colour,
// weight, plate number, product title or a different print profile.
const partWords: Record<string, string> = { leaf: "Folha", stem: "Caule", body: "Corpo", lid: "Tampa", base: "Base", bottom: "Parte inferior", top: "Parte superior", handle: "Alça", wheel: "Roda", screw: "Parafuso", cover: "Tampa", left: "Esquerda", right: "Direita", front: "Frente", back: "Traseira" };
export function sourcePartName(name: string): string {
  const cleaned = name.replace(/\.(?:stl|obj|3mf)$/i, "").replace(/_/g, " ").trim();
  return partWords[cleaned.toLowerCase()] || cleaned;
}

function componentFromPlate(plate: MakerWorldPlate): ImportedComponent | null {
  if (!plate.index || !Number.isInteger(plate.index)) return null;
  const photo = plate.thumbnail || plate.images[0] || null;
  const named = plate.objects.filter(object => object.name?.trim());
  const parts: ImportedPart[] = named.length ? named.map((object, index) => ({
    source_key: `object:${object.id || index + 1}:${index + 1}`, name: sourcePartName(object.name!), photo_url: photo,
    quantity_per_product: null, quantity_per_plate: object.quantity ?? null, name_source: "source",
  })) : [{ source_key: "plate", name: plate.name ? sourcePartName(plate.name) : `Conjunto da placa ${plate.index}`, photo_url: photo,
    quantity_per_product: null, quantity_per_plate: null, name_source: plate.name ? "source" : "unknown" }];
  return { index: plate.index, label: plate.name ? sourcePartName(plate.name) : parts.map(p => p.name).join(" + ").slice(0, 200),
    photo_url: photo, units_per_plate: null, weight_grams: plate.weight_grams, time_seconds: plate.time_seconds, parts };
}

export function importedComposition(reference: ProductExternalImport): ImportedComposition | null {
  const variant = selectedImportVariant(reference);
  if (!variant?.profile_id) return null;
  const plates = variant.plate_details.map(componentFromPlate).filter((p): p is ImportedComponent => !!p);
  if (!plates.length) return null;
  return { profile_id: variant.profile_id, enabled: plates.length > 1 || plates.some(p => p.parts.length > 1), plates };
}

export function importProductPhotos(reference: ProductExternalImport): string[] {
  // Prefer finished-product photography. Use selected plate previews only when
  // there is no product photo, rather than returning an empty photo field.
  const photos = [...new Set([reference.thumbnail, ...reference.gallery].filter((url): url is string => !!url))];
  const selected = selectedImportVariant(reference);
  return photos.length ? photos : [...new Set(selected?.plate_details.flatMap(p => [p.thumbnail, ...p.images].filter((url): url is string => !!url)) || [])];
}

export function validateImportedComposition(value: ImportedComposition) {
  const indices = new Set<number>();
  for (const plate of value.plates) {
    if (indices.has(plate.index)) throw new Error("Há placas repetidas nesta composição.");
    indices.add(plate.index);
    if (!plate.label.trim()) throw new Error("Informe o nome do conjunto da placa.");
    for (const amount of [plate.units_per_plate, ...plate.parts.flatMap(p => [p.quantity_per_product, p.quantity_per_plate])]) {
      if (amount != null && (!Number.isInteger(amount) || amount < 1 || amount > 10000)) throw new Error("As quantidades da composição devem ser inteiras, entre 1 e 10000.");
    }
    if (!plate.parts.length || plate.parts.some(p => !p.name.trim())) throw new Error("Informe o nome de cada peça da composição.");
  }
}
