import { useEffect, useRef, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { translatePublicDescription } from "@/lib/public-description-translation";
import { Button } from "@/components/ui/button";

export function MakerWorldDescriptionTranslation({ original, value, onApply, onBusy }: { original: string; value: string; onApply: (value: string, expected: string) => void; onBusy: (busy: boolean) => void }) {
  const looksPortuguese = (original.match(/\b(para|você|impressão|presente|professor|maçã|folha|caule|produto|com|uma|não|são)\b/gi) || []).length >= 4;
  const [source, setSource] = useState(looksPortuguese ? "pt" : "en"); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null); const latest = useRef({ value, onApply, onBusy }); latest.current = { value, onApply, onBusy };
  const run = async (language: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const expected = latest.current.value; setBusy(true); latest.current.onBusy(true); setError(""); setMessage("");
    try {
      const text = await translatePublicDescription(original, language, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (latest.current.value !== expected) { setMessage("Você editou a descrição durante a tradução. Sua edição foi mantida."); return; }
      latest.current.onApply(text, expected); setMessage(language === "pt" ? "Descrição original mantida em português." : "Descrição traduzida para português. Revise o texto antes de salvar.");
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Tradução indisponível. O original foi preservado."); }
    finally { if (request.current === controller) { setBusy(false); latest.current.onBusy(false); } }
  };
  useEffect(() => {
    // Auto-translate an untouched public import. Existing user descriptions stay untouched.
    if (original.trim() && latest.current.value === original && !looksPortuguese) void run("en");
    return () => { request.current?.abort(); latest.current.onBusy(false); };
    // This component is keyed by source description; source changes start a fresh draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original]);
  if (!original.trim()) return null;
  return <div className="mt-2 space-y-2 rounded-lg border bg-muted/20 p-3"><div className="flex flex-wrap items-center gap-2"><label className="flex flex-wrap items-center gap-2 text-xs">Idioma original<select className="h-9 rounded-md border bg-background px-2" aria-label="Idioma original da descrição" value={source} disabled={busy} onChange={e => setSource(e.target.value)}>{Object.entries({ en: "Inglês", pt: "Português", es: "Espanhol", fr: "Francês", de: "Alemão", it: "Italiano", "zh-CN": "Chinês", ja: "Japonês" }).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(source)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}{busy ? "Traduzindo…" : "Traduzir para português"}</Button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Descrição original do MakerWorld</summary><p className="mt-2 whitespace-pre-wrap">{original}</p></details><p className="text-xs text-muted-foreground">Tradução automática do texto público pelo MyMemory, sujeita ao limite diário do serviço. Suas observações internas não são enviadas.</p></div>;
}
