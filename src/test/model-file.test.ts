import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { Box3 } from "three";
import { parseModelFile, disposeModel } from "@/lib/model-file";
const mesh =
  '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
const zip = (
  objects: string,
  build = '<item objectid="1"/>',
  extra: Record<string, string> = {},
) =>
  zipSync(
    Object.fromEntries(
      Object.entries({
        "3D/3dmodel.model": `<model unit="millimeter"><resources>${objects}</resources><build>${build}</build></model>`,
        ...extra,
      }).map(([k, v]) => [k, strToU8(v)]),
    ),
  );
describe("local printable project", () => {
  it("keeps repeated objects together and counts physical copies", () => {
    const file = parseModelFile(
      zip(
        `<object id="1" name="Leaf">${mesh}</object>`,
        '<item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 30 0 0"/>',
      ),
      "leaf.3mf",
    );
    expect(file.group.children).toHaveLength(2);
    expect(new Box3().setFromObject(file.group).max.x).toBe(31);
    expect(file.composition.plates[0].parts[0]).toMatchObject({
      name: "Folha",
      quantity_per_plate: 2,
      quantity_per_product: null,
    });
    disposeModel(file.group);
  });
  it("does not turn colored/component submeshes into separate physical pieces, including production paths", () => {
    const file = parseModelFile(
      zip(
        '<object id="1" name="Body"><components><component objectid="1" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" p:path="/3D/Objects/body.model"/></components></object>',
        undefined,
        {
          "3D/Objects/body.model": `<model><resources><object id="1">${mesh}</object></resources></model>`,
        },
      ),
      "body.3mf",
    );
    expect(file.composition.plates[0].parts).toHaveLength(1);
    expect(file.group.children[0].children).toHaveLength(1);
    disposeModel(file.group);
  });
  it("reads actual slicer plate membership and translated object names", () => {
    const file = parseModelFile(
      zip(`<object id="1">${mesh}</object>`, undefined, {
        "Metadata/model_settings.config":
          '<config><object id="1"><metadata key="name" value="Stem"/></object><plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>',
      }),
      "stem.3mf",
    );
    expect(file.composition.plates[0]).toMatchObject({
      index: 2,
      parts: [{ name: "Caule" }],
    });
    disposeModel(file.group);
  });
  it("counts only printable same-scale instances, preserving copies after translation and rotation", () => {
    const file = parseModelFile(zip(`<object id="1">${mesh}</object>`, '<item objectid="1"/><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 30 0 0"/><item objectid="1" printable="0"/>', {
      "Metadata/model_settings.config": '<config><object id="1"><metadata key="name" value="Leaf"/></object><plate><metadata key="plater_id" value="1"/>' + [0, 1, 2].map(index => `<model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="${index}"/></model_instance>`).join("") + '</plate></config>',
    }), "leaves.3mf");
    expect(file.group.children).toHaveLength(2);
    expect(file.composition.plates[0].parts).toMatchObject([{ name: "Folha", quantity_per_plate: 2, quantity_per_product: null }]);
    disposeModel(file.group);
  });
  it("separates differently scaled or mirrored instances instead of dividing their plate totals as equal pieces", () => {
    const config = '<config><object id="1"><metadata key="name" value="Leaf"/></object><plate><metadata key="plater_id" value="1"/>' + [0, 1, 2].map(index => `<model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="${index}"/></model_instance>`).join("") + '</plate></config>';
    const file = parseModelFile(zip(`<object id="1">${mesh}</object>`, '<item objectid="1"/><item objectid="1" transform="2 0 0 0 2 0 0 0 2 30 0 0"/><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 50 0 0"/>', { "Metadata/model_settings.config": config }), "leaves.3mf");
    expect(file.composition.plates[0].parts).toHaveLength(3);
    expect(file.composition.plates[0].parts.map(part => part.quantity_per_plate)).toEqual([1, 1, 1]);
    expect(new Set(file.composition.plates[0].parts.map(part => part.source_key)).size).toBe(3);
    expect(file.group.children.map(child => child.userData.partKey)).toEqual(file.composition.plates[0].parts.map(part => part.source_key));
    disposeModel(file.group);
  });
  it("rejects duplicated or missing physical membership instead of reporting the wrong yield", () => {
    const config = '<config><object id="1"><metadata key="name" value="Leaf"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate></config>';
    const create = (cfg: string) => parseModelFile(zip(`<object id="1">${mesh}</object>`, '<item objectid="1"/><item objectid="1"/>', { "Metadata/model_settings.config": cfg }), "leaves.3mf");
    expect(() => create(config)).toThrow(/repete a mesma/);
    expect(() => create(config.replace(/<model_instance>[\s\S]*?<\/model_instance>/, ""))).toThrow(/todas as instâncias/);
  });
  it("rejects cycles, missing components, invalid triangles and external entity XML", () => {
    expect(() =>
      parseModelFile(
        zip(
          '<object id="1"><components><component objectid="1"/></components></object>',
        ),
        "loop.3mf",
      ),
    ).toThrow(/circular/);
    expect(() =>
      parseModelFile(
        zip(`<object id="1">${mesh.replace('v3="2"', 'v3="9"')}</object>`),
        "bad.3mf",
      ),
    ).toThrow(/Triângulo/);
    expect(() =>
      parseModelFile(
        zip(
          '<object id="1"><components><component objectid="2"/></components></object>',
        ),
        "bad.3mf",
      ),
    ).toThrow(/ausente/);
    expect(() =>
      parseModelFile(
        zipSync({ "3D/3dmodel.model": strToU8("<!DOCTYPE model><model/>") }),
        "bad.3mf",
      ),
    ).toThrow(/XML/);
  });
});
