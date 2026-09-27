import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import { externalImportReference } from "@/lib/makerworld-import";
import { importedComposition, importProductPhotos, validateImportedComposition } from "@/lib/imported-composition";
import { compositionFrom3mf } from "@/lib/three-mf-composition";
import apple from "./fixtures/apple-makerworld.json";

function realApple(profile = "2899977", technical = "706258524") {
  const model = normalizeMakerWorldDesign(apple, `https://makerworld.com/pt/models/2626659#profileId-${profile}`);
  const ref = externalImportReference(model, model.source_url, model.profiles.findIndex(p => p.instance_id === profile));
  ref.selected_variant_profile_id = technical;
  return ref;
}
function namedModel() {
  const model = normalizeMakerWorldDesign({ id: 92, title: "Caixa articulada", summary: "<p>Caixa com tampa e dobradiça.</p>", coverUrl: "https://example.test/box.png", instances: [{ id: 10, profileId: 100, extention: { modelInfo: { plates: [
    { index: 1, thumbnail: "https://example.test/base.png", objects: [{ id: 1, name: "Base.stl", quantity: 2 }] },
    { index: 2, thumbnail: "https://example.test/lid.png", objects: [{ id: 2, name: "Lid.stl" }, { id: 3, name: "Hinge pin.stl", count: 4 }] },
  ] } } }] }, "https://makerworld.com/pt/models/92");
  const ref = externalImportReference(model, model.source_url, 0); ref.selected_variant_profile_id = "100"; return ref;
}

describe("composição de qualquer modelo importado", () => {
  it("preserva descrição, fotos e três placas reais da maçã, sem inventar nomes e rendimento ausentes", () => {
    const ref = realApple(); const result = importedComposition(ref)!;
    expect(ref.description).toContain("thermoformed"); expect(importProductPhotos(ref)[0]).toBe(apple.coverUrl);
    expect(result.enabled).toBe(true); expect(result.plates).toHaveLength(3);
    expect(result.plates.map(p => p.weight_grams)).toEqual([11, 3, 3]);
    expect(result.plates.every(p => p.photo_url?.includes(`plate_${p.index}.png`) && p.units_per_plate === null && p.parts[0].name_source === "unknown")).toBe(true);
  });
  it("não associa peças pela posição: outro perfil da maçã tem placas em outra ordem", () => {
    const result = importedComposition(realApple("3614514", "945601812"))!;
    expect(result.plates.map(p => p.weight_grams)).toEqual([3, 3, 11]);
    expect(result.plates.every(p => p.parts[0].name_source === "unknown")).toBe(true);
  });
  it("outro produto com objetos nomeados monta peças sem depender de palavras maçã/caule/folha", () => {
    const result = importedComposition(namedModel())!;
    expect(result.enabled).toBe(true);
    expect(result.plates.flatMap(p => p.parts.map(part => part.name))).toEqual(["Base", "Tampa", "Hinge pin"]);
    expect(result.plates[0].parts[0].quantity_per_plate).toBe(2);
    expect(result.plates[1].parts[1].quantity_per_plate).toBe(4);
    expect(result.plates[0].parts[0].quantity_per_product).toBeNull();
  });
  it("usa foto técnica selecionada somente quando o autor não oferece foto do produto", () => {
    const ref = namedModel(); ref.thumbnail = null; ref.gallery = [];
    expect(importProductPhotos(ref)).toEqual(["https://example.test/base.png", "https://example.test/lid.png"]);
  });
  it("não mistura configurações e não deixa passar rendimento fracionado", () => {
    const ref = namedModel(); ref.selected_variant_profile_id = "999"; expect(importedComposition(ref)).toBeNull();
    const draft = importedComposition(namedModel())!; draft.plates[0].units_per_plate = 1.2;
    expect(() => validateImportedComposition(draft)).toThrow("inteiras");
  });
});

const project = (content: string) => zipSync({ "Metadata/model_settings.config": strToU8(content), "3D/3dmodel.model": strToU8("not read or rendered") });
const config = `<config><object id="1"><metadata key="name" value="Base.stl"/><part id="19"><metadata key="name" value="Colour region"/></part></object><object id="2"><metadata key="name" value="Lid.stl"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="1"/></model_instance></plate><plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="2"/></model_instance></plate></config>`;
describe("leitura de peças por placa do 3MF", () => {
  it("agrupa cópias de objetos e separa peças físicas de submalhas de cor", () => {
    const result = compositionFrom3mf(project(config), importedComposition(namedModel())!);
    expect(result.plates.flatMap(p => p.parts.map(part => part.name))).toEqual(["Base", "Tampa"]);
    expect(result.plates[0].parts[0]).toMatchObject({ quantity_per_plate: 2, quantity_per_product: null, name_source: "file" });
    expect(result.plates[0].units_per_plate).toBeNull();
  });
  it("recusa arquivo com placas diferentes, nomes ausentes e XML ativo", () => {
    const draft = importedComposition(namedModel())!;
    expect(() => compositionFrom3mf(project(config.replace('value="2"/><model_instance>', 'value="3"/><model_instance>')), draft)).toThrow("não correspondem");
    expect(() => compositionFrom3mf(project(config.replace('value="Base.stl"', 'value=""')), draft)).toThrow("nome");
    expect(() => compositionFrom3mf(project('<!DOCTYPE config SYSTEM "https://example.test">' + config), draft)).toThrow("XML");
  });
  it("recusa um arquivo de geometria sem distribuição de placas", () => {
    expect(() => compositionFrom3mf(zipSync({ "3D/3dmodel.model": strToU8("geometry") }), importedComposition(namedModel())!)).toThrow("projeto completo");
  });
});
