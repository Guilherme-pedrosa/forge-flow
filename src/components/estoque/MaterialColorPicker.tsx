import { useState } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { materialColorSwatch } from "@/lib/material-identity";

export const MATERIAL_COLOR_PRESETS = [
  { name: "Branco", code: "WHITE", hex: "#FFFFFF" },
  { name: "Preto", code: "BLACK", hex: "#1A1A1A" },
  { name: "Cinza claro", code: "LIGHT-GRAY", hex: "#D1D5DB" },
  { name: "Cinza", code: "GRAY", hex: "#808080" },
  { name: "Cinza escuro", code: "DARK-GRAY", hex: "#4B5563" },
  { name: "Prata", code: "SILVER", hex: "#C0C0C0" },
  { name: "Natural", code: "NATURAL", hex: "#F4EAD5" },
  { name: "Bege", code: "BEIGE", hex: "#D2B48C" },
  { name: "Marfim", code: "IVORY", hex: "#FFF8E7" },
  { name: "Marrom", code: "BROWN", hex: "#8B4513" },
  { name: "Caramelo", code: "CARAMEL", hex: "#C68E4B" },
  { name: "Vermelho", code: "RED", hex: "#E53935" },
  { name: "Vinho", code: "BURGUNDY", hex: "#800020" },
  { name: "Laranja", code: "ORANGE", hex: "#FF8C00" },
  { name: "Amarelo", code: "YELLOW", hex: "#FFD600" },
  { name: "Dourado", code: "GOLD", hex: "#D4AF37" },
  { name: "Verde", code: "GREEN", hex: "#43A047" },
  { name: "Verde escuro", code: "DARK-GREEN", hex: "#1B5E20" },
  { name: "Verde lima", code: "LIME", hex: "#A3D900" },
  { name: "Oliva", code: "OLIVE", hex: "#808000" },
  { name: "Azul", code: "BLUE", hex: "#1E88E5" },
  { name: "Azul marinho", code: "NAVY", hex: "#1A237E" },
  { name: "Azul claro", code: "LIGHT-BLUE", hex: "#81D4FA" },
  { name: "Turquesa", code: "TURQUOISE", hex: "#00B8B8" },
  { name: "Roxo", code: "PURPLE", hex: "#7E57C2" },
  { name: "Lilás", code: "LILAC", hex: "#C8A2C8" },
  { name: "Rosa", code: "PINK", hex: "#EC6FA9" },
  { name: "Pink", code: "HOT-PINK", hex: "#E91E63" },
] as const;

export type MaterialColorValue = { hex: string; name: string; code: string };
type Preset = typeof MATERIAL_COLOR_PRESETS[number];
const normalize = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

export function selectMaterialColor(current: MaterialColorValue, preset: Preset): MaterialColorValue {
  const previous = MATERIAL_COLOR_PRESETS.find(color => color.hex === current.hex.toUpperCase());
  return {
    hex: preset.hex,
    name: !current.name.trim() || previous && normalize(current.name) === normalize(previous.name) ? preset.name : current.name,
    code: !current.code.trim() || previous && normalize(current.code) === normalize(previous.code) ? preset.code : current.code,
  };
}

export function MaterialColorPicker({ id, value, onChange }: {
  id: string;
  value: MaterialColorValue;
  onChange: (value: MaterialColorValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = MATERIAL_COLOR_PRESETS.find(color => color.hex === value.hex.toUpperCase());
  const validHex = /^#[0-9a-f]{6}$/i.test(value.hex);
  const setHex = (hex: string) => onChange({ ...value, hex: hex.toUpperCase() });

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" aria-label="Escolher cor do material" className="min-h-10 w-full justify-between gap-2 px-3 font-normal">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded border" style={{ backgroundColor: materialColorSwatch(value.hex) }}>{!validHex && <Palette className="m-auto h-4 w-4 text-muted-foreground" />}</span>
          <span className="truncate">{selected?.name || (validHex ? "Cor personalizada" : "Escolher cor")}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} aria-label="Paleta de cores do material" className="z-[70] max-h-[min(420px,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3">
      <p className="mb-3 text-sm font-medium">Escolha uma cor</p>
      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Cores disponíveis">
        {MATERIAL_COLOR_PRESETS.map(preset => <button key={preset.code} type="button" aria-label={preset.name} aria-pressed={selected?.code === preset.code} title={preset.name}
          className="flex h-11 min-w-0 items-center justify-center rounded-md border p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => { onChange(selectMaterialColor(value, preset)); setOpen(false); }}>
          <span aria-hidden="true" className="flex h-8 w-full items-center justify-center rounded border border-black/10" style={{ backgroundColor: preset.hex }}>
            {selected?.code === preset.code && <Check className="h-5 w-5 rounded-full bg-black/60 p-0.5 text-white" />}
          </span>
        </button>)}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
        <input aria-label="Escolher qualquer cor" type="color" value={validHex ? value.hex : "#FFFFFF"} onChange={event => setHex(event.target.value)} className="h-9 w-11 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <span>Escolher outra cor</span>
      </label>
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer py-1">Informar código HEX (opcional)</summary><Input aria-label="Código HEX da amostra" value={value.hex} onChange={event => setHex(event.target.value)} placeholder="#RRGGBB" maxLength={7} className="mt-2" /></details>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Amostra visual da cor do material.</span>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!value.hex} onClick={() => { setHex(""); setOpen(false); }}>Limpar</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
