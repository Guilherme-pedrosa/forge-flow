import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MakerWorldProjectSlicer } from "./MakerWorldProjectSlicer";
import type { ProductExternalImport } from "@/lib/makerworld-import";

const mock = vi.hoisted(() => ({ download: vi.fn(), tenant: "company", user: "operator", models: [] as string[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/lib/makerworld-project", async original => ({ ...await original<typeof import("@/lib/makerworld-project")>(), downloadMakerWorldProject: mock.download }));
vi.mock("./SlicingDialog", () => ({ SlicingDialog: ({ file, ownedPrinterModels, onSliced }: { file: File; ownedPrinterModels: string[]; onSliced: (file: File, metadata: unknown) => Promise<void> }) => {
  mock.models = ownedPrinterModels;
  return <div role="dialog" aria-label="Fatiamento local"><p>{file.name}</p><button onClick={() => void onSliced(new File(["native-result"], "resultado.3mf"), { profile_id: "bambu-a2l-04-pla-020-v1" })}>Usar fatiamento</button></div>;
} }));
const file = new File(["project"], "Projeto.3mf");
const source = (count = 1, design = "744793") => ({ design_id: design, selected_profile_id: "public-profile", selected_variant_profile_id: "public-variant",
  files: Array.from({ length: count }, (_, i) => ({ name: `Projeto ${i + 1}.3mf`, url: `https://makerworld.bblmw.com/makerworld/model/${i + 1}.3mf`, size_bytes: 10, download_available: true })) }) as ProductExternalImport;
beforeEach(() => { mock.download.mockReset().mockResolvedValue(file); mock.tenant = "company"; mock.user = "operator"; mock.models = []; });
afterEach(cleanup);

describe("MakerWorld project to the local engine", () => {
  it("explains a missing public 3MF instead of pretending metadata was sliced", () => {
    const reference = source(); reference.files[0].url = null;
    render(<MakerWorldProjectSlicer reference={reference} ownedPrinterModels={["A1"]} onSliced={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/não disponibilizou um download público/);
    expect(screen.queryByRole("button", { name: "Baixar projeto e fatiar" })).not.toBeInTheDocument(); expect(mock.download).not.toHaveBeenCalled();
  });
  it("downloads only on demand and passes the native result and only owned models to the product", async () => {
    const delivered = vi.fn(), busy = vi.fn();
    render(<MakerWorldProjectSlicer reference={source()} ownedPrinterModels={["A1", "A2L"]} onBusyChange={busy} onSliced={delivered} />);
    expect(mock.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Baixar projeto e fatiar" }));
    await screen.findByRole("dialog", { name: "Fatiamento local" });
    expect(mock.models).toEqual(["A1", "A2L"]); expect(busy).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Usar fatiamento" }));
    await waitFor(() => expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ name: "resultado.3mf" }), expect.objectContaining({ profile_id: "bambu-a2l-04-pla-020-v1" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("requires choosing between distinct supplied projects", async () => {
    render(<MakerWorldProjectSlicer reference={source(2)} ownedPrinterModels={["A1"]} onSliced={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Baixar projeto e fatiar" }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Projeto 3MF público"), { target: { value: source(2).files[1].url } });
    fireEvent.click(button); await screen.findByRole("dialog");
    expect(mock.download).toHaveBeenCalledWith(expect.objectContaining({ name: "Projeto 2.3mf" }), expect.anything());
  });
  it("aborts and discards a late download after the selected source or operator changes", async () => {
    let resolve!: (file: File) => void;
    mock.download.mockReturnValue(new Promise<File>(done => { resolve = done; }));
    const delivered = vi.fn(), reference = source();
    const { rerender } = render(<MakerWorldProjectSlicer reference={reference} ownedPrinterModels={["A1"]} onSliced={delivered} />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar projeto e fatiar" }));
    const signal = mock.download.mock.calls[0][1] as AbortSignal;
    mock.user = "other-operator";
    rerender(<MakerWorldProjectSlicer reference={reference} ownedPrinterModels={["A1"]} onSliced={delivered} />);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(file); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(delivered).not.toHaveBeenCalled();
  });
});
