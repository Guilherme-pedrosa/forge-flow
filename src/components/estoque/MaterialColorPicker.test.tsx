import { useState, type ReactElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MATERIAL_COLOR_PRESETS, MaterialColorPicker, selectMaterialColor, type MaterialColorValue } from "./MaterialColorPicker";

// Verify persisted color identity and selection here; the actual Radix popup,
// focus, positioning and native browser chooser are checked on the published UI.
vi.mock("@/components/ui/popover", async () => {
  const { createContext, cloneElement, useContext } = await import("react");
  const Context = createContext({ open: false, change: (_open: boolean) => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) => <Context.Provider value={{ open, change: onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ children }: { children: ReactElement<{ onClick?: () => void }> }) => {
      const context = useContext(Context);
      return cloneElement(children, { onClick: () => context.change(!context.open) });
    },
    PopoverContent: ({ children }: { children: ReactNode }) => useContext(Context).open ? <div role="dialog">{children}</div> : null,
  };
});

function Harness({ initial = { hex: "", name: "", code: "" } }: { initial?: MaterialColorValue }) {
  const [value, setValue] = useState(initial);
  return <><MaterialColorPicker id="color" value={value} onChange={setValue} /><output aria-label="Cor selecionada">{JSON.stringify(value)}</output></>;
}
beforeEach(() => {
  class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(window, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverMock });
});
afterEach(cleanup);
async function click(element: HTMLElement) { await act(async () => { fireEvent.click(element); }); }

describe("paleta visual de material", () => {
  it("seleciona uma cor pronta sem digitar HEX e fecha a paleta", async () => {
    render(<Harness />);
    await click(screen.getByRole("button", { name: "Escolher cor do material" }));
    const palette = screen.getByRole("group", { name: "Cores disponíveis" });
    expect(within(palette).getAllByRole("button")).toHaveLength(28);
    await click(within(palette).getByRole("button", { name: "Vermelho" }));
    expect(screen.getByLabelText("Cor selecionada")).toHaveTextContent(JSON.stringify({ hex: "#E53935", name: "Vermelho", code: "RED" }));
    expect(screen.queryByRole("group", { name: "Cores disponíveis" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher cor do material" })).toHaveTextContent("Vermelho");
  });

  it("marca a escolha atual e permite substituir uma escolha anterior da paleta", async () => {
    render(<Harness initial={{ hex: "#ffffff", name: "Branco", code: "WHITE" }} />);
    await click(screen.getByRole("button", { name: "Escolher cor do material" }));
    const white = screen.getByRole("button", { name: "Branco" });
    expect(white).toHaveAttribute("aria-pressed", "true");
    white.focus();
    expect(white).toHaveFocus();
    await click(screen.getByRole("button", { name: "Azul" }));
    expect(screen.getByLabelText("Cor selecionada")).toHaveTextContent(JSON.stringify({ hex: "#1E88E5", name: "Azul", code: "BLUE" }));
  });

  it("preserva nome e código personalizados ao escolher amostra ou cor livre", async () => {
    render(<Harness initial={{ hex: "#FFFFFF", name: "Branco Jade Bambu", code: "BAMBU-001" }} />);
    await click(screen.getByRole("button", { name: "Escolher cor do material" }));
    await click(screen.getByRole("button", { name: "Marfim" }));
    expect(screen.getByLabelText("Cor selecionada")).toHaveTextContent('"name":"Branco Jade Bambu","code":"BAMBU-001"');
    await click(screen.getByRole("button", { name: "Escolher cor do material" }));
    await act(async () => { fireEvent.change(screen.getByLabelText("Escolher qualquer cor"), { target: { value: "#12ab34" } }); });
    expect(screen.getByLabelText("Cor selecionada")).toHaveTextContent(JSON.stringify({ hex: "#12AB34", name: "Branco Jade Bambu", code: "BAMBU-001" }));
    await click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.getByLabelText("Cor selecionada")).toHaveTextContent(JSON.stringify({ hex: "", name: "Branco Jade Bambu", code: "BAMBU-001" }));
  });

  it("completa somente os campos vazios ou ainda pertencentes à escolha anterior", () => {
    const blue = MATERIAL_COLOR_PRESETS.find(preset => preset.code === "BLUE")!;
    expect(selectMaterialColor({ hex: "#FFFFFF", name: "Branco do fornecedor", code: "WHITE" }, blue))
      .toEqual({ hex: "#1E88E5", name: "Branco do fornecedor", code: "BLUE" });
    expect(selectMaterialColor({ hex: "", name: "", code: "CODIGO-LOTE" }, blue))
      .toEqual({ hex: "#1E88E5", name: "Azul", code: "CODIGO-LOTE" });
  });
});
