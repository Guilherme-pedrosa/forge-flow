/** Offline commercial copy. Source prose is preserved as provenance, never treated as an instruction or a product fact. */
export type CommercialDescriptionSource = {
  provider: "makerworld" | "3mf" | "bambu";
  source_id?: string | null;
  source_url?: string | null;
  original_title?: string | null;
  original_description?: string | null;
  original_description_html?: string | null;
  author?: { name?: string | null; handle?: string | null; url?: string | null } | null;
  license?: string | null;
  file_sha256?: string | null;
};

export type CommercialProductFacts = {
  title: string;
  /** Set only when the operator entered/reviewed a Portuguese product name. */
  titleIsPortuguese?: boolean;
  category?: string | null;
  manufacturedBy3dPrinting?: boolean;
  /** Delivered product choices, not the colors/material suggested in a source print profile. */
  colors?: { confirmed: boolean; count: number | null; names?: readonly string[] } | null;
  material?: { confirmed: boolean; name: string } | null;
  /** Finished product measurements, never the package or the aggregate build-plate bounding box. */
  dimensions?: { confirmed: boolean; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null } | null;
  source?: CommercialDescriptionSource | null;
};

export type CommercialDescriptionGeneration = {
  schema_version: 1;
  generator: "facts-pt-BR-v1";
  generated_text: string;
  input_signature: string;
  title_mode: "portuguese" | "known_translation" | "source_name" | "generic";
};
export type CommercialDescriptionSuggestion = {
  text: string;
  generation: CommercialDescriptionGeneration;
  source_metadata: CommercialDescriptionSource | null;
};

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const technical = /\b(?:boost(?:\s+me)?|me\s+impulsione|impulsione|like\s+and\s+subscribe|siga[- ]me|follow\s+me|donat(?:e|ion)|patreon|print\s+settings|slicer|fatiador|infill|layer\s+height|altura\s+de\s+camada|g[- ]?code|ams|no\s+supports?|supportless|sem\s+suportes?|less\s+filament|save\s+filament|economi[az][\w\s]*filamento|gasta\s+menos\s+filamento|otimizad[oa]|optimi[sz]ed|easy\s+print|impressao\s+facil)\b/i;
const promotionalOrInstruction = /\b(?:boost|impulsione|subscribe|patreon|donate|ignore\s+(?:all|previous)|system\s+prompt|instructions?|instrucoes|gratis|free\s+download|stl\s+file)\b/i;

function plainTitle(text: string): string {
  return text.replace(/<(script|style|boostme)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, entity => ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "", "&gt;": "" })[entity.toLowerCase()] || " ")
    .replace(/https?:\/\/\S+/gi, " ").replace(/\p{Cc}/gu, " ").replace(/[_]+/g, " ")
    .replace(/\.(?:3mf|stl|obj)$/i, "").replace(/[!]+/g, "").replace(/\s+/g, " ").trim();
}

