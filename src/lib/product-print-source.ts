export const MAX_PRINT_FILE_BYTES = 50 * 1024 * 1024;
export const PRINT_FILE_ACCEPT = ".stl,.3mf,.gcode";

export type PrintSourceIdentifiers = {
  design_id: string | null; instance_id: string | null; model_id: string | null;
  profile_id: string | null; plate_index: number | null;
};

export function validatePrintFile(file: Pick<File, "name" | "size">) {
  if (!/\.(stl|3mf|gcode)$/i.test(file.name)) throw new Error("Use um arquivo STL, 3MF ou GCODE.");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("O arquivo está vazio ou é inválido.");
  if (file.size > MAX_PRINT_FILE_BYTES) throw new Error("O arquivo deve ter no máximo 50 MB.");
}

export function safePrintFileName(name: string) {
  const basename = name.split(/[\\/]/).pop() || "arquivo";
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
}

export function normalizePrintSourceUrl(value: string): string | null {
  if (!value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Informe um link completo, começando com https://."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use um link HTTPS sem credenciais no endereço.");
  return url.toString();
}

/** Only the design number has the same meaning in the public URL and cloud history. */
export function makerWorldDesignId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["makerworld.com", "www.makerworld.com"].includes(url.hostname)) return null;
    return url.pathname.match(/(?:^|\/)models\/(\d+)(?:[-/]|$)/)?.[1] || null;
  } catch { return null; }
}

export function printSourceIdentifiers(input: Record<keyof PrintSourceIdentifiers, string>): PrintSourceIdentifiers {
  const optionalId = (value: string) => value.trim() || null;
  const plateValue = input.plate_index.trim();
  const plate = plateValue ? Number(plateValue) : null;
  if (plate != null && (!Number.isSafeInteger(plate) || plate < 0)) throw new Error("A placa deve ser um número inteiro maior ou igual a zero, conforme o histórico Bambu.");
  return {
    design_id: optionalId(input.design_id), instance_id: optionalId(input.instance_id),
    model_id: optionalId(input.model_id), profile_id: optionalId(input.profile_id), plate_index: plate,
  };
}

export function printSourceHasIdentifiers(source: Partial<PrintSourceIdentifiers>) {
  return Boolean(source.design_id || source.instance_id || source.model_id || source.profile_id);
}

export function printSourceNeedsTaskBinding(source: Partial<PrintSourceIdentifiers>) {
  const hasPair = Boolean((source.model_id && source.profile_id) || (source.design_id && source.instance_id));
  return !hasPair || source.plate_index == null;
}
