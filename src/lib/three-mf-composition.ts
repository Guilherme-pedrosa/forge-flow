import { strFromU8, unzipSync } from "fflate";
import { sourcePartName, type ImportedComposition, type ImportedPart } from "./imported-composition";

const MAX_FILE = 80 * 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;
function xml(source: Uint8Array): XMLDocument {
  const text = strFromU8(source);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("O arquivo contém uma declaração XML não suportada.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Não foi possível ler a composição XML do 3MF.");
  return doc;
}
const meta = (node: Element, key: string) => [...node.children].find(e => e.tagName === "metadata" && e.getAttribute("key") === key)?.getAttribute("value")?.trim() || null;

/** Read only the small slicer metadata, never inflate meshes or execute content.
 * Separate top-level object instances are parts; coloured submeshes are not.
 */
export function compositionFrom3mf(bytes: Uint8Array, current: ImportedComposition): ImportedComposition {
  if (bytes.byteLength > MAX_FILE) throw new Error("Use um arquivo 3MF de até 80 MB.");
  let expanded = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    if (!/^Metadata\/model_settings\.config$/i.test(entry.name)) return false;
    expanded += entry.originalSize;
    if (expanded > MAX_XML) throw new Error("Os metadados deste arquivo excedem o limite de leitura.");
    return true;
  } });
  const config = Object.entries(entries).find(([name]) => /^Metadata\/model_settings\.config$/i.test(name))?.[1];
  if (!config) throw new Error("Este 3MF não contém a distribuição de peças por placa. Exporte o projeto completo pelo Bambu Studio ou OrcaSlicer.");
  const doc = xml(config);
  const objects = new Map([...doc.querySelectorAll("config > object")].map(obj => [obj.getAttribute("id"), meta(obj, "name")]));
  const parsed = new Map<number, { label: string | null; parts: ImportedPart[] }>();
  for (const plate of doc.querySelectorAll("config > plate")) {
    const index = Number(meta(plate, "plater_id") || meta(plate, "plate_id"));
    if (!Number.isInteger(index) || index < 1 || index > 10000 || parsed.has(index)) throw new Error("O arquivo contém índices de placas inválidos ou repetidos.");
    const grouped = new Map<string, ImportedPart>();
    for (const instance of plate.querySelectorAll("model_instance")) {
      const objectId = meta(instance, "object_id");
      const name = objectId && objects.get(objectId);
      if (!objectId || !name) throw new Error(`O 3MF não informou o nome de um objeto da placa ${index}.`);
      const key = `file-object:${objectId}`;
      const old = grouped.get(key);
      grouped.set(key, old ? { ...old, quantity_per_plate: (old.quantity_per_plate || 0) + 1 } : {
        source_key: key, name: sourcePartName(name).slice(0, 200), photo_url: current.plates.find(p => p.index === index)?.photo_url || null,
        quantity_per_plate: 1, quantity_per_product: null, name_source: "file",
      });
      if (grouped.size > 500 || (grouped.get(key)?.quantity_per_plate || 0) > 10000) throw new Error("O arquivo contém peças demais para esta importação.");
    }
    if (grouped.size) parsed.set(index, { label: meta(plate, "plater_name"), parts: [...grouped.values()] });
  }
  if (parsed.size !== current.plates.length || current.plates.some(p => !parsed.has(p.index))) throw new Error("As placas do 3MF não correspondem à configuração selecionada. Use o arquivo do mesmo perfil e impressora.");
  return { ...current, enabled: current.enabled || [...parsed.values()].some(p => p.parts.length > 1), plates: current.plates.map(p => {
    const value = parsed.get(p.index)!;
    return { ...p, label: value.label ? sourcePartName(value.label).slice(0, 200) : value.parts.map(part => part.name).join(" + ").slice(0, 200), parts: value.parts };
  }) };
}
