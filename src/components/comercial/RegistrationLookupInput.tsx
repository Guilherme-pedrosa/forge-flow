import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Debounced lookup with cancellation; each address owns its request and feedback. */
export function RegistrationLookupInput<T>({ id, value, onChange, format, complete, lookup, capture, success, buttonLabel, hint, placeholder, disabled, onBusy, inputMode = "text", maxLength }: {
  id: string; value: string; onChange: (value: string) => void; format: (value: string) => string;
  complete: (value: string) => boolean; lookup: (value: string, signal: AbortSignal) => Promise<T>;
  capture: () => (data: T) => void; success: (data: T) => string;
  buttonLabel: string; hint: string; placeholder: string; disabled?: boolean; onBusy: (busy: boolean) => void;
  inputMode?: "text" | "numeric"; maxLength?: number;
}) {
  const [state, setState] = useState<{ phase: "idle" | "loading" | "success" | "error"; message: string }>({ phase: "idle", message: "" });
  const active = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onBusy, value }); latest.current = { onBusy, value };
  const lastInput = useRef(value);
  const cancel = () => { active.current?.abort(); active.current = null; if (timer.current) clearTimeout(timer.current); timer.current = null; latest.current.onBusy(false); };
  useEffect(() => () => { active.current?.abort(); if (timer.current) clearTimeout(timer.current); latest.current.onBusy(false); }, []);
  useEffect(() => {
    // An external change (for example CNPJ filling CEP) invalidates the old result.
    if (lastInput.current !== value) { cancel(); lastInput.current = value; setState({ phase: "idle", message: "" }); }
    // Request lifecycle is owned by this field; callback identities do not restart it.
  }, [value]);
  useEffect(() => {
    if (disabled) { cancel(); setState(current => current.phase === "loading" ? { phase: "idle", message: "" } : current); }
  }, [disabled]);
  const run = async (query: string, apply: (data: T) => void) => {
    cancel(); const controller = new AbortController(); active.current = controller;
    setState({ phase: "loading", message: "Consultando…" }); latest.current.onBusy(true);
    try {
      const data = await lookup(query, controller.signal);
      if (controller.signal.aborted || active.current !== controller || latest.current.value !== query) return;
      apply(data); setState({ phase: "success", message: success(data) });
    } catch (error) {
      if (!controller.signal.aborted && active.current === controller) setState({ phase: "error", message: error instanceof Error ? error.message : "Consulta indisponível. Preencha manualmente ou tente novamente." });
    } finally { if (active.current === controller) { active.current = null; latest.current.onBusy(false); } }
  };
  const edit = (raw: string) => {
    cancel(); const next = format(raw); lastInput.current = next; setState({ phase: "idle", message: "" });
    const apply = capture(); onChange(next);
    if (complete(next)) timer.current = setTimeout(() => { void run(next, apply); }, 450);
  };
  return <div className="min-w-0">
    <div className="flex flex-wrap gap-2">
      <Input id={id} className="min-w-0 flex-1 basis-36" value={value} onChange={event => edit(event.target.value)} placeholder={placeholder} inputMode={inputMode} autoCapitalize="characters" maxLength={maxLength} disabled={disabled} aria-describedby={`${id}-lookup-status`} aria-invalid={state.phase === "error" || undefined} />
      <Button type="button" variant="outline" className="shrink-0" disabled={disabled || state.phase === "loading" || !value.trim()} onClick={() => void run(value, capture())}>
        {state.phase === "loading" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}{buttonLabel}
      </Button>
    </div>
    <p id={`${id}-lookup-status`} role={state.phase === "error" ? "alert" : "status"} className={`mt-1.5 text-xs ${state.phase === "error" ? "text-destructive" : state.phase === "success" ? "text-emerald-700" : "text-muted-foreground"}`}>
      {state.message || hint}
    </p>
  </div>;
}
