import { unzipSync, strFromU8 } from "fflate";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  sourcePartName,
  type ImportedComposition,
} from "./imported-composition";
import { compositionFrom3mf, type ThreeMfBuildInstances } from "./three-mf-composition";
import { slicedCompositionFrom3mf } from "./three-mf-slice-info";

export type ModelFile = {
  group: THREE.Group;
  composition: ImportedComposition;
  name: string;
};
const MAX_BYTES = 80 * 1024 * 1024;
const children = (node: Element, name: string) =>
  [...node.children].filter((n) => n.localName === name);
const metadata = (node: Element, key: string) =>
  children(node, "metadata")
    .find((n) => n.getAttribute("key") === key)
    ?.getAttribute("value");
function parseXml(bytes: Uint8Array) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Declarações XML externas não são suportadas.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("XML inválido no projeto 3MF.");
  return doc;
}
function transform(value: string | null) {
  if (!value) return new THREE.Matrix4();
  const n = value.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some((v) => !Number.isFinite(v)))
    throw new Error("Transformação inválida no 3MF.");
  return new THREE.Matrix4().set(
    n[0],
    n[3],
    n[6],
    n[9],
    n[1],
    n[4],
    n[7],
    n[10],
    n[2],
    n[5],
    n[8],
    n[11],
    0,
    0,
    0,
    1,
  );
}
const part = (id: string, name: string) => ({
  source_key: `file-object:${id}`,
  name: sourcePartName(name).slice(0, 200),
  photo_url: null,
  quantity_per_product: null,
  quantity_per_plate: 1,
  name_source: "file" as const,
});
export function disposeModel(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        material.dispose();
    }
  });
}

/** Core meshes and Production Extension component paths. Objects remain grouped;
 * material/color regions are never promoted to physical parts. No external fetch. */
