import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export function SearchableItemSelect({ value, options, onChange, label, emptyLabel = "Sem vínculo", disabled = false }: {
  value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; label: string; emptyLabel?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled} className="h-11 w-full justify-between whitespace-normal text-left font-normal"><span className="min-w-0 truncate" title={options.find(o => o.id === value)?.label}>{options.find(o => o.id === value)?.label || emptyLabel}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-0" align="start"><Command><CommandInput placeholder="Digite nome ou código…" /><CommandList><CommandEmpty>Nenhum item encontrado.</CommandEmpty><CommandGroup>{[{ id: "", label: emptyLabel }, ...options].map(o => <CommandItem key={o.id} value={`${o.label} ${o.id}`} onSelect={() => { onChange(o.id); setOpen(false); }}><Check className={`mr-2 h-4 w-4 shrink-0 ${value === o.id ? "opacity-100" : "opacity-0"}`} />{o.label}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>;
}
