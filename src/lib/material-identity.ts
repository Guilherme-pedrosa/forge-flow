export const MATERIAL_CODES = [
  ["PLA", "PLA"], ["PLA+", "PLA+"], ["PLA-SILK", "PLA Silk"], ["PLA-CF", "PLA com fibra de carbono"],
  ["PETG", "PETG"], ["PETG-CF", "PETG com fibra de carbono"], ["ABS", "ABS"], ["ASA", "ASA"],
  ["TPU", "TPU"], ["PA", "Nylon / PA"], ["PA-CF", "Nylon / PA com fibra de carbono"],
  ["PC", "Policarbonato / PC"], ["PVA", "PVA"], ["HIPS", "HIPS"], ["RESIN", "Resina"], ["OTHER", "Outro material especificado"],
] as const;

export function normalizeMaterialIdentity(input: { materialCode: string; description: string; color: string; colorCode: string; colorHex: string }) {
  const material_code = input.materialCode.trim().toUpperCase() || null;
  const material_description = input.description.trim() || null;
  const color = input.color.trim() || null;
  const color_code = input.colorCode.trim().toUpperCase() || null;
  const color_hex = input.colorHex.trim().toUpperCase() || null;
  if (material_code && !MATERIAL_CODES.some(([code]) => code === material_code)) throw new Error("Selecione um material do catálogo.");
  if (material_code === "OTHER" && !material_description) throw new Error("Descreva a composição ou variante do material Outro.");
  if (color_code && (color_code.length > 64 || !/^[A-Z0-9#][A-Z0-9#_. /+\-]*$/.test(color_code))) throw new Error("Use um código de cor estável com letras e números.");
  if (color_hex && !/^#[0-9A-F]{6}$/.test(color_hex)) throw new Error("Informe a amostra visual no formato #RRGGBB.");
  return { material_code, material_description, color, color_code, color_hex };
}

export function materialColorSwatch(hex: string | null | undefined) {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "transparent";
}
