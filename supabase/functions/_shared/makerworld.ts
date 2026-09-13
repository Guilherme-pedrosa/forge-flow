/** Deterministic MakerWorld metadata. Never substitutes stock items or infers print yield. */
export interface MakerWorldFilament {
  id: string | null; type: string | null; color: string | null; grams: number | null; meters: number | null;
}
export interface MakerWorldObject { id: string | null; name: string | null; }
export interface MakerWorldPlate {
  index: number | null; name: string | null; weight_grams: number | null; time_seconds: number | null;
  filaments: MakerWorldFilament[]; thumbnail: string | null; images: string[]; objects: MakerWorldObject[];
  units_per_plate: null; warnings: string[];
}
export interface MakerWorldVariant {
  profile_id: string | null; printer_model: string | null; printer_code: string | null; nozzle_diameter: number | null;
  weight_grams: number | null; time_seconds: number | null; plates: number | null; plate_details: MakerWorldPlate[];
  filaments: MakerWorldFilament[]; images: string[]; warnings: string[];
}
export interface MakerWorldProfile extends MakerWorldVariant {
  instance_id: string | null; name: string | null; description: string; is_default: boolean;
  need_ams: boolean | null; variants: MakerWorldVariant[];
}
export interface MakerWorldFile {
  name: string; type: string | null; size_bytes: number | null; url: string | null; thumbnail: string | null;
  download_available: boolean; temporary_url: boolean;
}
export interface MakerWorldAccessory { name: string; sku: string | null; quantity: number | null; url: string | null; }
export interface MakerWorldModel {
  schema_version: 1; provider: "makerworld"; id: string; design_id: string; model_id: string | null; source_url: string;
  title: string; description: string; /** Untrusted source markup. Never render without an HTML sanitizer. */ description_html: string;
  thumbnail: string | null; gallery: string[]; images: string[]; profiles: MakerWorldProfile[];
  default_instance_id: string | null; selected_instance_id: string | null; selected_variant_profile_id: string | null;
  author: { name: string | null; handle: string | null; url: string | null } | null;
  license: string | null; tags: string[]; categories: string[];
  files: MakerWorldFile[]; accessories: MakerWorldAccessory[]; documentation: { title: string; url: string }[];
  plates: number | null; warnings: string[]; metadata_complete: boolean;
}
export interface MakerWorldUrl { url: string; designId: string; instanceId: string | null; }

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const identifier = (value: unknown): string | null => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
const number = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:[.,]\d+)?$/.test(value.trim()))) return null;
  const n = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) { const n = number(value); if (n !== null) return n; }
  return null;
};
const distinct = (values: string[]) => [...new Set(values)];
function httpsUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value : object(value).url;
  if (typeof raw !== "string") return null;
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
function decoded(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, key: string) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] ?? match;
    const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}
