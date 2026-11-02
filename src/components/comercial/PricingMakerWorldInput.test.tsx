import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PricingMakerWorldInput } from "./PricingMakerWorldInput";
import type { ProductExternalImport } from "@/lib/makerworld-import";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const abortDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => {
  if (!abortDescriptor) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) {
    if (this.aborted) throw new DOMException("Consulta cancelada", "AbortError");
  } });
});
afterAll(() => { if (!abortDescriptor) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
const profile = (id: number, printer: string) => ({ id, profileId: id + 400, title: `Perfil ${printer}`, extention: { modelInfo: {
  compatibility: { devProductName: printer, nozzleDiameter: 0.4 },
  plates: [{ index: 1, name: "Peça", weight: 45, prediction: 3600,
    filaments: [{ id: "1", type: "PLA", color: "#FFFFFF", usedG: 45 }] }],
} } });
const design = (multiple = false) => ({ id: 456, title: "Suporte do MakerWorld", instances: [profile(101, "A1"), ...(multiple ? [profile(102, "P1S")] : [])] });
beforeEach(() => {
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "request_makerworld_import" ? "request-1" : { status: "ready", payload: design() }, error: null }));
});
function enter(url = "https://makerworld.com/pt/models/456-suporte") {
  fireEvent.change(screen.getByLabelText("Link do MakerWorld"), { target: { value: url } });
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "Importar link" })); }
const completeCalls = (loaded: ReturnType<typeof vi.fn>) => loaded.mock.calls.filter(([reference]) => reference !== null);

