export type BambuOutcome = "completed" | "failed";

/** Bambu Studio TaskManager: 1/4 in progress, 2 success, 3 failed. */
export function bambuTaskStatus(status: unknown): { label: string; terminal: boolean; outcome: BambuOutcome | null } {
  switch (String(status ?? "")) {
    case "1":
    case "4": return { label: "Em andamento", terminal: false, outcome: null };
    case "2": return { label: "Concluída", terminal: true, outcome: "completed" };
    case "3": return { label: "Interrompida / falhou", terminal: true, outcome: "failed" };
    default: return { label: "Desconhecido", terminal: false, outcome: null };
  }
}

export interface BambuMeasurementSource {
  status: unknown;
  weight_grams: number | null;
  cost_time_seconds: number | null;
  start_time: string | null;
  end_time: string | null;
}

const finiteNonNegative = (value: number | null) => value != null && Number.isFinite(value) && value >= 0 ? value : null;

/** Reported weight and costTime describe the slicer plan, not measured usage. */
export function bambuMeasurementDefaults(task: BambuMeasurementSource) {
  const status = bambuTaskStatus(task.status);
  const start = task.start_time ? Date.parse(task.start_time) : NaN;
  const end = task.end_time ? Date.parse(task.end_time) : NaN;
  const elapsedSeconds = status.terminal && Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 60 * 86400000 ? (end - start) / 1000 : null;
  const plannedGrams = finiteNonNegative(task.weight_grams);
  return {
    ...status,
    elapsedSeconds,
    plannedSeconds: finiteNonNegative(task.cost_time_seconds),
    plannedGrams,
    // An interrupted print never consumes the whole sliced plate by default.
    suggestedGrams: status.outcome === "completed" ? plannedGrams : null,
    gramsBasis: status.outcome === "completed" && plannedGrams != null ? "slicer" as const : null,
  };
}

export function formatBambuSeconds(value: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "Não informado";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours ? `${hours} h` : null, minutes ? `${minutes} min` : null, remaining || !seconds ? `${remaining} s` : null].filter(Boolean).join(" ");
}

export function requiredBambuNumber(value: string, label: string, options: { positive?: boolean; integer?: boolean } = {}) {
  if (!value.trim()) throw new Error(`Informe ${label}, inclusive zero quando não houver.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (options.positive && parsed <= 0)) throw new Error(`${label}: informe um número ${options.positive ? "positivo" : "não negativo"}.`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${label}: informe um número inteiro.`);
  return parsed;
}