function customerTitle(value: string): string {
  const title = plainTitle(value);
  const pieces = title.split(/\s*[|·]\s*|\s+[—–-]\s+/);
  const retained: string[] = [];
  for (const piece of pieces) {
    const normalized = normalize(piece), match = technical.exec(normalized);
    const clean = (match ? piece.slice(0, match.index) : piece).replace(/[\s,;:([\]-]+$/g, "").trim();
    if (clean && !promotionalOrInstruction.test(normalize(clean))) retained.push(clean);
  }
  return retained.join(" · ").slice(0, 200).trim();
}

// Closed, auditable names: unknown English names remain model names, never a guessed translation or claimed use.
const names: Record<string, string> = {
  "caneca monster": "Caneca Monster", "bola de natal · origami": "Bola de Natal com design de origami",
  "chapeu natal · porta": "Decoração de Natal para portas", "presepio simples": "Presépio decorativo", "bandeja oval": "Bandeja oval",
  "nativity": "Presépio", "nativity scene": "Presépio", "christmas nativity": "Presépio de Natal",
  "holy family": "Sagrada Família", "holy family nativity": "Presépio com a Sagrada Família",
  "holy family nativity scene": "Presépio com a Sagrada Família", "nativity with holy family": "Presépio com a Sagrada Família",
  "nativity scene with holy family": "Presépio com a Sagrada Família", "monster mug": "Caneca Monster",
  "articulated dragon": "Dragão articulado", "dragon": "Dragão", "thermoformed apple": "Maçã termoformada",
  "teacher appreciation gift": "Presente para professores", "apple": "Maçã", "vase": "Vaso",
  "skull vase": "Vaso de caveira", "phone stand": "Suporte para celular", "bookend": "Aparador de livros",
};
const portugueseNames = /\b(?:presepio|familia|caneca|vaso|suporte|porta|chaveiro|mac[aã]|dragao|caixa|organizador|luminaria|bandeja|bola|chapeu|natal|familia\s+sagrada|sagrada\s+familia)\b/i;
function productSubject(facts: CommercialProductFacts): { subject: string; mode: CommercialDescriptionGeneration["title_mode"] } {
  const title = customerTitle(facts.title);
  if (!title) return { subject: "", mode: "generic" };
  if (names[normalize(title)]) return { subject: names[normalize(title)], mode: "known_translation" };
  if (facts.titleIsPortuguese || portugueseNames.test(normalize(title))) {
    // Keep the operator's spelling/capitalization; product facts must not become a title-rewriting heuristic.
    return { subject: title, mode: "portuguese" };
  }
  const parts = title.split(" · "), translated = parts.map(part => names[normalize(part)]);
  if (translated.every(Boolean)) return { subject: translated.join(" · "), mode: "known_translation" };
  return { subject: `Modelo “${title.replace(/[“”]/g, '"')}”`, mode: "source_name" };
}

const colorNames: Record<string, string> = { white: "Branco", black: "Preto", red: "Vermelho", green: "Verde", blue: "Azul", yellow: "Amarelo", orange: "Laranja", pink: "Rosa", purple: "Roxo", gray: "Cinza", grey: "Cinza", brown: "Marrom", beige: "Bege", transparent: "Transparente" };
function colorSentence(colors: CommercialProductFacts["colors"]): string {
  if (!colors?.confirmed || !Number.isInteger(colors.count) || colors.count! < 1 || colors.count! > 16) return "";
  const names = [...new Map((colors.names || []).map(name => customerTitle(name)).filter(name => name && !/^#?[\da-f]{6}(?:[\da-f]{2})?$/i.test(name))
    .map(name => [normalize(name), colorNames[normalize(name)] || name])).values()];
  const knownNames = names.length === colors.count ? ` (${names.join(", ")})` : "";
  return colors.count === 1 ? `Cor única${knownNames}.` : `Produção em ${colors.count} cores${knownNames}.`;
}
function dimensionsSentence(dimensions: CommercialProductFacts["dimensions"]): string {
  if (!dimensions?.confirmed) return "";
  const format = (value: number) => (value / 10).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const known = ([["lengthMm", "comprimento"], ["widthMm", "largura"], ["heightMm", "altura"]] as const)
    .flatMap(([field, label]) => {
      const value = dimensions[field];
      return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000 ? [`${label} ${format(value)} cm`] : [];
    });
  return known.length ? `Medidas da peça: ${known.join("; ")}.` : "";
}

export function buildCommercialProductDescription(facts: CommercialProductFacts): CommercialDescriptionSuggestion {
  const { subject, mode } = productSubject(facts);
  const material = facts.material?.confirmed ? customerTitle(facts.material.name) : "";
  const printed = facts.manufacturedBy3dPrinting === true || facts.category === "printed_part";
  const object = facts.category === "kit" ? "Conjunto" : "Peça";
  const production = printed ? `${object} ${object === "Conjunto" ? "produzido" : "produzida"} por impressão 3D${material ? ` em ${material}` : ""}.` : material ? `Material: ${material}.` : "";
  const colors = colorSentence(facts.colors), dimensions = dimensionsSentence(facts.dimensions);
  const text = descriptionText({ subject, production, colors, dimensions });
  const generation: CommercialDescriptionGeneration = { schema_version: 1, generator: "facts-pt-BR-v1", generated_text: text,
    input_signature: JSON.stringify({ subject, production, colors, dimensions, source_provider: facts.source?.provider ?? null, source_id: facts.source?.source_id ?? facts.source?.file_sha256 ?? null }), title_mode: mode };
  return { text, generation, source_metadata: facts.source ? { ...facts.source, ...(facts.source.author ? { author: { ...facts.source.author } } : {}) } : null };
}

function descriptionText(parts: { subject: string; production: string; colors: string; dimensions: string }): string {
  return [parts.subject ? `${parts.subject.replace(/[.]+$/, "")}.` : "", parts.production, parts.colors, parts.dimensions].filter(Boolean).join(" ") || "Produto Elevare3D.";
}

/** Change measurements without discarding previously confirmed material/color facts. A manual edit or unknown signature always wins. */
export function refreshCommercialDescriptionDimensions(value: string, generation: CommercialDescriptionGeneration | null, dimensions: CommercialProductFacts["dimensions"]): { value: string; generation: CommercialDescriptionGeneration | null; applied: boolean } {
  const unchanged = { value, generation, applied: false };
  if (!generation || generation.schema_version !== 1 || generation.generator !== "facts-pt-BR-v1" || value !== generation.generated_text) return unchanged;
  try {
    const parsed = JSON.parse(generation.input_signature);
    const keys = ["subject", "production", "colors", "dimensions", "source_provider", "source_id"];
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(parsed, key))
      || !["subject", "production", "colors", "dimensions"].every(key => typeof parsed[key] === "string")
      || ![null, "makerworld", "3mf", "bambu"].includes(parsed.source_provider) || parsed.source_id !== null && typeof parsed.source_id !== "string"
      || descriptionText(parsed) !== generation.generated_text) return unchanged;
    const next = { ...parsed, dimensions: dimensionsSentence(dimensions) };
    const text = descriptionText(next);
    return { value: text, generation: { ...generation, generated_text: text, input_signature: JSON.stringify(next) }, applied: true };
  } catch { return unchanged; }
}

/** Automatic refresh is allowed only for an untouched generated draft or an untouched empty field. */
export function applyCommercialDescriptionSuggestion(draft: {
  value: string;
  operatorEdited?: boolean;
  generation?: CommercialDescriptionGeneration | null;
}, suggestion: CommercialDescriptionSuggestion) {
  const generated = draft.generation?.schema_version === 1 && draft.generation.generator === "facts-pt-BR-v1" && draft.value === draft.generation.generated_text;
  if (draft.operatorEdited || draft.value.trim() && !generated) return { value: draft.value, generation: draft.generation ?? null, applied: false };
  return { value: suggestion.text, generation: suggestion.generation, applied: true };
}
