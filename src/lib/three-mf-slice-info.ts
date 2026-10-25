import { strFromU8, unzipSync } from "fflate";
import type { ImportedComposition, ImportedSlicerEstimates } from "./imported-composition";

const MAX_FILE = 80 * 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;
const children = (node: Element, name: string) => [...node.children].filter(child => child.localName === name);
function metadata(node: Element, key: string): string | null {
  const matches = children(node, "metadata").filter(child => child.getAttribute("key") === key);
  if (matches.length > 1) throw new Error(`O fatiamento repete o campo ${key}.`);
  return matches[0]?.getAttribute("value")?.trim() || null;
}
function number(value: string | null, label: string, max: number): number | null {
  if (value == null) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`O fatiamento contém ${label} inválido.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed > max) throw new Error(`O fatiamento contém ${label} fora do limite.`);
  return parsed;
}
function bounded(value: string | null, max: number, label: string) {
  if (value != null && (value.length > max || /[\u0000-\u001f]/.test(value))) throw new Error(`O fatiamento contém ${label} inválido.`);
  return value;
}

/** Read Bambu/Orca's authoritative per-plate slice plan. No Gcode execution,
 * network access, geometry estimates, per-part allocation or stock writes. */
export function slicedCompositionFrom3mf(bytes: Uint8Array, current: ImportedComposition): ImportedComposition {
  if (bytes.byteLength > MAX_FILE) throw new Error("Use um arquivo 3MF de até 80 MB.");
  let expanded = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    if (!/^Metadata\/slice_info\.config$/i.test(entry.name)) return false;
    expanded += entry.originalSize;
    if (expanded > MAX_XML) throw new Error("Os metadados de fatiamento excedem o limite de leitura.");
    return true;
  } });
  const slices = Object.values(entries);
  if (!slices.length) return current;
  if (slices.length > 1) throw new Error("O 3MF contém metadados de fatiamento repetidos.");
  const text = strFromU8(slices[0]);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("O fatiamento contém uma declaração XML não suportada.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "config") throw new Error("Não foi possível ler o XML de fatiamento do 3MF.");
  const header = children(doc.documentElement, "header")[0];
  const version = bounded(header && children(header, "header_item").find(node => node.getAttribute("key") === "X-BBL-Client-Version")?.getAttribute("value")?.trim() || null, 100, "versão do fatiador");
  const parsed = new Map<number, { weight: number | null; time: number | null; estimates: ImportedSlicerEstimates }>();
  const currentIndices = new Set(current.plates.map(plate => plate.index));
  const plates = children(doc.documentElement, "plate");
  if (plates.length > 100) throw new Error("O arquivo contém placas de fatiamento demais.");
  for (const plate of plates) {
    const index = number(metadata(plate, "index"), "índice de placa", 10000);
    if (index == null || !Number.isInteger(index) || index < 1 || parsed.has(index)) throw new Error("O fatiamento contém índices de placas inválidos ou repetidos.");
    if (!currentIndices.has(index)) throw new Error("As placas fatiadas não correspondem à composição do 3MF.");
    const weight = number(metadata(plate, "weight"), "peso", 1_000_000);
    const time = number(metadata(plate, "prediction"), "tempo", 31_536_000);
    const ids = new Set<number>();
    const filaments = children(plate, "filament").map(filament => {
      const id = number(filament.getAttribute("id"), "identificação de filamento", 1024);
      if (id == null || !Number.isInteger(id) || id < 1 || ids.has(id)) throw new Error("O fatiamento contém filamentos inválidos ou repetidos.");
      ids.add(id);
      const color = filament.getAttribute("color")?.trim() || null;
      if (color != null && !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) throw new Error("O fatiamento contém uma cor de filamento inválida.");
      return {
        id,
        material_code: bounded(filament.getAttribute("type")?.trim() || null, 100, "material"),
        color_hex: color?.toUpperCase() || null,
        weight_grams: number(filament.getAttribute("used_g"), "peso do filamento", 1_000_000),
        length_meters: number(filament.getAttribute("used_m"), "comprimento do filamento", 1_000_000),
      };
    });
    if (filaments.length > 1024) throw new Error("O fatiamento contém filamentos demais.");
    parsed.set(index, { weight: weight || null, time: time || null, estimates: {
      source: "3mf_slice_info", slicer_version: version,
      printer_model_id: bounded(metadata(plate, "printer_model_id"), 200, "impressora"),
      nozzle_diameters: bounded(metadata(plate, "nozzle_diameters"), 100, "bico"), filaments,
    } });
  }
  return { ...current, plates: current.plates.map(plate => {
    const slice = parsed.get(plate.index);
    return slice ? { ...plate, weight_grams: slice.weight, time_seconds: slice.time, slicer_estimates: slice.estimates } : plate;
  }) };
}
