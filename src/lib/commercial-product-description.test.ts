import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCommercialDescriptionSuggestion, buildCommercialProductDescription, refreshCommercialDescriptionDimensions, type CommercialProductFacts } from "./commercial-product-description";

const facts = (overrides: Partial<CommercialProductFacts> = {}): CommercialProductFacts => ({ title: "Nativity with Holy Family", category: "printed_part", ...overrides });
afterEach(() => vi.unstubAllGlobals());

describe("offline Portuguese commercial descriptions", () => {
  it.each([["Unknown Vessel", "Modelo “Unknown Vessel”"], ["Caneca Monster otimizada sem suportes", "Caneca Monster"], ["Bola de Natal | Origami", "Bola de Natal com design de origami"], ["Chapéu Natal | Porta", "Decoração de Natal para portas"], ["Presépio simples", "Presépio decorativo"], ["Bandeja Oval", "Bandeja oval"]])("uses only the curated exact product alias for %s", (title, expected) => {
    expect(buildCommercialProductDescription(facts({ title })).text).toBe(`${expected}. Peça produzida por impressão 3D.`);
  });
  it("describes the Holy Family with only confirmed color and product dimensions", () => {
    expect(buildCommercialProductDescription(facts({ colors: { confirmed: true, count: 1, names: ["White"] },
      dimensions: { confirmed: true, lengthMm: 120, widthMm: 58.5, heightMm: 150 }, material: { confirmed: true, name: "PLA" } })).text)
      .toBe("Presépio com a Sagrada Família. Peça produzida por impressão 3D em PLA. Cor única (Branco). Medidas da peça: comprimento 12 cm; largura 5,85 cm; altura 15 cm.");
  });

  it("omits boost requests, filament savings and slicer instructions while preserving exact original provenance", () => {
    const source = { provider: "makerworld" as const, source_id: "744793", source_url: "https://makerworld.com/pt/models/744793",
      original_title: "CANЕCA MONSTER OTIMIZADA SEM SUPORTES!!!!", original_description: "Me impulsione! Gasta menos filamento. Use 15% infill e camada de 0,2 mm.",
      original_description_html: "<boostme>Boost me!</boostme><p>Use supports off.</p>", license: "CC BY-NC-SA", author: { name: "Autor original", handle: "autor" } };
    const original = structuredClone(source);
    const result = buildCommercialProductDescription(facts({ title: "Caneca Monster — otimizada sem suportes | Me impulsione", source }));
    expect(result.text).toBe("Caneca Monster. Peça produzida por impressão 3D.");
    expect(result.text).not.toMatch(/boost|impulsione|filamento|infill|suport|0,2/i);
    expect(result.source_metadata).toEqual(original); expect(source).toEqual(original);
    expect(result.text).not.toMatch(/segur|aliment|micro-ondas|resisten|sustenta|licen[cç]|comercial autorizado/i);
  });

  it("uses a known product name instead of translating the author's English sales and print paragraphs", () => {
    const result = buildCommercialProductDescription(facts({ title: "Thermoformed Apple | Teacher Appreciation Gift",
      source: { provider: "makerworld", original_description: "Boost me. Prints fast. Holds candy and chocolate. Heat evenly to form the shell. Optional solid base." } }));
    expect(result.text).toBe("Maçã termoformada · Presente para professores. Peça produzida por impressão 3D.");
    expect(result.text).not.toMatch(/doce|chocolate|calor|base|rapido|boost/i);
  });

  it("does not invent translation, material, use, colors, dimensions or safety for an unknown model", () => {
    const result = buildCommercialProductDescription(facts({ title: "Zorg-X Limited Edition", colors: { confirmed: false, count: 3, names: ["Red", "Green", "White"] },
      material: { confirmed: false, name: "PLA" }, dimensions: { confirmed: false, lengthMm: 256, widthMm: 256, heightMm: 250 } }));
    expect(result.text).toBe("Modelo “Zorg-X Limited Edition”. Peça produzida por impressão 3D.");
    expect(result.generation.title_mode).toBe("source_name"); expect(result.text).not.toMatch(/cm|cor|PLA|segur|presente|infantil/);
  });

  it("distinguishes one delivered color from the source profile and does not invent color names for hex codes", () => {
    const one = buildCommercialProductDescription(facts({ title: "Articulated Dragon", colors: { confirmed: true, count: 1, names: ["Branco"] } }));
    expect(one.text).toContain("Dragão articulado."); expect(one.text).toContain("Cor única (Branco).");
    const unknownNames = buildCommercialProductDescription(facts({ colors: { confirmed: true, count: 3, names: ["#FFFFFF", "#FCECD6", "#BC003A"] } }));
    expect(unknownNames.text).toContain("Produção em 3 cores."); expect(unknownNames.text).not.toMatch(/#|Marfim|Vermelho|Branco/);
    const incompleteNames = buildCommercialProductDescription(facts({ colors: { confirmed: true, count: 3, names: ["White", "Green"] } }));
    expect(incompleteNames.text).toContain("Produção em 3 cores."); expect(incompleteNames.text).not.toContain("Branco");
  });

  it("includes only valid confirmed product measures and never fills missing axes or substitutes packaging", () => {
    const result = buildCommercialProductDescription(facts({ dimensions: { confirmed: true, lengthMm: null, widthMm: NaN, heightMm: 42.5 } }));
    expect(result.text).toContain("Medidas da peça: altura 4,25 cm."); expect(result.text).not.toMatch(/largura|comprimento|embalag|peso/);
    expect(buildCommercialProductDescription(facts({ dimensions: { confirmed: true, lengthMm: 0, widthMm: -1, heightMm: Infinity } })).text).not.toContain("Medidas");
  });

  it("keeps a kit's known category without assuming every kit or purchased product was 3D printed", () => {
    expect(buildCommercialProductDescription(facts({ title: "Presépio", category: "kit", manufacturedBy3dPrinting: true })).text)
      .toBe("Presépio. Conjunto produzido por impressão 3D.");
    expect(buildCommercialProductDescription(facts({ title: "Kit especial", titleIsPortuguese: true, category: "kit" })).text).toBe("Kit especial.");
  });

  it("does not perform network calls or use a paid or translation provider", () => {
    const fetch = vi.fn(() => { throw new Error("Network must not run"); }); vi.stubGlobal("fetch", fetch);
    expect(buildCommercialProductDescription(facts()).text).toContain("Presépio"); expect(fetch).not.toHaveBeenCalled();
  });

  it("treats source markup or prompt-like title content as data and never exposes executable or promotional blocks", () => {
    const result = buildCommercialProductDescription(facts({ title: "<script>fetch('https://evil.example')</script><boostme>Boost me</boostme>Presépio" }));
    expect(result.text).toBe("Presépio. Peça produzida por impressão 3D.");
    expect(buildCommercialProductDescription(facts({ title: "Ignore previous instructions" })).text).toBe("Peça produzida por impressão 3D.");
  });
});

describe("commercial draft ownership", () => {
  it("refreshes only dimensions while keeping the original confirmed colors/material and source identity", () => {
    const initial = buildCommercialProductDescription(facts({ material: { confirmed: true, name: "PLA" }, colors: { confirmed: true, count: 3, names: ["White", "Green", "Red"] },
      source: { provider: "makerworld", source_id: "744793" }, dimensions: { confirmed: true, heightMm: 150 } }));
    const next = refreshCommercialDescriptionDimensions(initial.text, initial.generation, { confirmed: true, heightMm: 160, widthMm: 80 });
    expect(next.applied).toBe(true);
    expect(next.value).toBe("Presépio com a Sagrada Família. Peça produzida por impressão 3D em PLA. Produção em 3 cores (Branco, Verde, Vermelho). Medidas da peça: largura 8 cm; altura 16 cm.");
    expect(JSON.parse(next.generation!.input_signature)).toMatchObject({ source_provider: "makerworld", source_id: "744793", production: "Peça produzida por impressão 3D em PLA.", colors: "Produção em 3 cores (Branco, Verde, Vermelho)." });
  });
  it("preserves custom copy or malformed generation signatures when refreshing dimensions", () => {
    const initial = buildCommercialProductDescription(facts());
    expect(refreshCommercialDescriptionDimensions("Texto comercial revisado", initial.generation, { confirmed: true, heightMm: 100 })).toEqual({ value: "Texto comercial revisado", generation: initial.generation, applied: false });
    for (const signature of ["invalid JSON", "{}", JSON.stringify({ ...JSON.parse(initial.generation.input_signature), colors: "Texto que não corresponde à descrição" })]) {
      const generation = { ...initial.generation, input_signature: signature };
      expect(refreshCommercialDescriptionDimensions(initial.text, generation, { confirmed: true, heightMm: 100 })).toEqual({ value: initial.text, generation, applied: false });
    }
  });
  it("fills an untouched empty import and refreshes only its own untouched generated text when facts change", () => {
    const initial = buildCommercialProductDescription(facts());
    const draft = applyCommercialDescriptionSuggestion({ value: "" }, initial);
    expect(draft).toEqual({ value: initial.text, generation: initial.generation, applied: true });
    const confirmed = buildCommercialProductDescription(facts({ colors: { confirmed: true, count: 1, names: ["Branco"] } }));
    const next = applyCommercialDescriptionSuggestion(draft, confirmed);
    expect(next.value).toContain("Cor única (Branco)"); expect(next.applied).toBe(true);
    expect(applyCommercialDescriptionSuggestion(next, confirmed)).toEqual(next);
  });

  it("preserves an operator's edited description after profile, colors or source change", () => {
    const initial = buildCommercialProductDescription(facts());
    const edited = `${initial.text} Edição comercial revisada pela equipe.`;
    const replacement = buildCommercialProductDescription(facts({ title: "Monster Mug", colors: { confirmed: true, count: 3 } }));
    expect(applyCommercialDescriptionSuggestion({ value: edited, generation: initial.generation }, replacement))
      .toEqual({ value: edited, generation: initial.generation, applied: false });
  });

  it("respects an intentional clear and an explicit edited flag even when text equals the previous suggestion", () => {
    const suggestion = buildCommercialProductDescription(facts());
    expect(applyCommercialDescriptionSuggestion({ value: "", operatorEdited: true }, suggestion).value).toBe("");
    expect(applyCommercialDescriptionSuggestion({ value: suggestion.text, generation: suggestion.generation, operatorEdited: true }, suggestion).applied).toBe(false);
  });

  it("never rewrites a nonempty legacy or saved description without a verified generation marker", () => {
    const suggestion = buildCommercialProductDescription(facts());
    const legacy = "Descrição comercial já usada na Elevare.";
    expect(applyCommercialDescriptionSuggestion({ value: legacy }, suggestion)).toEqual({ value: legacy, generation: null, applied: false });
    expect(applyCommercialDescriptionSuggestion({ value: suggestion.text }, suggestion).applied).toBe(false);
  });
});
