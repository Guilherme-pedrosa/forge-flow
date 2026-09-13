import { describe, expect, it } from "vitest";
import { normalizeMakerWorldDesign, normalizeMakerWorldHtml, parseMakerWorldUrl, makerWorldPlainText } from "../../supabase/functions/_shared/makerworld";

// Public response shape observed on Bambu's own API, 2026-09-13. Media paths are
// synthetic; no account, bearer, signed object URL or creator description is stored.
const img = (name: string) => `https://makerworld.bblmw.com/makerworld/model/fixture/${name}.png`;
const fil = (id: string, color: string, usedG: string) => ({ id, type: "PLA", color, usedG, usedM: "1" });
const plate = (index: number, weight: number, prediction: number, color: string) => ({ index, name: index === 2 ? "STEM" : "", weight, prediction, objects: [], thumbnail: { url: img(`plate_${index}`) }, filaments: [fil(String(index + 1), color, String(weight))] });
const realShape = () => ({
  id: 1169522, modelId: "USf7e5a3139d704e", title: "Gomu-Gomu No Mi Keychain", summary: `<p>Descrição &amp; instruções.</p><img src="${img("guide")}"><a href="https://example.test/manual">Manual</a>`,
  coverUrl: img("cover"), defaultInstanceId: 1177581, license: "BY-NC", tags: ["keychain"], categories: [{ name: "Accessories" }], designCreator: { name: "Author", handle: "creator" },
  designExtension: { design_pictures: [{ url: img("gallery") }], model_files: [{ modelName: "part.stl", modelType: "stl", modelSize: 1024, modelUrl: "", thumbnailUrl: img("model") }],
    boms: [{ title: "Key ring", sku: "RING", quantity: 1, url: "https://store.bambulab.com/products/ring" }],
    boms_of_filaments: [{ title: "PLA Matte / 1kg", weight: 1000, price: 25 }] },
  instances: [{ id: 1177581, profileId: 241221531, title: "Gomu Gomu No Mi", prediction: 3725, weight: 13, isDefault: true, needAms: false,
    pictures: [{ url: img("profile") }], instanceFilaments: [fil("2", "#996699", "12"), fil("3", "#FFCC66", "1")],
    extention: { modelInfo: { compatibility: { devModelName: "C12", devProductName: "P1S", nozzleDiameter: .4 }, plates: [plate(1, 12, 3121, "#996699"), plate(2, 1, 604, "#FFCC66")] },
      otherCompatibilityModelInfo: [{ devProductName: "A1", devModelName: "N2S", profileId: 824279339, weight: 13, prediction: 4601,
        modelInfo: { compatibility: { devProductName: "A1", nozzleDiameter: .4 }, plates: [plate(1, 12, 3900, "#996699"), plate(2, 1, 701, "#FFCC66")] } }] } },
    { id: 3696467, profileId: 977970029, title: "Large batch", weight: 189, prediction: 59193, extention: { modelInfo: { compatibility: { devProductName: "A1" }, plates: [plate(1, 180, 55448, "#996699"), plate(2, 9, 3745, "#FFCC66")] } } }],
});

