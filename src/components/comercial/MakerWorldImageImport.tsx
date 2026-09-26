import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Mounted with the URL as its key so a previous image cannot enable a new one. */
export function MakerWorldImageImport({ url, onUse }: { url: string; onUse: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return <section aria-label="Imagem do MakerWorld" className="rounded-lg border p-4 space-y-3">
    <div>
      <h3 className="font-medium">Este link é uma imagem do MakerWorld</h3>
      <p className="mt-1 text-sm text-muted-foreground">Você pode usá-la como foto do produto. Para importar todas as placas, materiais, peso e tempo, abra a página do modelo no MakerWorld e copie o endereço da barra do navegador, com /models/ID.</p>
    </div>
    <img key={attempt} src={url} alt="Prévia da imagem do MakerWorld" referrerPolicy="no-referrer"
      className="mx-auto max-h-52 w-full rounded-md bg-muted object-contain"
      onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
    <div aria-live="polite" className="text-sm">
      {status === "loading" && "Carregando imagem..."}
      {status === "error" && <p>Não foi possível carregar a imagem. Confira o link ou tente novamente.</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={status !== "ready"} onClick={onUse}>Usar imagem no novo produto</Button>
      {status === "error" && <Button type="button" variant="outline" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Tentar novamente</Button>}
    </div>
  </section>;
}
