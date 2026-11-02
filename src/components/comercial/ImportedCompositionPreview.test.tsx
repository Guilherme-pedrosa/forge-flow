import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportedCompositionPreview } from "./ImportedCompositionPreview";
import type { ImportedComposition } from "@/lib/imported-composition";

vi.mock("./ImportedModelImage", () => ({ ImportedModelImage: ({ alt }: { alt: string }) => <span>{alt}</span> }));
function composition(): ImportedComposition {
  return { profile_id: `local:${"a".repeat(64)}`, file_sha256: "a".repeat(64), enabled: true, plates: [
    { index: 1, label: "Corpos", photo_url: null, units_per_plate: null, weight_grams: 20, time_seconds: 1800,
      parts: [{ source_key: "body", name: "Corpo", photo_url: null, name_source: "file", quantity_per_plate: 4, quantity_per_product: 2 }] },
    { index: 2, label: "Tampas", photo_url: null, units_per_plate: null, weight_grams: 30, time_seconds: 2400,
      parts: [{ source_key: "lid", name: "Tampa", photo_url: null, name_source: "file", quantity_per_plate: 2, quantity_per_product: null }] },
  ] };
}
afterEach(cleanup);

describe("composition yield from the primary pricing form", () => {
  it("shows the confirmed total once and removes duplicate plate yield questions and the one-product shortcut", () => {
    const changed = vi.fn();
    render(<ImportedCompositionPreview value={composition()} confirmedQuantity={2} onChange={changed} />);
    expect(screen.getByText(/Produtos completos confirmados na precificação:/)).toHaveTextContent("2");
    expect(screen.queryByLabelText("Produtos atendidos por esta impressão")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Esta composição forma 1 produto" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Por produto")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Controlar estoque dos componentes e montar o produto final" })).toBeChecked();
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps the existing yield editor available when no quantity is confirmed", () => {
    render(<ImportedCompositionPreview value={composition()} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText("Produtos atendidos por esta impressão")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Esta composição forma 1 produto" })).toBeVisible();
    expect(screen.queryByText(/Produtos completos confirmados/)).not.toBeInTheDocument();
  });
  it("preserves unknown physical counts and quantities while allowing part and assembly edits", () => {
    const value = composition(); value.plates[1].parts[0].quantity_per_plate = null;
    const before = structuredClone(value), changed = vi.fn();
    render(<ImportedCompositionPreview value={value} confirmedQuantity={2} onChange={changed} />);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Por produto")[1]).toHaveValue(null);
    fireEvent.change(screen.getAllByLabelText("Por produto")[0], { target: { value: "3" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ plates: [expect.objectContaining({ units_per_plate: null, parts: [expect.objectContaining({ quantity_per_plate: 4, quantity_per_product: 3 })] }),
      expect.objectContaining({ units_per_plate: null, parts: [expect.objectContaining({ quantity_per_plate: null, quantity_per_product: null })] })] }));
    fireEvent.click(screen.getByRole("switch", { name: "Controlar estoque dos componentes e montar o produto final" }));
    expect(changed).toHaveBeenLastCalledWith({ ...before, enabled: false });
    expect(value).toEqual(before);
  });
  it("does not turn an invalid confirmed count into an assumed yield", () => {
    render(<ImportedCompositionPreview value={composition()} confirmedQuantity={0} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText("Produtos atendidos por esta impressão")).toHaveLength(2);
    expect(screen.queryByText(/Produtos completos confirmados/)).not.toBeInTheDocument();
  });
});
