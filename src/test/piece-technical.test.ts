import { describe, expect, it } from "vitest";
import {
  pieceDraft,
  changePieceBasis,
  pieceForecast,
  piecePayload,
  pieceTime,
  type PieceTechnical,
} from "@/lib/piece-technical";
describe("ficha técnica dos subitens", () => {
  it("preserves per-piece values when changing the input basis", () => {
    const d = pieceDraft();
    d.units = "20";
    d.minutes = "2,5";
    d.materials[0].grams = "3";
    const plate = changePieceBasis(d, "plate");
    expect(plate.minutes).toBe("50");
    expect(plate.materials[0].grams).toBe("60");
    expect(piecePayload(plate).print_seconds).toBe(150);
    expect(piecePayload(plate).materials[0].grams).toBe(3);
    expect(changePieceBasis(plate, "piece").minutes).toBe("2.5");
  });
  it("converts a plate of equal parts into physical-unit grams and seconds, retaining multicolor lines", () => {
    const d = pieceDraft();
    d.basis = "plate";
    d.units = "20";
    d.minutes = "90";
    d.materials[0].grams = "55,5";
    d.materials.push({ ...d.materials[0], grams: "10" });
    const p = piecePayload(d);
    expect(p.materials.map((m) => m.grams)).toEqual([2.775, 0.5]);
    expect(p.print_seconds).toBe(270);
    expect(p.finishing_seconds).toBe(0);
    expect(p.machine_hour_cost).toBeNull();
  });
  it("keeps unavailable source values unknown and rejects invalid yields", () => {
    const d = pieceDraft();
    expect(piecePayload(d).materials[0].grams).toBeNull();
    expect(piecePayload(d).print_seconds).toBeNull();
    d.basis = "plate";
    expect(() => piecePayload(d)).toThrow(/quantas peças/);
    d.units = "2.5";
    expect(() => piecePayload(d)).toThrow(/10000/);
    expect(pieceTime(null)).toBe("Não informado");
    expect(pieceTime(3661)).toBe("1h 1min 1s");
  });
  it("rounds a mixed plate once and includes all physical outputs and surplus", () => {
    const technical = {
      source: "manual",
      grams: 5,
      print_seconds: 60,
      estimated_cost: 1,
    } as PieceTechnical;
    const f = pieceForecast([
      {
        id: "half",
        plate_id: "mixed",
        quantity_per_plate: 10,
        quantity_per_product: 2,
        to_print: 0,
        technical,
      },
      {
        id: "leaf",
        plate_id: "mixed",
        quantity_per_plate: 5,
        quantity_per_product: 1,
        to_print: 6,
        technical,
      },
    ]);
    expect(f.map((x) => x.count)).toEqual([20, 10]);
    expect(f.map((x) => x.grams)).toEqual([100, 50]);
    expect(f.map((x) => x.surplus)).toEqual([20, 4]);
  });
  it("zero replenishment needs zero filament; missing specifications never become zero for a pending print", () => {
    const base = {
      id: "x",
      plate_id: null,
      quantity_per_plate: null,
      quantity_per_product: 1,
    };
    expect(pieceForecast([{ ...base, to_print: 0 }])[0].grams).toBe(0);
    expect(pieceForecast([{ ...base, to_print: 2 }])[0].grams).toBeNull();
    expect(
      pieceForecast([{ ...base, quantity_per_product: null, to_print: 0 }])[0]
        .count,
    ).toBeNull();
  });
});
