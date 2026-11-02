import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PricingModelFile } from "./PricingModelFile";
import type { ModelPricingEstimate } from "@/lib/model-pricing";
import { useState } from "react";
import { webcrypto } from "node:crypto";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), dispose: vi.fn(), pricing: vi.fn(), slicedFile: null as File | null }));
vi.mock("@/lib/model-file", () => ({ parseModelFile: mocks.parse, disposeModel: mocks.dispose }));
vi.mock("@/lib/model-pricing", () => ({ modelPricingFromComposition: mocks.pricing }));
vi.mock("./SlicingDialog", () => ({ SlicingDialog: ({ open, onSliced, resultLabel }: { open: boolean; onSliced: (file: File, job: { profile_id: string }) => void; resultLabel: string }) => open
  ? <button onClick={() => onSliced(mocks.slicedFile!, { profile_id: "bambu-a1-04-pla-020-v1" })}>{resultLabel}</button> : null }));

const native: ModelPricingEstimate = { hours: 1.5, timeSeconds: 5400, weightGrams: 42, plateCount: 2, partCount: null, printerModelIds: [], nozzleDiameters: ["0.4"], materials: [] };
const a1 = { brand: "Bambu Lab", model: "A1" };
function modelFile(name: string, bytes = Promise.resolve(new Uint8Array([1]).buffer)) {
  const file = new File(["model"], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => bytes });
  return file;
}
function choose(file: File) { fireEvent.change(screen.getByLabelText("Arquivo STL ou 3MF"), { target: { files: [file] } }); }
beforeEach(() => {
  mocks.parse.mockReset().mockReturnValue({ group: "allocated-model", composition: "composition" });
  mocks.dispose.mockReset(); mocks.pricing.mockReset().mockReturnValue(native);
});

