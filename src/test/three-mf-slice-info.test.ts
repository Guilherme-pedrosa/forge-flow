import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { slicedCompositionFrom3mf } from "@/lib/three-mf-slice-info";
import { parseModelFile, disposeModel } from "@/lib/model-file";
import type { ImportedComposition } from "@/lib/imported-composition";
import realSlice from "./fixtures/bambu-cube-slice-info.config?raw";

// Captured from installed Bambu Studio 02.08.02.61 slicing a synthetic 20mm
// cube with the official A1/0.4, 0.20 Standard and Generic PLA presets.
// Only the real, small slice_info metadata is retained, without user files.
const zip = (slice: string, other: Record<string, Uint8Array> = {}) => zipSync({
  "Metadata/slice_info.config": strToU8(slice), ...other,
});
const composition = (): ImportedComposition => ({ profile_id: "local", enabled: true, plates: [1, 2].map(index => ({
  index, label: `Placa ${index}`, photo_url: null, units_per_plate: null, weight_grams: null, time_seconds: null,
  parts: [{ source_key: `file-object:${index}`, name: `Peça ${index}`, photo_url: null, name_source: "file", quantity_per_plate: 4, quantity_per_product: null }],
})) });
const mesh = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
const modelConfig = '<config><object id="1"><metadata key="name" value="Cube.stl"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>';

