export type PieceMaterial = {
  item_id: string | null;
  material: string | null;
  color: string | null;
  grams: number | null;
  cost_per_kg: number | null;
  resolved_cost_per_kg?: number | null;
};
export type PieceTechnical = {
  source: "manual" | "plate" | "unknown";
  revision: string | null;
  materials: PieceMaterial[];
  grams?: number | null;
  print_seconds?: number | null;
  finishing_seconds?: number | null;
  machine_hour_cost?: number | null;
  labor_hour_cost?: number | null;
  extra_cost?: number | null;
  pieces_per_plate?: number | null;
  material_cost?: number | null;
  estimated_cost?: number | null;
  notes?: string;
  plate?: {
    id: string;
    label: string;
    grams: number | null;
    seconds: number | null;
    pieces: number | null;
  } | null;
};
export type PieceDraft = {
  basis: "piece" | "plate";
  units: string;
  minutes: string;
  finishing: string;
  machine: string;
  labor: string;
  extra: string;
  notes: string;
  revision: string | null;
  materials: {
    item_id: string;
    material: string;
    color: string;
    grams: string;
    cost_per_kg: string;
  }[];
};
const str = (v: number | null | undefined) =>
  v == null ? "" : String(Math.round(v * 1000000) / 1000000);
export function pieceDraft(spec?: PieceTechnical | null): PieceDraft {
  return {
    basis: "piece",
    units: str(spec?.pieces_per_plate),
    minutes: str(spec?.print_seconds == null ? null : spec.print_seconds / 60),
    finishing: str(
      spec?.finishing_seconds == null ? 0 : spec.finishing_seconds / 60,
    ),
    machine: str(spec?.machine_hour_cost),
    labor: str(spec?.labor_hour_cost ?? 0),
    extra: str(spec?.extra_cost ?? 0),
    notes: spec?.notes || "",
    revision: spec?.revision ?? null,
    materials: spec?.materials.length
      ? spec.materials.map((m) => ({
          item_id: m.item_id || "",
          material: m.material || "",
          color: m.color || "",
          grams: str(m.grams),
          cost_per_kg: str(m.cost_per_kg),
        }))
      : [{ item_id: "", material: "", color: "", grams: "", cost_per_kg: "" }],
  };
}
function optional(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100000000)
    throw new Error(`${label}: informe um número não negativo.`);
  return n;
}
export function changePieceBasis(
  d: PieceDraft,
  basis: PieceDraft["basis"],
): PieceDraft {
  if (basis === d.basis) return d;
  const n = Number(d.units.replace(",", "."));
  const units = Number.isInteger(n) && n > 0 && n <= 10000 ? n : 1;
  const factor = basis === "plate" ? units : 1 / units;
  const convert = (v: string) =>
    v.trim() && Number.isFinite(Number(v.replace(",", ".")))
      ? str(Number(v.replace(",", ".")) * factor)
      : v;
  return {
    ...d,
    basis,
    units: String(units),
    minutes: convert(d.minutes),
    materials: d.materials.map((m) => ({ ...m, grams: convert(m.grams) })),
  };
}
export function piecePayload(d: PieceDraft) {
  const units = optional(d.units, "Peças por placa");
  if (
    units !== null &&
    (!Number.isInteger(units) || units < 1 || units > 10000)
  )
    throw new Error("Informe de 1 a 10000 peças por placa.");
  if (d.basis === "plate" && !units)
    throw new Error(
      "Informe quantas peças iguais saem na placa para dividir peso e tempo.",
    );
  const divisor = d.basis === "plate" ? units! : 1;
  const minutes = optional(d.minutes, "Tempo de impressão"),
    finishing = optional(d.finishing, "Acabamento");
  return {
    revision: d.revision,
    materials: d.materials.map((m) => ({
      item_id: m.item_id || null,
      material: m.material.trim() || null,
      color: m.color.trim() || null,
      grams: m.grams.trim() ? optional(m.grams, "Filamento")! / divisor : null,
      cost_per_kg: optional(m.cost_per_kg, "Preço do filamento"),
    })),
    print_seconds: minutes == null ? null : (minutes * 60) / divisor,
    finishing_seconds: finishing == null ? null : finishing * 60,
    pieces_per_plate: units,
    machine_hour_cost: optional(d.machine, "Custo da máquina"),
    labor_hour_cost: optional(d.labor, "Mão de obra"),
    extra_cost: optional(d.extra, "Outros custos"),
    notes: d.notes.trim(),
  };
}
export const pieceNumber = (v: number | null | undefined, suffix = "") =>
  v == null
    ? "Não informado"
    : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}${suffix}`;
export function pieceTime(seconds: number | null | undefined) {
  if (seconds == null) return "Não informado";
  const s = Math.round(seconds),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return [
    h ? `${h}h` : "",
    m ? `${m}min` : "",
    s % 60 || (!h && !m) ? `${s % 60}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
type ForecastPart = {
  id: string;
  plate_id: string | null;
  quantity_per_plate: number | null;
  quantity_per_product: number | null;
  to_print: number;
  technical?: PieceTechnical;
};
export function pieceForecast(parts: ForecastPart[]) {
  const runs = new Map<string, number>();
  for (const p of parts)
    if (p.plate_id && p.quantity_per_plate && p.quantity_per_product != null)
      runs.set(
        p.plate_id,
        Math.max(
          runs.get(p.plate_id) || 0,
          Math.ceil(p.to_print / p.quantity_per_plate),
        ),
      );
  return parts.map((p) => {
    const count =
      p.quantity_per_product == null
        ? null
        : p.plate_id && p.quantity_per_plate
          ? (runs.get(p.plate_id) || 0) * p.quantity_per_plate
          : p.technical?.pieces_per_plate
            ? Math.ceil(p.to_print / p.technical.pieces_per_plate) *
              p.technical.pieces_per_plate
            : p.to_print;
    const estimate = (n?: number | null) =>
      count === 0 ? 0 : count != null && n != null ? count * n : null;
    return {
      id: p.id,
      count,
      grams: estimate(p.technical?.grams),
      seconds: estimate(p.technical?.print_seconds),
      cost: estimate(p.technical?.estimated_cost),
      surplus: count == null ? null : count - p.to_print,
    };
  });
}