describe("MakerWorld deterministic metadata", () => {
  it("reads current instances/usedG/extention fields and preserves public versus technical IDs", () => {
    const model = normalizeMakerWorldDesign(realShape(), "https://makerworld.com/en/models/1169522-keychain#profileId-1177581");
    expect(model).toMatchObject({ design_id: "1169522", model_id: "USf7e5a3139d704e", selected_instance_id: "1177581", selected_variant_profile_id: null, metadata_complete: true });
    expect(model.profiles).toHaveLength(2);
    expect(model.profiles[0]).toMatchObject({ instance_id: "1177581", profile_id: "241221531", name: "Gomu Gomu No Mi", weight_grams: 13, time_seconds: 3725, plates: 2, printer_model: "P1S" });
    expect(model.profiles[0].filaments.map(f => [f.color, f.grams])).toEqual([["#996699", 12], ["#FFCC66", 1]]);
    expect(model.profiles[0].plate_details.map(p => [p.index, p.weight_grams, p.time_seconds])).toEqual([[1, 12, 3121], [2, 1, 604]]);
  });
  it("keeps machine variants and different batches separate rather than summing them into one product", () => {
    const model = normalizeMakerWorldDesign(realShape());
    expect(model.profiles[0].variants[0]).toMatchObject({ profile_id: "824279339", printer_model: "A1", weight_grams: 13, time_seconds: 4601 });
    expect(model.profiles[1]).toMatchObject({ instance_id: "3696467", profile_id: "977970029", weight_grams: 189, time_seconds: 59193 });
    expect(model.selected_instance_id).toBeNull(); expect(model.selected_variant_profile_id).toBeNull(); expect(model.plates).toBeNull();
    expect(model.profiles.flatMap(p => p.plate_details).every(p => p.units_per_plate === null)).toBe(true);
  });
  it("preserves gallery, embedded author photos, descriptions, author, license and file availability", () => {
    const model = normalizeMakerWorldDesign(realShape());
    expect(model.description).toBe("Descrição & instruções.\nManual");
    expect(model.images).toEqual(expect.arrayContaining([img("cover"), img("gallery"), img("guide"), img("profile"), img("plate_1"), img("plate_2")]));
    expect(model.images.length).toBe(new Set(model.images).size);
    expect(model.gallery).toEqual(expect.arrayContaining([img("cover"), img("gallery"), img("guide"), img("profile")]));
    expect(model.gallery).not.toContain(img("plate_1")); expect(model.gallery).not.toContain(img("plate_2"));
    expect(model.author).toMatchObject({ name: "Author", handle: "creator" }); expect(model.license).toBe("BY-NC");
    expect(model.files[0]).toMatchObject({ name: "part.stl", download_available: false, url: null });
    expect(model.accessories[0]).toMatchObject({ name: "Key ring", quantity: 1 });
    expect(model.documentation[0].url).toBe("https://example.test/manual");
  });
  it("does not discard useful metadata when no print profile, weight or time is available", () => {
    const model = normalizeMakerWorldDesign({ id: 22, title: "Artwork", summary: "Author description", coverUrl: img("art") });
    expect(model.profiles).toEqual([]); expect(model.thumbnail).toBe(img("art")); expect(model.description).toBe("Author description");
    expect(model.plates).toBeNull(); expect(model.metadata_complete).toBe(false); expect(model.warnings.join(" ")).toContain("não forneceu perfis");
  });
  it("missing material/color/consumption stay null, without PLA or zero defaults", () => {
    const model = normalizeMakerWorldDesign({ id: 22, title: "Unknown print", instances: [{ id: 100, profileId: 200, extention: { modelInfo: { plates: [{ index: 1, filaments: [{ id: "1" }] }] } } }] });
    const profile = model.profiles[0]; expect(profile.weight_grams).toBeNull(); expect(profile.time_seconds).toBeNull();
    expect(profile.filaments[0]).toMatchObject({ id: "1", type: null, color: null, grams: null }); expect(profile.name).toBeNull();
  });
  it("does not double-count the same data across profile, plate and storefront BOM scopes", () => {
    const source = realShape(); const model = normalizeMakerWorldDesign(source);
    expect(model.profiles[0].weight_grams).toBe(13); expect(model.profiles[0].filaments.reduce((sum, f) => sum + f.grams!, 0)).toBe(13);
    source.instances[0].weight = 20;
    const conflict = normalizeMakerWorldDesign(source); expect(conflict.profiles[0].weight_grams).toBe(20);
    expect(conflict.profiles[0].plate_details.reduce((sum, p) => sum + p.weight_grams!, 0)).toBe(13);
    expect(conflict.warnings.join(" ")).toContain("difere da soma");
  });
  it("uses complete scoped sums only, so partially known plates cannot become a false total", () => {
    const source = { id: 22, title: "Two plates", instances: [{ id: 100, profileId: 200, plates: [{ index: 1, weight: 5, prediction: 100 }, { index: 2 }] }] };
    const profile = normalizeMakerWorldDesign(source).profiles[0]; expect(profile.weight_grams).toBeNull(); expect(profile.time_seconds).toBeNull();
    expect(profile.plate_details[0].weight_grams).toBe(5);
  });
  it("accepts exact metric units and full duration strings, but never arbitrary text numbers", () => {
    const source = { id: 22, title: "Legacy structured metadata", profileList: [{ id: 100, profileId: 200, weight: "0.125 kg", estimatedTime: "1h 2min 3s" }] };
    expect(normalizeMakerWorldDesign(source).profiles[0]).toMatchObject({ weight_grams: 125, time_seconds: 3723 });
    source.profileList[0].weight = "Store 1000g spool"; source.profileList[0].estimatedTime = "3 profiles 15h";
    expect(normalizeMakerWorldDesign(source).profiles[0]).toMatchObject({ weight_grams: null, time_seconds: null });
  });
  it("does not infer a numeric instance from a technical profile ID or unavailable URL selection", () => {
    const model = normalizeMakerWorldDesign(realShape(), "https://makerworld.com/en/models/1169522#profileId-241221531");
    expect(model.selected_instance_id).toBeNull(); expect(model.warnings.join(" ")).toContain("perfil público 241221531");
    expect(() => normalizeMakerWorldDesign(realShape(), "https://makerworld.com/en/models/99")).toThrow("não corresponde");
  });
  it("reads structured HTML or OG metadata only and rejects challenge pages", () => {
    const url = "https://makerworld.com/en/models/1169522";
    const html = `<script nonce="safe" id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { design: realShape() } } })}</script>`;
    expect(normalizeMakerWorldHtml(html, url).profiles[0].weight_grams).toBe(13);
    const og = `<meta content='Public title' property='og:title'><meta property='og:image' content='${img("cover")}'><div>Store spool 1kg, print 1000 g, other profile 45h, 9 plates</div>`;
    const fallback = normalizeMakerWorldHtml(og, url); expect(fallback.profiles).toEqual([]); expect(fallback.plates).toBeNull(); expect(fallback.warnings[0]).toContain("Importação parcial");
    expect(() => normalizeMakerWorldHtml('<title>Just a moment...</title><meta property="og:title" content="MakerWorld">', url)).toThrow("bloqueou");
    expect(() => normalizeMakerWorldHtml(html, "https://makerworld.com/en/models/99")).toThrow("não corresponde");
  });
  it("converts markup to plain text and never returns executable image protocols", () => {
    expect(makerWorldPlainText('<p>Peça &quot;A&quot;</p><script>steal()</script><style>bad</style><p>&#x1F600;</p>')).toBe('Peça "A"\n😀');
    const model = normalizeMakerWorldDesign({ id: 22, title: "Photo", summary: '<img src="javascript:steal()"><img src="data:image/svg+xml,unsafe">', coverUrl: "https://user:password@example.test/image.jpg" });
    expect(model.images).toEqual([]); expect(model.thumbnail).toBeNull();
  });
});
describe("MakerWorld URL identity", () => {
  it("extracts exact localized design links and public profile selection", () => {
    expect(parseMakerWorldUrl("https://www.makerworld.com/pt/models/1169522-name?from=search#profileId-1177581")).toEqual({ designId: "1169522", instanceId: "1177581", url: "https://makerworld.com/en/models/1169522#profileId-1177581" });
    expect(parseMakerWorldUrl("https://makerworld.com/en/models/1169522?profileId=1177581").instanceId).toBe("1177581");
  });
  it("rejects fake hosts, credentials, malformed IDs, conflicting profiles and MakerLab tool links", () => {
    for (const url of ["http://makerworld.com/en/models/22", "https://makerworld.com.evil.test/en/models/22", "https://user:secret@makerworld.com/en/models/22", "https://makerworld.com/en/models/22bad", "https://makerworld.com/en/models/22?profileId=2#profileId-3"]) expect(() => parseMakerWorldUrl(url)).toThrow();
    expect(() => parseMakerWorldUrl("https://makerworld.com/en/makerlab/makeMySign")).toThrow("ferramenta MakerLab");
  });
});
