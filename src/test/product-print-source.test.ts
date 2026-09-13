import { describe, expect, it } from "vitest";
import { makerWorldDesignId, MAX_PRINT_FILE_BYTES, normalizePrintSourceUrl, printSourceHasIdentifiers, printSourceIdentifiers, printSourceNeedsTaskBinding, safePrintFileName, validatePrintFile } from "@/lib/product-print-source";

describe("product print source identity and file validation", () => {
  it.each(["part.STL", "plate.3mf", "plate.gcode"]) ("accepts %s without interpreting or executing its contents", name => {
    expect(() => validatePrintFile({ name, size: MAX_PRINT_FILE_BYTES })).not.toThrow();
  });
  it("rejects renamed executables, empty files and uploads above the limit", () => {
    for (const file of [{ name: "plate.gcode.exe", size: 10 }, { name: "plate.zip", size: 10 }, { name: "plate.3mf", size: 0 }, { name: "plate.3mf", size: MAX_PRINT_FILE_BYTES + 1 }]) {
      expect(() => validatePrintFile(file)).toThrow();
    }
  });
  it("keeps uploaded names within the generated object directory", () => {
    expect(safePrintFileName("..\\folder/peça final.STL")).toBe("pe_a_final.STL");
    expect(safePrintFileName("a".repeat(300) + ".gcode").endsWith(".gcode")).toBe(true);
  });
  it("extracts a MakerWorld design without assigning the fragment to a cloud profile", () => {
    expect(makerWorldDesignId("https://makerworld.com/pt/models/12345-vaso#profileId-999")).toBe("12345");
    expect(makerWorldDesignId("https://makerworld.com.attacker.test/en/models/12345")).toBeNull();
    expect(makerWorldDesignId("https://other.test/file-12345.3mf")).toBeNull();
  });
  it("rejects unsafe URLs and embedded credentials", () => {
    for (const url of ["javascript:alert(1)", "file:///C:/part.stl", "http://example.test/part", "https://user:password@example.test/part"]) expect(() => normalizePrintSourceUrl(url)).toThrow();
    expect(normalizePrintSourceUrl(" https://makerworld.com/en/models/123 ")).toBe("https://makerworld.com/en/models/123");
  });
  it("retains explicit zero plate numbers and requires a real identifier", () => {
    const ids = printSourceIdentifiers({ design_id: "", instance_id: "", model_id: " cloud-model ", profile_id: "456", plate_index: "0" });
    expect(ids).toEqual({ design_id: null, instance_id: null, model_id: "cloud-model", profile_id: "456", plate_index: 0 });
    expect(printSourceHasIdentifiers({ plate_index: 1 })).toBe(false);
    expect(printSourceHasIdentifiers(ids)).toBe(true);
    expect(() => printSourceIdentifiers({ design_id: "", instance_id: "", model_id: "", profile_id: "", plate_index: "1.5" })).toThrow();
  });
  it("keeps a broad MakerWorld link pending until an exact profile and plate are known", () => {
    expect(printSourceNeedsTaskBinding({ design_id: "123" })).toBe(true);
    expect(printSourceNeedsTaskBinding({ model_id: "model", profile_id: "profile" })).toBe(true);
    expect(printSourceNeedsTaskBinding({ model_id: "model", profile_id: "profile", plate_index: 0 })).toBe(false);
    expect(printSourceNeedsTaskBinding({ design_id: "123", instance_id: "456", plate_index: 1 })).toBe(false);
  });
});