export function parseModelFile(
  bytes: Uint8Array,
  name: string,
  current?: ImportedComposition,
): ModelFile {
  if (bytes.byteLength > MAX_BYTES)
    throw new Error("Use um arquivo de até 80 MB.");
  const group = new THREE.Group();
  let composition: ImportedComposition;
  try {
    if (/\.stl$/i.test(name)) {
      // Binary STL declares triangle count in its header; reject before allocation.
      if (
        bytes.length >= 84 &&
        new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true) * 50 +
          84 ===
          bytes.length &&
        new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true) >
          1_000_000
      )
        throw new Error("Use um STL com até 1 milhão de triângulos.");
      const geometry = new STLLoader().parse(bytes.slice().buffer);
      if (
        !geometry.attributes.position?.count ||
        geometry.attributes.position.count > 3_000_000
      ) {
        geometry.dispose();
        throw new Error("A geometria STL está vazia ou é muito grande.");
      }
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: "#4c9086",
          side: THREE.DoubleSide,
        }),
      );
      mesh.userData.partKey = "file-object:1";
      group.add(mesh);
      composition = {
        profile_id: "local",
        enabled: false,
        plates: [
          {
            index: 1,
            label: sourcePartName(name),
            photo_url: null,
            units_per_plate: null,
            weight_grams: null,
            time_seconds: null,
            parts: [part("1", name)],
          },
        ],
      };
    } else if (/\.3mf$/i.test(name)) {
      let expanded = 0;
      const entries = unzipSync(bytes, {
        filter: (e) => {
          if (
            !/\.model$|^Metadata\/model_settings\.config$|^_rels\/\.rels$/i.test(
              e.name,
            )
          )
            return false;
          expanded += e.originalSize;
          if (expanded > 120 * 1024 * 1024)
            throw new Error("A geometria descompactada excede 120 MB.");
          return true;
        },
      });
      const models = new Map(
        Object.entries(entries)
          .filter(([path]) => /\.model$/i.test(path))
          .map(([path, content]) => [path, parseXml(content)]),
      );
      const rootPath =
        (entries["_rels/.rels"] &&
          [
            ...parseXml(entries["_rels/.rels"]).getElementsByTagNameNS(
              "*",
              "Relationship",
            ),
          ]
            .find((n) => n.getAttribute("Type")?.endsWith("/3dmodel"))
            ?.getAttribute("Target")
            ?.replace(/^\//, "")) ||
        "3D/3dmodel.model";
      const root = models.get(rootPath);
      if (!root)
        throw new Error("O projeto não contém um modelo 3D principal.");
      let triangles = 0;
      const buildObject = (
        path: string,
        id: string,
        stack: string[] = [],
      ): THREE.Group => {
        const key = `${path}#${id}`;
        if (stack.includes(key) || stack.length > 20)
          throw new Error("Composição circular ou profunda demais.");
        const model = models.get(path)?.documentElement;
        const resources = model && children(model, "resources")[0];
        const object =
          resources &&
          children(resources, "object").find(
            (n) => n.getAttribute("id") === id,
          );
        if (!object) throw new Error(`Objeto ${id} ausente no projeto.`);
        const result = new THREE.Group();
        const mesh = children(object, "mesh")[0];
        if (mesh) {
          const vertices = children(children(mesh, "vertices")[0], "vertex");
          const faces = children(children(mesh, "triangles")[0], "triangle");
          triangles += faces.length;
          if (triangles > 1_000_000)
            throw new Error("Use um projeto com até 1 milhão de triângulos.");
          const positions = new Float32Array(vertices.length * 3);
          vertices.forEach((vertex, i) =>
            ["x", "y", "z"].forEach((axis, a) => {
              const n = Number(vertex.getAttribute(axis));
              if (!Number.isFinite(n) || Math.abs(n) > 1e7)
                throw new Error("Coordenada inválida.");
              positions[i * 3 + a] = n;
            }),
          );
          const indices = faces.flatMap((face) =>
            ["v1", "v2", "v3"].map((key) => {
              const n = Number(face.getAttribute(key));
              if (!Number.isInteger(n) || n < 0 || n >= vertices.length)
                throw new Error("Triângulo inválido.");
              return n;
            }),
          );
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3),
          );
          geometry.setIndex(indices);
          geometry.computeVertexNormals();
          result.add(
            new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({
                color: "#4c9086",
                side: THREE.DoubleSide,
              }),
            ),
          );
        } else {
          const components = children(object, "components")[0];
          if (!components)
            throw new Error(
              "Este arquivo usa uma geometria ainda não suportada.",
            );
          for (const component of children(components, "component")) {
            const external = [...component.attributes].find(
              (a) => a.localName === "path",
            )?.value;
            if (
              external &&
              (!external.startsWith("/") ||
                external.includes("..") ||
                external.includes(":"))
            )
              throw new Error("Caminho externo inválido no 3MF.");
            const child = buildObject(
              external?.slice(1) || path,
              component.getAttribute("objectid")!,
              [...stack, key],
            );
            child.applyMatrix4(transform(component.getAttribute("transform")));
            result.add(child);
          }
        }
        return result;
      };
      const build = children(root.documentElement, "build")[0];
      if (!build)
        throw new Error("O projeto não contém objetos para impressão.");
      const configBytes = Object.entries(entries).find(([path]) =>
        /^Metadata\/model_settings\.config$/i.test(path),
      )?.[1];
      const config = configBytes && parseXml(configBytes);
      const items = children(build, "item");
      if (!items.length || items.length > 1000)
        throw new Error("Quantidade de objetos não suportada.");
      const fallbackParts = new Map<string, ReturnType<typeof part>>();
      // The same mesh can be placed at different scales. Only repeated,
      // printable instances with equal linear geometry share a physical SKU.
      // Gram matrices ignore rotation/translation but retain scale and shear.
      const variants = new Map<string, Map<string, number>>();
      const placements = items.map(item => {
        const id = item.getAttribute("objectid")!;
        const printable = item.getAttribute("printable");
        if (printable != null && !["0", "1", "false", "true"].includes(printable)) throw new Error("Estado de impressão inválido no 3MF.");
        const matrix = transform(item.getAttribute("transform"));
        const e = matrix.elements;
        const vectors = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
        const gram = [[0, 0], [1, 1], [2, 2], [0, 1], [0, 2], [1, 2]].map(([a, b]) => vectors[a].reduce((sum, value, axis) => sum + value * vectors[b][axis], 0));
        if (gram.some(value => !Number.isFinite(value)) || !Number.isFinite(matrix.determinant()) || matrix.determinant() === 0) throw new Error("Escala inválida no 3MF.");
        const shape = gram.map(value => Math.round(value * 1_000_000) / 1_000_000).join(",") + (matrix.determinant() < 0 ? ",mirror" : "");
        const print = printable !== "0" && printable !== "false";
        const byShape = variants.get(id) || new Map<string, number>();
        if (print && !byShape.has(shape)) byShape.set(shape, byShape.size + 1);
        variants.set(id, byShape);
        return { item, id, matrix, shape, print };
      });
      const instances: ThreeMfBuildInstances = new Map();
      for (const { id, matrix, shape, print } of placements) {
        const shapes = variants.get(id)!;
        const variant = shapes.get(shape);
        const suffix = shapes.size > 1 && print ? ` (variação ${variant})` : "";
        const key = `file-object:${id}` + (suffix ? `:variant:${variant}` : "");
        const instance = { source_key: key, printable: print, suffix };
        instances.set(id, [...(instances.get(id) || []), instance]);
        if (!print) continue;
        const object = buildObject(rootPath, id);
        object.applyMatrix4(matrix);
        object.userData.partKey = key;
        group.add(object);
        const definition = [
          ...root.querySelectorAll("resources > object"),
        ].find((n) => n.getAttribute("id") === id);
        const label =
          config &&
          [...config.querySelectorAll("config > object")].find(
            (n) => n.getAttribute("id") === id,
          );
        const old = fallbackParts.get(key);
        if (old) old.quantity_per_plate++;
        else {
          const draft = part(id, (label && metadata(label, "name")) || definition?.getAttribute("name") || `Objeto ${id}`);
          fallbackParts.set(
            key,
            { ...draft, name: (draft.name + suffix).slice(0, 200), source_key: key },
          );
        }
      }
      const unit = root.documentElement.getAttribute("unit") || "millimeter";
      const scale = (
        {
          micron: 0.001,
          millimeter: 1,
          centimeter: 10,
          inch: 25.4,
          foot: 304.8,
          meter: 1000,
        } as Record<string, number>
      )[unit];
      if (!scale) throw new Error("Unidade de medida não suportada.");
      group.scale.setScalar(scale);
      if (config) {
        const plates = [...config.querySelectorAll("config > plate")]
          .filter((p) => p.querySelector("model_instance"))
          .map((p) => ({
            index: Number(metadata(p, "plater_id") || metadata(p, "plate_id")),
            label: "",
            photo_url: null,
            units_per_plate: null,
            weight_grams: null,
            time_seconds: null,
            parts: [],
          }));
        composition = compositionFrom3mf(
          bytes,
          current || {
            profile_id: "local",
            enabled: plates.length > 1,
            plates,
          },
          instances,
        );
      } else {
        if (current)
          throw new Error(
            "O 3MF não informa as placas para vincular ao perfil selecionado.",
          );
        composition = {
          profile_id: "local",
          enabled: fallbackParts.size > 1,
          plates: [
            {
              index: 1,
              label: sourcePartName(name),
              photo_url: null,
              units_per_plate: null,
              weight_grams: null,
              time_seconds: null,
              parts: [...fallbackParts.values()],
            },
          ],
        };
        composition = slicedCompositionFrom3mf(bytes, composition);
      }
    } else throw new Error("Selecione um arquivo STL ou 3MF.");
    const box = new THREE.Box3().setFromObject(group);
    if (
      box.isEmpty() ||
      !Number.isFinite(box.min.x) ||
      !Number.isFinite(box.max.x)
    )
      throw new Error("Nenhuma geometria válida encontrada.");
    return { group, composition, name };
  } catch (error) {
    disposeModel(group);
    throw error;
  }
}
