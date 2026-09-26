import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { translationSegments, translatePublicDescription } from "@/lib/public-description-translation";
import { MakerWorldDescriptionTranslation } from "@/components/comercial/MakerWorldDescriptionTranslation";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("descrições públicas em português", () => {
  it("divide por parágrafos e bytes UTF-8 sem perder caracteres", () => {
    const source = "A maçã 🍎 ".repeat(90) + "\n\nSecond paragraph.\nFinal line.";
    const chunks = translationSegments(source); expect(chunks.join("")).toBe(source);
    expect(chunks.every(chunk => new TextEncoder().encode(chunk).length <= 480)).toBe(true);
    expect(chunks.some(chunk => chunk === "Second paragraph.\n")).toBe(true);
  });
  it("mantém parágrafos, usa en→pt-BR e reutiliza resultados em vez de consumir outra consulta", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "Descrição traduzida" } })));
    vi.stubGlobal("fetch", fetcher); const signal = new AbortController().signal;
    expect(await translatePublicDescription("A unique public description.\n\nAnother public paragraph.", "en", signal)).toBe("Descrição traduzida\n\nDescrição traduzida");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("langpair")).toBe("en|pt-BR");
    await translatePublicDescription("A unique public description.", "en", signal); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("não salva mensagem de limite como descrição nem retorna tradução parcial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ quotaFinished: true, responseStatus: 429, responseData: { translatedText: "MYMEMORY WARNING" } }))));
    await expect(translatePublicDescription("Public quota test.", "en", new AbortController().signal)).rejects.toThrow("limite diário");
  });
  it("não envia a descrição em português para tradução", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await translatePublicDescription("Peça de impressão 3D", "pt", new AbortController().signal)).toBe("Peça de impressão 3D"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("uma resposta atrasada não substitui texto editado pelo usuário", async () => {
    let resolve!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    function Editor() { const [value, setValue] = useState("Public delayed description."); return <><textarea aria-label="Descrição" value={value} onChange={e => setValue(e.target.value)} /><MakerWorldDescriptionTranslation original="Public delayed description." value={value} onApply={(text, expected) => setValue(current => current === expected ? text : current)} onBusy={() => {}} /></>; }
    render(<Editor />); await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Minha descrição comercial revisada" } });
    resolve(new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "Resposta atrasada" } })));
    await screen.findByText(/Sua edição foi mantida/); expect(screen.getByLabelText("Descrição")).toHaveValue("Minha descrição comercial revisada");
  });
});
