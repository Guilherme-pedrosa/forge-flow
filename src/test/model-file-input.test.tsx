import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import ModelFileInput from "@/components/comercial/ModelFileInput";
import ImportedSlice from "./fixtures/bambu-cube-slice-info.config?raw";
const worker = vi.hoisted(() => ({ result: null as File | null }));
vi.mock("@/components/comercial/SlicingDialog", () => ({ SlicingDialog: ({ onSliced }: { onSliced: (file: File) => void }) => <div role="dialog" aria-label="Simular impressão"><button onClick={() => onSliced(worker.result!)}>Usar resultado do fatiador</button></div> }));

vi.mock("three", async () => ({
  ...await vi.importActual<typeof import("three")>("three"),
  WebGLRenderer: class { constructor() { throw new Error("No WebGL in jsdom"); } },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("direct 3MF upload", () => {
  it("opens the slicer for an STL and returns the verified result to the existing-product review", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const bytes = zipSync({
      "Metadata/slice_info.config": strToU8(ImportedSlice),
      "Metadata/model_settings.config": strToU8('<config><object id="1"><metadata key="name" value="Cube.stl"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>'),
      "3D/3dmodel.model": strToU8('<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'),
    });
    worker.result = new File([bytes], "cube-simulado.3mf");
    Object.defineProperty(worker.result, "arrayBuffer", { value: async () => bytes.buffer });
    const stlBytes = strToU8('solid cube\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid cube');
    const stl = new File([stlBytes], "cube.stl"); Object.defineProperty(stl, "arrayBuffer", { value: async () => stlBytes.buffer });
    const onChange = vi.fn(), onFileReady = vi.fn();
    render(<ModelFileInput revision onChange={onChange} onFileReady={onFileReady} />);
    fireEvent.change(screen.getByLabelText("Abrir projeto 3MF ou peça STL"), { target: { files: [stl] } });
    await screen.findByRole("dialog", { name: "Simular impressão" }); expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar resultado do fatiador" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onFileReady).toHaveBeenLastCalledWith(worker.result);
    expect(onChange.mock.calls[0][0].plates[0]).toMatchObject({ weight_grams: 3.63, time_seconds: 1351 });
    expect(onChange.mock.calls[0][0].profile_id).toMatch(/^local:[a-f0-9]{64}$/);
    await screen.findByText(/Confira a associação com as peças existentes/);
    expect(screen.queryByRole("dialog", { name: "Simular impressão" })).not.toBeInTheDocument();
  });
  it("previews real per-plate slicer stats and applies them with the uploaded file hash", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const onChange = vi.fn();
    const onBusy = vi.fn();
    const onFileReady = vi.fn();
    render(<ModelFileInput onChange={onChange} onBusyChange={onBusy} onFileReady={onFileReady} />);
    const bytes = zipSync({
      "Metadata/slice_info.config": strToU8(ImportedSlice),
      "Metadata/model_settings.config": strToU8('<config><object id="1"><metadata key="name" value="Cube.stl"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>'),
      "3D/3dmodel.model": strToU8('<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'),
    });
    const file = new File([bytes], "cube-sliced.3mf");
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText("Abrir projeto 3MF ou peça STL"), { target: { files: [file] } });
    await screen.findByText(/3.63 g · 23 min · estimativa do fatiador para a placa inteira/);
    expect(screen.getByText(/Filamento 1: PLA #00AE42 · 3.63 g/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onFileReady).toHaveBeenLastCalledWith(file);
    fireEvent.click(screen.getByRole("button", { name: "Usar estas peças no produto" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onFileReady).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0][0];
    expect(applied.file_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(applied.profile_id).toBe(`local:${applied.file_sha256}`);
    expect(applied.plates[0]).toMatchObject({ weight_grams: 3.63, time_seconds: 1351, units_per_plate: null, parts: [{ quantity_per_product: null }] });
    await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    const broken = new File([new Uint8Array([1])], "invalid.3mf");
    Object.defineProperty(broken, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    fireEvent.change(screen.getByLabelText("Abrir projeto 3MF ou peça STL"), { target: { files: [broken] } });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Usar estas peças no produto" })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