export function makerWorldPlainText(value: unknown): string {
  const source = text(value) ?? "";
  return decoded(source.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")).replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decoded(match[1] ?? match[2] ?? match[3] ?? "") : null;
}
function htmlImages(html: string): string[] {
  return distinct([...html.matchAll(/<img\b[^>]*>/gi)].map(match => httpsUrl(attribute(match[0], "src"))).filter((url): url is string => !!url));
}
function imageList(...values: unknown[]): string[] {
  return distinct(values.flatMap(value => array(value).length ? array(value) : [value])
    .map(value => httpsUrl(value) ?? httpsUrl(object(value).image) ?? httpsUrl(object(value).thumbnail))
    .filter((url): url is string => !!url));
}
function duration(value: unknown): number | null {
  const n = number(value); if (n !== null) return n;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?)?\s*)?(?:(\d+(?:[.,]\d+)?)\s*m(?:in(?:utes?)?)?\s*)?(?:(\d+(?:[.,]\d+)?)\s*s(?:ec(?:onds?)?)?)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return null;
  return (number(match[1]) ?? 0) * 3600 + (number(match[2]) ?? 0) * 60 + (number(match[3]) ?? 0);
}
function grams(value: unknown, unit?: unknown): number | null {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|grams?|kilograms?)?$/i);
    if (!match) return null;
    const n = number(match[1]);
    const suffix = text(unit) ?? match[2] ?? "g";
    return n === null || !/^(kg|g|grams?|kilograms?)$/i.test(suffix) ? null : /^(kg|kilogram)/i.test(suffix) ? n * 1000 : n;
  }
  const n = number(value); const suffix = text(unit) ?? "g";
  return n === null || !/^(kg|g|grams?|kilograms?)$/i.test(suffix) ? null : /^(kg|kilogram)/i.test(suffix) ? n * 1000 : n;
}
function sumKnown(values: (number | null)[]): number | null {
  return values.length && values.every(value => value !== null) ? Number(values.reduce<number>((sum, value) => sum + (value ?? 0), 0).toFixed(9)) : null;
}
function parseFilament(value: unknown): MakerWorldFilament {
  const filament = object(value);
  const rawColor = text(filament.color) ?? text(filament.colour);
  return { id: text(filament.id) ?? identifier(filament.id), type: text(filament.type) ?? text(filament.materialType),
    color: rawColor && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(rawColor) ? rawColor.toUpperCase() : rawColor,
    grams: grams(filament.usedG ?? filament.used_g ?? filament.grams ?? filament.weight ?? filament.usedWeight, filament.unit),
    meters: firstNumber(filament.usedM, filament.used_m), };
}
function filaments(value: unknown): MakerWorldFilament[] {
  return array(value).map(parseFilament).filter(f => f.type !== null || f.color !== null || f.grams !== null || f.id !== null);
}
function aggregateFilaments(plates: MakerWorldPlate[]): MakerWorldFilament[] {
  const result = new Map<string, MakerWorldFilament>();
  for (const plate of plates) for (const filament of plate.filaments) {
    const key = JSON.stringify([filament.id, filament.type, filament.color]); const previous = result.get(key);
    result.set(key, previous ? { ...previous, grams: sumKnown([previous.grams, filament.grams]), meters: sumKnown([previous.meters, filament.meters]) } : { ...filament });
  }
  return [...result.values()];
}
function declaredWeight(value: JsonObject): number | null {
  for (const key of ["weight", "total_weight", "totalWeight", "weight_grams", "usedG", "used_g"]) {
    const n = grams(value[key], key === "weight_grams" || key.startsWith("used") ? "g" : value.weight_unit ?? value.unit);
    if (n !== null) return n;
  }
  return null;
}
function declaredTime(value: JsonObject): number | null {
  for (const key of ["prediction", "time_seconds", "estimatedTime", "estimated_time", "printTime"]) {
    const n = duration(value[key]); if (n !== null) return n;
  }
  return null;
}
function parsePlate(value: unknown): MakerWorldPlate {
  const plate = object(value); const material = filaments(plate.filaments);
  const rawIndex = firstNumber(plate.index, plate.plateIndex, plate.plate_index);
  const index = rawIndex !== null && Number.isSafeInteger(rawIndex) ? rawIndex : null;
  const declared = declaredWeight(plate); const calculated = sumKnown(material.map(f => f.grams));
  const warnings: string[] = [];
  if (declared !== null && calculated !== null && Math.abs(declared - calculated) > .5) warnings.push("O peso declarado da placa difere da soma dos filamentos; valores da fonte foram preservados.");
  if (index === null) warnings.push("Índice da placa não informado pela fonte.");
  return { index, name: text(plate.name), weight_grams: declared ?? calculated, time_seconds: declaredTime(plate),
    filaments: material, thumbnail: httpsUrl(plate.thumbnail), images: imageList(plate.thumbnail, plate.top_picture, plate.pick_picture),
    objects: array(plate.objects).map(value => { const item = object(value); return { id: text(item.id) ?? identifier(item.id), name: text(item.name) }; }),
    units_per_plate: null, warnings };
}
function modelInfo(value: JsonObject): JsonObject {
  const extension = object(value.extention ?? value.extension);
  return object(extension.modelInfo ?? value.modelInfo ?? value.context ?? value.picData);
}
function variant(value: JsonObject, info: JsonObject, inheritedProfileId?: string | null): MakerWorldVariant {
  const plates = array(info.plates ?? value.plates).map(parsePlate);
  const compatibility = object(info.compatibility);
  const rawFilaments = value.instanceFilaments ?? value.materialList ?? value.materials;
  // These scopes describe the same consumption. Never add profile totals to plate totals.
  const material = array(rawFilaments).length ? filaments(rawFilaments) : aggregateFilaments(plates);
  const plateWeight = sumKnown(plates.map(p => p.weight_grams)); const plateTime = sumKnown(plates.map(p => p.time_seconds));
  const warnings = plates.flatMap(p => p.warnings);
  const weight = declaredWeight(value); const time = declaredTime(value);
  if (weight !== null && plateWeight !== null && Math.abs(weight - plateWeight) > .5) warnings.push("O peso do perfil difere da soma das placas; nenhum valor foi substituído por um máximo ou média.");
  if (time !== null && plateTime !== null && Math.abs(time - plateTime) > 1) warnings.push("O tempo do perfil difere da soma das placas; mantenha a referência de cada placa ao planejar.");
  return { profile_id: identifier(value.profileId ?? value.profile_id) ?? inheritedProfileId ?? null,
    printer_model: text(compatibility.devProductName) ?? text(value.devProductName), printer_code: text(compatibility.devModelName) ?? text(value.devModelName),
    nozzle_diameter: firstNumber(compatibility.nozzleDiameter, value.nozzleDiameter),
    weight_grams: weight ?? plateWeight ?? sumKnown(material.map(f => f.grams)), time_seconds: time ?? plateTime,
    plates: plates.length || firstNumber(value.plateCount, value.plate_count, value.plates), plate_details: plates, filaments: material,
    images: imageList(value.cover, value.pictures, info.auxiliaryPictures, plates.flatMap(p => p.images)), warnings: distinct(warnings) };
}