describe("3MF plate plans from real slicer metadata", () => {
  it("imports actual prediction, grams, nozzle, slicer version and filament grams/meters without allocating mixed pieces", () => {
    const current = composition();
    const result = slicedCompositionFrom3mf(zip(realSlice), current);
    expect(result.plates[0]).toMatchObject({ weight_grams: 3.63, time_seconds: 1351, units_per_plate: null,
      slicer_estimates: { source: "3mf_slice_info", slicer_version: "02.08.02.61", nozzle_diameters: "0.4", printer_model_id: null,
        filaments: [{ id: 1, material_code: "PLA", color_hex: "#00AE42", weight_grams: 3.63, length_meters: 1.22 }] },
    });
    expect(result.plates[0].parts).toEqual(current.plates[0].parts);
    expect(result.plates[0].parts[0].quantity_per_product).toBeNull();
    expect(current.plates[0].weight_grams).toBeNull();
    expect(result.plates[1]).toBe(current.plates[1]);
  });
  it("uses exact plate indexes independent of XML order and does not manufacture missing or zero totals", () => {
    const two = `<config><plate><metadata key="index" value="2"/><metadata key="prediction" value="300"/><metadata key="weight" value="8.75"/></plate><plate><metadata key="index" value="1"/><metadata key="weight" value="0"/></plate></config>`;
    const result = slicedCompositionFrom3mf(zip(two), composition());
    expect(result.plates.map(plate => [plate.index, plate.weight_grams, plate.time_seconds])).toEqual([[1, null, null], [2, 8.75, 300]]);
    expect(result.plates.every(plate => plate.slicer_estimates?.filaments.length === 0)).toBe(true);
    expect(slicedCompositionFrom3mf(zipSync({ "unrelated": strToU8("geometry") }), composition()).plates[0].weight_grams).toBeNull();
  });
  it("direct upload keeps geometry/physical part identity and fills plate totals from sliced 3MF", () => {
    const file = parseModelFile(zip(realSlice, {
      "3D/3dmodel.model": strToU8(`<model><resources><object id="1">${mesh}</object></resources><build><item objectid="1"/></build></model>`),
      "Metadata/model_settings.config": strToU8(modelConfig),
    }), "cube-sliced.3mf");
    expect(file.group.children).toHaveLength(1);
    expect(file.composition.plates).toHaveLength(1);
    expect(file.composition.plates[0]).toMatchObject({ weight_grams: 3.63, time_seconds: 1351, parts: [{ name: "Cube", quantity_per_plate: 1, quantity_per_product: null }] });
    disposeModel(file.group);
  });
  it("supports core 3MF with one plate and slice metadata, while raw STL never invents slicer values", () => {
    const file = parseModelFile(zip(realSlice, {
      "3D/3dmodel.model": strToU8(`<model><resources><object id="1">${mesh}</object></resources><build><item objectid="1"/></build></model>`),
    }), "cube.3mf");
    expect(file.composition.plates[0].time_seconds).toBe(1351);
    disposeModel(file.group);
    const stl = parseModelFile(strToU8('solid cube\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid cube'), "cube.stl");
    expect(stl.composition.plates[0]).toMatchObject({ weight_grams: null, time_seconds: null });
    expect(stl.composition.plates[0].slicer_estimates).toBeUndefined();
    disposeModel(stl.group);
  });
  it("excludes a slicer-skipped instance from the physical yield using its exact identify_id", () => {
    const sliced = realSlice.replace('</plate>', '<object identify_id="16" name="cube.stl" skipped="true"/></plate>');
    const file = parseModelFile(zip(sliced, {
      "3D/3dmodel.model": strToU8(`<model><resources><object id="1">${mesh}</object></resources><build><item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></build></model>`),
      "Metadata/model_settings.config": strToU8('<config><object id="1"><metadata key="name" value="Cube"/></object><plate><metadata key="plater_id" value="1"/>' + [15,16].map((id,index)=>`<model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="${index}"/><metadata key="identify_id" value="${id}"/></model_instance>`).join("") + '</plate></config>'),
    }), "one-cube.3mf");
    expect(file.composition.plates[0].parts).toMatchObject([{ quantity_per_plate: 1 }]);
    expect(file.composition.plates[0].weight_grams).toBe(3.63);
    disposeModel(file.group);
  });
  it.each(["NaN", "Infinity", "-1", "3,63", "1e5", "1000001"])("rejects malformed/out-of-bounds plate weight %s instead of guessing", value => {
    expect(() => slicedCompositionFrom3mf(zip(realSlice.replace('key="weight" value="3.63"', `key="weight" value="${value}"`)), composition())).toThrow(/peso/);
  });
  it("rejects active/malformed XML, repeated indexes/fields and unmatched plate references", () => {
    for (const bad of ["<!DOCTYPE config>" + realSlice, "<config><plate></config>", realSlice.replace('key="index" value="1"', 'key="index" value="9"'), realSlice.replace('</plate>', '<metadata key="weight" value="2"/></plate>'), realSlice.replace('</config>', realSlice.match(/<plate>[\s\S]*<\/plate>/)![0] + '</config>')]) {
      expect(() => slicedCompositionFrom3mf(zip(bad), composition())).toThrow();
    }
  });
  it.each([
    realSlice.replace('used_g="3.63"', 'used_g="-2"'),
    realSlice.replace('used_m="1.22"', 'used_m="Infinity"'),
    realSlice.replace('color="#00AE42"', 'color="red"'),
    realSlice.replace('id="1" tray_info_idx', 'id="0" tray_info_idx'),
    realSlice.replace('</plate>', '<filament id="1" used_g="1"/></plate>'),
    realSlice.replace('key="prediction" value="1351"', 'key="prediction" value="31536001"'),
  ])("rejects unsafe or ambiguous filament/elapsed values", bad => {
    expect(() => slicedCompositionFrom3mf(zip(bad), composition())).toThrow();
  });
  it("bounds metadata inflation and ignores Gcode/mesh archives in the small metadata reader", () => {
    expect(() => slicedCompositionFrom3mf(zip("x".repeat(4 * 1024 * 1024 + 1)), composition())).toThrow(/limite/);
    expect(() => slicedCompositionFrom3mf(zip(realSlice, { "Metadata/plate_1.gcode": strToU8("x".repeat(5 * 1024 * 1024)) }), composition())).not.toThrow();
    expect(() => slicedCompositionFrom3mf(zip(realSlice, { "metadata/SLICE_INFO.config": strToU8(realSlice) }), composition())).toThrow(/repetidos/);
  });
});
