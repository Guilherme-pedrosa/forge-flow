import { describe, expect, it } from "vitest";
import { materialColorSwatch, normalizeMaterialIdentity } from "./material-identity";

const empty = { materialCode: "", description: "", color: "", colorCode: "", colorHex: "" };
describe("identidade explícita de material e cor", () => {
  it("não deduz material do nome da cor nem preenche identificação legada", () => {
    expect(normalizeMaterialIdentity({ ...empty, color: "PLA vermelho" })).toMatchObject({ material_code: null, color_code: null, color: "PLA vermelho" });
  });
  it("normaliza apenas códigos informados e mantém a descrição da cor", () => {
    expect(normalizeMaterialIdentity({ ...empty, materialCode: " petg-cf ", colorCode: " cf-blk-01 ", color: " Preto ", colorHex: " #abcdef " })).toMatchObject({ material_code: "PETG-CF", color_code: "CF-BLK-01", color: "Preto", color_hex: "#ABCDEF" });
  });
  it("exige a descrição de outros materiais e recusa códigos ambíguos", () => {
    expect(() => normalizeMaterialIdentity({ ...empty, materialCode: "OTHER" })).toThrow("Descreva");
    expect(() => normalizeMaterialIdentity({ ...empty, materialCode: "PLA genérico" })).toThrow("catálogo");
    expect(() => normalizeMaterialIdentity({ ...empty, colorCode: "azul;vermelho" })).toThrow("código de cor");
    expect(() => normalizeMaterialIdentity({ ...empty, colorHex: "red" })).toThrow("#RRGGBB");
  });
  it("só apresenta a amostra visual quando existe um hexadecimal válido", () => {
    expect(materialColorSwatch("Vermelho")).toBe("transparent");
    expect(materialColorSwatch("#AABBCC")).toBe("#AABBCC");
  });
});