export function parseMakerWorldUrl(value: string): MakerWorldUrl {
  let url: URL; try { url = new URL(value.trim()); } catch { throw new Error("Informe o link completo do modelo no MakerWorld."); }
  if (url.protocol !== "https:" || !["makerworld.com", "www.makerworld.com"].includes(url.hostname) || url.username || url.password || url.port) throw new Error("Use um link HTTPS do MakerWorld, sem credenciais no endereço.");
  const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/([1-9]\d{0,18})(?:[-/][^?#]*)?$/i);
  if (!match) throw new Error(/makerlab/i.test(url.pathname) ? "Este link abre uma ferramenta MakerLab. Use o link do modelo publicado ou importe o arquivo exportado da ferramenta." : "Use o link de um modelo específico do MakerWorld, com /models/ID.");
  const hash = url.hash.match(/^#profileId-([1-9]\d{0,18})$/i)?.[1];
  const query = url.searchParams.get("profileId");
  if (query && !identifier(query)) throw new Error("O perfil informado no link é inválido.");
  if (hash && query && hash !== query) throw new Error("O link informa dois perfis diferentes. Abra o perfil desejado no MakerWorld e copie o endereço novamente.");
  const instanceId = hash ?? identifier(query);
  return { url: `https://makerworld.com/en/models/${match[1]}${instanceId ? `#profileId-${instanceId}` : ""}`, designId: match[1], instanceId };
}

export function normalizeMakerWorldDesign(raw: unknown, sourceUrl?: string): MakerWorldModel {
  const envelope = object(raw); const data = object(envelope.data); const design = object(envelope.design ?? data.design ?? (data.id ? data : raw));
  const requested = sourceUrl ? parseMakerWorldUrl(sourceUrl) : null;
  const designId = identifier(design.id ?? design.designId ?? design.design_id);
  if (!designId || !text(design.title ?? design.name)) throw new Error("A fonte não retornou um modelo MakerWorld identificável. Nenhum cadastro foi criado.");
  if (requested && requested.designId !== designId) throw new Error("O modelo retornado não corresponde ao ID solicitado.");
  const extension = object(design.designExtension); const descriptionHtml = text(design.summary ?? design.description) ?? "";
  const sourceProfiles = array(design.instances ?? design.profileList ?? design.profiles);
  const defaultInstanceId = identifier(design.defaultInstanceId);
  const profiles: MakerWorldProfile[] = sourceProfiles.map(value => {
    const p = object(value); const ext = object(p.extention ?? p.extension); const info = modelInfo(p);
    const instanceId = identifier(p.id ?? p.instanceId ?? p.instance_id);
    return { ...variant(p, info), instance_id: instanceId, name: text(p.title ?? p.name ?? p.profileName),
      description: makerWorldPlainText(p.summary ?? p.description), is_default: p.isDefault === true || !!defaultInstanceId && defaultInstanceId === instanceId,
      need_ams: typeof p.needAms === "boolean" ? p.needAms : null,
      variants: array(ext.otherCompatibilityModelInfo ?? p.otherCompatibilityModelInfo).map(value => { const v = object(value); return variant(v, modelInfo(v)); }) };
  });
  const selected = requested?.instanceId ? profiles.find(p => p.instance_id === requested.instanceId) : null;
  const warnings: string[] = [];
  if (requested?.instanceId && !selected) warnings.push(`O perfil público ${requested.instanceId} não está disponível neste modelo. Selecione uma opção retornada pela fonte.`);
  if (!profiles.length) warnings.push("A fonte não forneceu perfis de impressão. Fotos e descrição foram preservadas; peso, tempo e placas permanecem pendentes.");
  if (profiles.some(p => !p.plate_details.length || p.weight_grams === null || p.time_seconds === null)) warnings.push("Há perfis sem detalhes completos de placas, peso ou tempo; dados ausentes não foram estimados.");
  const gallery = imageList(design.coverUrl ?? design.cover_url ?? design.cover, design.images, design.gallery,
    extension.design_pictures, htmlImages(descriptionHtml), sourceProfiles.flatMap(value => {
      const p = object(value); return imageList(p.cover, p.pictures, modelInfo(p).auxiliaryPictures, htmlImages(text(p.summary ?? p.description) ?? ""));
    }));
  // Product photography stays separate from the technical plate previews. All
  // images remain available on the import record and individual print variants.
  const images = imageList(gallery, profiles.flatMap(p => [...p.images, ...p.variants.flatMap(v => v.images)]));
  if (!gallery.length) warnings.push("A fonte não disponibilizou imagens do modelo.");
  if (!descriptionHtml) warnings.push("A fonte não disponibilizou uma descrição do modelo.");
  const creator = object(design.designCreator ?? design.creator); const handle = text(creator.handle);
  const files: MakerWorldFile[] = [];
  function appendFiles(values: unknown, depth = 0) {
    if (depth > 8) { warnings.push("A estrutura de arquivos excedeu a profundidade suportada; confira os anexos no MakerWorld."); return; }
    for (const value of array(values)) {
      const f = object(value); if (f.isDir === true) { appendFiles(f.children, depth + 1); continue; }
      const name = text(f.modelName ?? f.name); if (!name) continue;
      const url = httpsUrl(f.modelUrl ?? f.url); files.push({ name, type: text(f.modelType ?? f.type), size_bytes: firstNumber(f.modelSize, f.size), url,
        thumbnail: httpsUrl(f.thumbnailUrl ?? f.thumbnail), download_available: !!url && f.protected !== true,
        temporary_url: !!url && /[?&](?:exp|expires|x-amz-signature|signature|token|key)=/i.test(url) });
    }
  }
  appendFiles(extension.model_files ?? design.model_files);
  const accessories = array(extension.boms ?? extension.design_bom).map(value => {
    const item = object(value); return { name: text(item.displayTitle ?? item.title ?? item.name) ?? "Acessório sem nome", sku: text(item.sku), quantity: firstNumber(item.quantity), url: httpsUrl(item.url) };
  });
  const documentation = distinct([...descriptionHtml.matchAll(/<a\b[^>]*>/gi)].map(match => httpsUrl(attribute(match[0], "href"))).filter((url): url is string => !!url))
    .map(url => ({ title: "Link na descrição do autor", url }));
  for (const entry of array(extension.design_guide).concat(array(extension.design_other))) {
    const item = object(entry); const url = httpsUrl(item.url); if (url && !documentation.some(doc => doc.url === url)) documentation.push({ title: text(item.name ?? item.title) ?? "Documento do autor", url });
  }
  const labels = (value: unknown) => distinct(array(value).map(item => text(item) ?? text(object(item).name) ?? text(object(item).title)).filter((s): s is string => !!s));
  const complete = !!descriptionHtml && gallery.length > 0 && profiles.length > 0 && profiles.every(p => p.instance_id && p.profile_id && p.plate_details.length > 0 && p.plate_details.every(plate => plate.index !== null && plate.weight_grams !== null && plate.time_seconds !== null));
  return { schema_version: 1, provider: "makerworld", id: designId, design_id: designId, model_id: text(design.modelId ?? design.model_id),
    source_url: requested?.url ?? `https://makerworld.com/en/models/${designId}`, title: makerWorldPlainText(design.title ?? design.name),
    description: makerWorldPlainText(descriptionHtml), description_html: descriptionHtml,
    thumbnail: httpsUrl(design.coverUrl ?? design.cover_url ?? design.cover) ?? gallery[0] ?? null, gallery, images, profiles,
    default_instance_id: defaultInstanceId ?? profiles.find(p => p.is_default)?.instance_id ?? null,
    selected_instance_id: selected?.instance_id ?? null, selected_variant_profile_id: null,
    author: Object.keys(creator).length ? { name: text(creator.name), handle, url: handle ? `https://makerworld.com/en/@${encodeURIComponent(handle)}` : null } : null,
    license: text(design.license) ?? text(object(design.license).name), tags: labels(design.tags), categories: labels(design.categories),
    files, accessories, documentation, plates: selected?.plates ?? null,
    warnings: distinct([...warnings, ...profiles.flatMap(p => [...p.warnings, ...p.variants.flatMap(v => v.warnings)])]), metadata_complete: complete };
}

/** Structured HTML fallback only. Storefront weights, regex maxima and model-generated estimates are never read. */
export function normalizeMakerWorldHtml(html: string, sourceUrl: string): MakerWorldModel {
  const source = parseMakerWorldUrl(sourceUrl);
  if (/\bcf-chl-|<title>\s*(?:Just a moment|Access denied)|id=["']cf-error-details/i.test(html)) throw new Error("O MakerWorld bloqueou a consulta da página. Nenhum dado de impressão foi inferido.");
  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const tag = match[0].slice(0, match[0].indexOf(">") + 1);
    if (attribute(tag, "id") !== "__NEXT_DATA__") continue;
    let json: unknown;
    try { json = JSON.parse(match[0].slice(tag.length).replace(/<\/script\s*>$/i, "")); }
    catch { continue; }
    const props = object(object(json).props); const page = object(props.pageProps);
    if (page.design) return normalizeMakerWorldDesign(page.design, source.url);
  }
  const metadata: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attribute(match[0], "property") ?? attribute(match[0], "name"); const value = attribute(match[0], "content");
    if (key && value) metadata[key.toLowerCase()] = value;
  }
  if (!metadata["og:title"]) throw new Error("A página não disponibilizou metadados do modelo. Tente novamente mais tarde ou importe o arquivo exportado.");
  const result = normalizeMakerWorldDesign({ id: source.designId, title: metadata["og:title"], coverUrl: metadata["og:image"], summary: metadata["og:description"] }, source.url);
  result.warnings.unshift("Importação parcial: somente metadados públicos da página estavam disponíveis. Nenhum perfil ou consumo foi inferido.");
  return result;
}
