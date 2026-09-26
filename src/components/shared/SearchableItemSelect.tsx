import { useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type ItemOption = { id: string; label: string; description?: string; keywords?: string };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function SearchableItemSelect({ id, value, options, onChange, label, emptyLabel = "Sem vínculo", disabled = false, searchPlaceholder = "Digite nome ou código…" }: {
  id?: string; value: string; options: ItemOption[]; onChange: (id: string) => void; label: string;
  emptyLabel?: string; disabled?: boolean; searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find(option => option.id === value);
  const words = normalize(search).trim().split(/\s+/).filter(Boolean);
  const results = options.filter(option => words.every(word => normalize(`${option.label} ${option.description || ""} ${option.keywords || ""}`).includes(word)));
  const visible: ItemOption[] = words.length ? results : [{ id: "", label: emptyLabel }, ...results];
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) setSearch(""); };

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled}
        className="h-auto min-h-11 w-full min-w-0 justify-between gap-2 whitespace-normal px-3 py-2 text-left font-normal">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2 min-w-0 flex-1 break-words" title={selected?.label}>{selected?.label || emptyLabel}</span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} collisionPadding={12} sticky="always"
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }); }}
      className="z-[70] flex max-h-[min(380px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-0 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0">
      <Command label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`} shouldFilter={false} loop className="h-auto min-h-0 [&_[cmdk-input-wrapper]]:shrink-0 [&_[cmdk-input-wrapper]]:bg-muted/30">
        <CommandInput ref={input} aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`} placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
        <CommandList className="min-h-0 max-h-64 flex-1 overscroll-contain" aria-label={`Resultados de ${label.toLocaleLowerCase("pt-BR")}`}>
          <CommandEmpty>Nenhum resultado. Tente outro nome ou código.</CommandEmpty>
          <CommandGroup>{visible.map(option => <CommandItem key={option.id} value={option.id || "__empty__"}
            className="min-h-11 cursor-pointer items-start gap-2 py-2.5"
            onSelect={() => { onChange(option.id); changeOpen(false); }}>
            <Check aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${value === option.id ? "opacity-100" : "opacity-0"}`} />
            <span className="min-w-0 flex-1 break-words"><span className="block">{option.label}</span>{option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}</span>
          </CommandItem>)}</CommandGroup>
        </CommandList>
        <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground" role="status">{results.length} {results.length === 1 ? "resultado" : "resultados"} · digite para filtrar</p>
      </Command>
    </PopoverContent>
  </Popover>;
}
