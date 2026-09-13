export function productionSetting(value: string, label: string, isMargin = false): number {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error(`Informe um valor válido para ${label}.`);
  const number = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 1e9 || (isMargin && number >= 100)) {
    throw new Error(isMargin ? "A margem alvo deve estar entre 0% e menos de 100%." : `${label} deve ser um valor não negativo.`);
  }
  return number;
}

export function validateCompanyLogo(file: { type: string; size: number }) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 2 MB.");
}