describe("PricingModelFile automatic estimates", () => {
  it("imports native estimates without renaming the source file and releases its meshes", async () => {
    const file = modelFile("Minha peça.3mf"), loaded = vi.fn();
    render(<PricingModelFile sourceFile={null} estimate={null} printer={a1} materialCodes={["PLA"]} onLoaded={loaded} />);
    choose(file);
    await waitFor(() => expect(loaded).toHaveBeenCalledWith(file, native));
    expect(mocks.parse).toHaveBeenCalledWith(new Uint8Array([1]), "Minha peça.3mf");
    expect(mocks.dispose).toHaveBeenCalledWith("allocated-model");
    expect(screen.getByLabelText("Arquivo STL ou 3MF")).toHaveValue("");
  });

  it("retains an STL without fabricated time or filament and offers supported slicing", async () => {
    mocks.pricing.mockImplementation(() => { throw new Error("A placa 1 precisa ser fatiada para calcular tempo e filamento."); });
    const file = modelFile("Peça.stl"), loaded = vi.fn();
    const { rerender } = render(<PricingModelFile sourceFile={null} estimate={null} printer={a1} materialCodes={["PLA"]} onLoaded={loaded} />);
    choose(file);
    await waitFor(() => expect(loaded).toHaveBeenCalledWith(file, null));
    rerender(<PricingModelFile sourceFile={file} estimate={null} printer={a1} materialCodes={["PLA"]} onLoaded={loaded} />);
    expect(screen.getByText("Peça.stl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calcular tempo e filamento" })).toBeEnabled();
    expect(screen.queryByText("Filamento total do arquivo")).not.toBeInTheDocument();
  });

  it.each([
    [{ brand: "Bambu Lab", model: "A1 Mini" }, ["PLA"]],
    [a1, ["PETG"]],
    [a1, ["PLA", "PETG"]],
    [a1, []],
    [null, ["PLA"]],
  ])("does not offer the A1 PLA profile for an incompatible selection", (printer, materialCodes) => {
    render(<PricingModelFile sourceFile={modelFile("Peça.stl")} estimate={null} printer={printer} materialCodes={materialCodes} onLoaded={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Calcular tempo e filamento" })).not.toBeInTheDocument();
    expect(screen.getByText(/Para outra impressora ou material/)).toBeInTheDocument();
  });

  it("ignores an older file read after a newer selection completes", async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const oldFile = modelFile("antigo.3mf", new Promise(resolve => { release = resolve; }));
    const currentFile = modelFile("atual.3mf"), loaded = vi.fn();
    render(<PricingModelFile sourceFile={null} estimate={null} printer={a1} materialCodes={["PLA"]} onLoaded={loaded} />);
    choose(oldFile); choose(currentFile);
    await waitFor(() => expect(loaded).toHaveBeenCalledWith(currentFile, native));
    await act(async () => { release(new Uint8Array([2]).buffer); });
    expect(loaded).toHaveBeenCalledTimes(3);
    expect(loaded.mock.calls.filter(([file, estimate]) => file === oldFile && estimate !== null)).toHaveLength(0);
    expect(loaded.mock.calls[2][0]).toBe(currentFile);
  });

  it("does not deliver file results after its draft unmounts", async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const file = modelFile("antigo.3mf", new Promise(resolve => { release = resolve; })), loaded = vi.fn();
    const { unmount } = render(<PricingModelFile sourceFile={null} estimate={null} printer={a1} materialCodes={["PLA"]} onLoaded={loaded} />);
    choose(file); unmount();
    await act(async () => { release(new Uint8Array([2]).buffer); });
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledWith(file, null);
    expect(mocks.dispose).toHaveBeenCalledWith("allocated-model");
  });

  it("replaces the original STL with the returned 3MF so the transferred bytes match its slice estimate", async () => {
    const original = modelFile("Minha peça.stl"), loaded = vi.fn();
    const slicedBytes = new Uint8Array([80, 75, 3, 4, 99]);
    mocks.slicedFile = modelFile("Minha peça-simulado.3mf", Promise.resolve(slicedBytes.buffer));
    function Draft() {
      const [file, setFile] = useState<File | null>(original);
      const [estimate, setEstimate] = useState<ModelPricingEstimate | null>(null);
      return <><PricingModelFile sourceFile={file} estimate={estimate} printer={a1} materialCodes={["PLA"]} onLoaded={(nextFile, nextEstimate) => {
        loaded(nextFile, nextEstimate); setFile(nextFile); setEstimate(nextEstimate);
      }} /><output aria-label="Arquivo a transferir">{file?.name}</output></>;
    }
    render(<Draft />);
    fireEvent.click(screen.getByRole("button", { name: "Calcular tempo e filamento" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar na precificação" }));
    await waitFor(() => expect(loaded).toHaveBeenCalledExactlyOnceWith(mocks.slicedFile, { ...native, printerModelIds: ["Bambu Lab A1"] }));
    expect(mocks.parse).toHaveBeenCalledWith(slicedBytes, "Minha peça-simulado.3mf");
    expect(screen.getByLabelText("Arquivo a transferir")).toHaveTextContent("Minha peça-simulado.3mf");
    expect(screen.getByText("Filamento total do arquivo")).toBeInTheDocument();
    const transferred = loaded.mock.calls[0][0] as File;
    const transferredHash = await webcrypto.subtle.digest("SHA-256", await transferred.arrayBuffer());
    expect(new Uint8Array(transferredHash)).toEqual(new Uint8Array(await webcrypto.subtle.digest("SHA-256", slicedBytes)));
    expect(new Uint8Array(transferredHash)).not.toEqual(new Uint8Array(await webcrypto.subtle.digest("SHA-256", await original.arrayBuffer())));
  });

  it("clears the previous cost immediately and keeps it cleared when its replacement fails", async () => {
    let rejectRead!: (error: Error) => void;
    const oldFile = modelFile("anterior.3mf");
    const replacement = modelFile("corrompido.3mf", new Promise((_resolve, reject) => { rejectRead = reject; }));
    function Draft() {
      const [file, setFile] = useState<File | null>(oldFile);
      const [estimate, setEstimate] = useState<ModelPricingEstimate | null>(native);
      return <PricingModelFile sourceFile={file} estimate={estimate} printer={a1} materialCodes={["PLA"]} onLoaded={(nextFile, nextEstimate) => { setFile(nextFile); setEstimate(nextEstimate); }} />;
    }
    render(<Draft />);
    expect(screen.getByText("Filamento total do arquivo")).toBeInTheDocument();
    choose(replacement);
    expect(screen.queryByText("Filamento total do arquivo")).not.toBeInTheDocument();
    expect(screen.getByText("corrompido.3mf")).toBeInTheDocument();
    await act(async () => { rejectRead(new Error("Arquivo corrompido.")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Arquivo corrompido.");
    expect(screen.queryByText("Filamento total do arquivo")).not.toBeInTheDocument();
  });
});