describe("PricingMakerWorldInput", () => {
  it("prefills the extension's public model link and waits for an explicit import", async () => {
    const loaded = vi.fn();
    render(<PricingMakerWorldInput reference={null} onLoaded={loaded} initialUrl="https://makerworld.com/models/456?appSharePlatform=copy" />);
    expect((screen.getByLabelText("Link do MakerWorld") as HTMLInputElement).value).toContain("/models/456");
    expect(mock.rpc).not.toHaveBeenCalled();
    submit(); await waitFor(() => expect(completeCalls(loaded)).toHaveLength(1));
  });
  it("waits for submission, then imports a unique profile with its native data", async () => {
    const loaded = vi.fn();
    render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter(); expect(mock.rpc).not.toHaveBeenCalled(); submit();
    await waitFor(() => expect(completeCalls(loaded)).toHaveLength(1));
    const reference = completeCalls(loaded)[0][0] as ProductExternalImport;
    expect(reference).toMatchObject({ title: "Suporte do MakerWorld", selected_profile_id: "101", selected_variant_profile_id: "501" });
    expect(reference.profiles[0].plate_details[0]).toMatchObject({ weight_grams: 45, time_seconds: 3600 });
    expect(reference.profiles[0].filaments[0].grams).toBe(45);
    expect(screen.queryByLabelText("Qual perfil de impressão você vai usar?")).not.toBeInTheDocument();
  });

  it("asks only for the profile when the link has more than one print option", async () => {
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === "request_makerworld_import" ? "request-1" : { status: "ready", payload: design(true) }, error: null }));
    const loaded = vi.fn(); render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter(); submit();
    const chooser = await screen.findByLabelText("Qual perfil de impressão você vai usar?");
    expect(completeCalls(loaded)).toHaveLength(0);
    fireEvent.change(chooser, { target: { value: "1:0" } });
    expect(completeCalls(loaded)[0][0]).toMatchObject({ selected_profile_id: "102", selected_variant_profile_id: "502" });
    expect(screen.getByRole("button", { name: "Trocar perfil de impressão" })).toBeInTheDocument();
  });

  it("automatically selects the owned A1 model and hides unowned P1S options", async () => {
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === "request_makerworld_import" ? "request-1" : { status: "ready", payload: design(true) }, error: null }));
    const loaded = vi.fn();
    render(<PricingMakerWorldInput reference={null} onLoaded={loaded} ownedPrinters={[
      { name: "A1 oficina 1", brand: "Bambu Lab", model: "A1" },
      { name: "A1 oficina 2", brand: "Bambu Lab", model: "A1" },
    ]} />);
    // Even a pasted P1S profile cannot select a model absent from the fleet.
    enter("https://makerworld.com/pt/models/456#profileId-102"); submit();
    await waitFor(() => expect(completeCalls(loaded)).toHaveLength(1));
    expect(completeCalls(loaded)[0][0]).toMatchObject({ selected_profile_id: "101", selected_variant_profile_id: "501" });
    expect(screen.queryByLabelText("Qual perfil de impressão você vai usar?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trocar perfil de impressão" })).not.toBeInTheDocument();
    expect(screen.getByText(/Perfil A1/)).toBeVisible();
    expect(screen.queryByText(/P1S/)).not.toBeInTheDocument();
  });

  it("uses the fleet that finished loading while the MakerWorld request was pending", async () => {
    let finish!: (value: { data: unknown; error: null }) => void;
    mock.rpc.mockImplementation((name: string) => name === "request_makerworld_import"
      ? Promise.resolve({ data: "request-1", error: null }) : new Promise(resolve => { finish = resolve; }));
    const loaded = vi.fn();
    const result = render(<PricingMakerWorldInput reference={null} onLoaded={loaded} ownedPrinters={[]} />);
    enter(); submit(); await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    result.rerender(<PricingMakerWorldInput reference={null} onLoaded={loaded} ownedPrinters={[
      { brand: "Bambu Lab", model: "A1" }, { brand: "Bambu Lab", model: "P1S" },
    ]} />);
    await act(async () => { finish({ data: { status: "ready", payload: design(true) }, error: null }); });
    const chooser = await screen.findByLabelText("Qual perfil de impressão você vai usar?");
    expect(chooser).toHaveTextContent("Perfil A1");
    expect(chooser).toHaveTextContent("Perfil P1S");
    expect(completeCalls(loaded)).toHaveLength(0);
    fireEvent.change(chooser, { target: { value: "1:0" } });
    expect(completeCalls(loaded)[0][0]).toMatchObject({ selected_profile_id: "102", selected_variant_profile_id: "502" });
  });

  it("offers the loaded profiles when fleet data arrives after the import response", async () => {
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === "request_makerworld_import" ? "request-1" : { status: "ready", payload: design(true) }, error: null }));
    const loaded = vi.fn();
    const result = render(<PricingMakerWorldInput reference={null} onLoaded={loaded} ownedPrinters={[]} />);
    enter(); submit();
    await screen.findByText(/Não há perfil disponível para os modelos cadastrados/);
    result.rerender(<PricingMakerWorldInput reference={null} onLoaded={loaded} ownedPrinters={[
      { brand: "Bambu Lab", model: "A1" }, { brand: "Bambu Lab", model: "P1S" },
    ]} />);
    const chooser = await screen.findByLabelText("Qual perfil de impressão você vai usar?");
    expect(chooser).toHaveTextContent("Perfil A1");
    expect(chooser).toHaveTextContent("Perfil P1S");
    fireEvent.change(chooser, { target: { value: "0:0" } });
    expect(completeCalls(loaded).at(-1)?.[0]).toMatchObject({ selected_profile_id: "101", selected_variant_profile_id: "501" });
  });

  it("uses a specific profile already selected in the pasted link without asking again", async () => {
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === "request_makerworld_import" ? "request-1" : { status: "ready", payload: design(true) }, error: null }));
    const loaded = vi.fn(); render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter("https://makerworld.com/pt/models/456#profileId-102"); submit();
    await waitFor(() => expect(completeCalls(loaded)).toHaveLength(1));
    expect(completeCalls(loaded)[0][0]).toMatchObject({ selected_profile_id: "102", selected_variant_profile_id: "502" });
    expect(screen.queryByLabelText("Qual perfil de impressão você vai usar?")).not.toBeInTheDocument();
  });

  it("clears the previous calculation as soon as the link is edited", async () => {
    const loaded = vi.fn(); render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter(); submit(); await waitFor(() => expect(completeCalls(loaded)).toHaveLength(1));
    const count = mock.rpc.mock.calls.length;
    enter("https://makerworld.com/pt/models/789");
    expect(loaded.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.queryByText("Suporte do MakerWorld")).not.toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(count);
  });

  it("discards a response for a link that was edited while loading", async () => {
    let finish!: (value: { data: unknown; error: null }) => void;
    mock.rpc.mockImplementation((name: string) => name === "request_makerworld_import"
      ? Promise.resolve({ data: "request-1", error: null }) : new Promise(resolve => { finish = resolve; }));
    const loaded = vi.fn(); render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter(); submit(); await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    enter("https://makerworld.com/pt/models/789");
    await act(async () => { finish({ data: { status: "ready", payload: design() }, error: null }); });
    expect(completeCalls(loaded)).toHaveLength(0);
    expect(screen.queryByText("Suporte do MakerWorld")).not.toBeInTheDocument();
  });

  it("rejects unsupported links locally and leaves the prior calculation cleared", async () => {
    const loaded = vi.fn(); render(<PricingMakerWorldInput reference={null} onLoaded={loaded} />);
    enter("https://example.com/models/456"); submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(loaded.mock.calls.at(-1)?.[0]).toBeNull();
  });
});
