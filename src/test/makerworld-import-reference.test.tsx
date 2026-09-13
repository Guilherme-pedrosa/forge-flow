import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { externalImportReference, readProductExternalImport } from "@/lib/makerworld-import";
import MakerWorldReference from "@/pages/comercial/MakerWorldReference";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
afterEach(cleanup);
const minimal = () => ({ schema_version: 1, provider: "makerworld", id: "456", design_id: "456",
  source_url: "https://makerworld.com/en/models/456", title: "Produto importado" });
const model = () => normalizeMakerWorldDesign({ id: 456, title: "Produto importado", coverUrl: "https://cdn.example.test/cover.jpg",
  instances: [{ id: 101, profileId: 501, title: "Original", weight: 10, prediction: 600, extention: {
    modelInfo: { plates: [{ index: 1, weight: 10, prediction: 600, filaments: [{ id: "1", type: "PLA", color: "#FFFFFF", usedG: 10 }] }] },
    otherCompatibilityModelInfo: [{ profileId: 601, weight: 12, prediction: 800, modelInfo: { compatibility: { devProductName: "A1" } } }],
  } }, { id: 102, profileId: 502, title: "Outro perfil", weight: 20, prediction: 1200 }] });

describe("persisted MakerWorld references", () => {
  it("preserves normalized profiles, variants, descriptions, photos and metadata without reparsing the raw API shape", () => {
    const reference = { ...externalImportReference(model(), minimal().source_url, 0), selected_variant_profile_id: "601", extra_metadata: { retained: true } };
    expect(readProductExternalImport(reference)).toEqual(reference);
  });
  it("recovers missing collections so an incomplete saved reference remains readable", () => {
    const reference = readProductExternalImport(minimal());
    expect(reference).toMatchObject({ profiles: [], files: [], documentation: [], tags: [], warnings: [], images: [], gallery: [] });
    render(<MakerWorldReference value={reference!} />);
    expect(screen.getByRole("link", { name: /Abrir original/ })).toHaveAttribute("href", minimal().source_url);
    expect(screen.getByText(/Nenhum perfil de impressão público/)).toBeInTheDocument();
  });
  it("does not let malformed nested arrays or number strings crash the renderer or turn into invented zero costs", () => {
    const reference = readProductExternalImport({ ...minimal(), profiles: [false, null, {
      instance_id: "101", profile_id: "501", weight_grams: "13g", time_seconds: "4601", filaments: [{ grams: "12", type: {}, color: [] }],
      plate_details: [{ weight_grams: Infinity, time_seconds: -1, warnings: {}, filaments: false, objects: 4 }],
      variants: [{ profile_id: "601", weight_grams: 0, time_seconds: 0, warnings: [null, { bad: true }] }],
    }], files: false, tags: ["Etiqueta", {}], warnings: [{ bad: true }], gallery: ["https://cdn.example.test/keep.jpg", {}] });
    expect(reference?.profiles).toHaveLength(1);
    expect(reference?.profiles[0]).toMatchObject({ weight_grams: null, time_seconds: null });
    expect(reference?.profiles[0].plate_details[0]).toMatchObject({ weight_grams: null, time_seconds: null, filaments: [], objects: [] });
    expect(reference?.profiles[0].variants[0]).toMatchObject({ weight_grams: 0, time_seconds: 0 });
    expect(reference?.tags).toEqual(["Etiqueta"]);
    render(<MakerWorldReference value={reference!} />);
    expect(screen.getByText("Etiqueta")).toBeInTheDocument();
  });
  it("removes executable, credential-bearing and non-HTTPS URLs from every rendered media/link field", () => {
    const unsafe = ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "http://cdn.example.test/a.jpg", "https://user:secret@cdn.example.test/a.jpg"];
    const reference = readProductExternalImport({ ...minimal(), thumbnail: unsafe[0], images: [...unsafe, "https://cdn.example.test/ok.jpg"], gallery: unsafe,
      profiles: [{ thumbnail: unsafe[0], plate_details: [{ thumbnail: unsafe[0], images: unsafe }] }],
      files: unsafe.map(url => ({ name: "Arquivo", url, thumbnail: url, download_available: true })),
      documentation: unsafe.map(url => ({ title: "Manual", url })), author: { name: "Autor", url: unsafe[0] },
      accessories: [{ name: "Acessório", url: unsafe[0] }],
    });
    expect(reference?.images).toEqual(["https://cdn.example.test/ok.jpg"]);
    expect(reference?.gallery).toEqual([]); expect(reference?.thumbnail).toBeNull();
    expect(reference?.files.every(file => !file.download_available && file.url === null && file.thumbnail === null)).toBe(true);
    expect(reference?.documentation).toEqual([]); expect(reference?.profiles[0].plate_details[0].thumbnail).toBeNull();
    expect(reference?.author?.url).toBeNull(); expect(reference?.accessories[0].url).toBeNull();
    render(<MakerWorldReference value={reference!} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("rejects an invalid identity, provider, schema or source URL instead of rendering an unrelated reference", () => {
    for (const value of [null, [], { ...minimal(), schema_version: 2 }, { ...minimal(), provider: "other" }, { ...minimal(), id: "999" },
      ...["javascript:alert(1)", "https://makerworld.com:444/models/456", "https://makerworld.com.evil.test/models/456", "https://makerworld.com/models/999"].map(source_url => ({ ...minimal(), source_url }))]) {
      expect(readProductExternalImport(value)).toBeNull();
    }
  });
  it("clears a selected profile or printer variant that does not belong to this reference", () => {
    const reference = externalImportReference(model(), minimal().source_url, 0);
    expect(readProductExternalImport({ ...reference, selected_variant_profile_id: "502" })?.selected_variant_profile_id).toBeNull();
    expect(readProductExternalImport({ ...reference, selected_profile_id: "999", selected_variant_profile_id: "601" })).toMatchObject({ selected_profile_id: null, selected_instance_id: null, selected_variant_profile_id: null });
  });
  it("updates the original link to the selected public instance, never to the Bambu technical profile", () => {
    const reference = externalImportReference(model(), "https://makerworld.com/en/models/456#profileId-101", 1);
    expect(reference.source_url).toBe("https://makerworld.com/en/models/456#profileId-102");
    expect(reference.selected_profile_id).toBe("102");
    expect(() => externalImportReference(model(), "https://makerworld.com/en/models/999", 0)).toThrow(/não corresponde/);
  });
});
