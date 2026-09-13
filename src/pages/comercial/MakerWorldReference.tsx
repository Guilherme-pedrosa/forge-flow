import { useState } from "react";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import type { MakerWorldVariant, MakerWorldProfile } from "../../../supabase/functions/_shared/makerworld";

const grams = (value: number | null | undefined) => value == null ? "Peso não informado" : `${value.toLocaleString("pt-BR")} g`;
const duration = (value: number | null | undefined) => value == null ? "Tempo não informado" : `${Math.floor(value / 3600)}h ${Math.ceil(value % 3600 / 60)}min`;

export function MakerWorldPrinterOption({ profile, value, onChange }: { profile?: MakerWorldProfile; value: string; onChange: (value: string) => void }) {
  if (!profile) return null;
  return <div className="space-y-2"><label htmlFor="maker-printer-variant" className="text-sm font-medium">Configuração da impressora</label>
    <select id="maker-printer-variant" className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base" value={value} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>Selecione a impressora e o bico</option>
      {[profile, ...profile.variants].map((variant, index) => <option key={index} value={index}>{variant.printer_model || "Impressora não informada"}{variant.nozzle_diameter ? ` · bico ${variant.nozzle_diameter} mm` : ""} · {grams(variant.weight_grams)} · {duration(variant.time_seconds)}</option>)}
    </select>
    <p className="text-xs text-muted-foreground">Use a configuração correspondente à impressora que produzirá o item.</p>
  </div>;
}

function VariantDetails({ value }: { value: MakerWorldVariant }) {
  return <div className="mt-2 space-y-2 text-sm">
    <p className="font-medium">{value.printer_model || "Impressora não informada"}{value.nozzle_diameter ? ` · bico ${value.nozzle_diameter} mm` : ""}</p>
    <p>{value.plates == null ? "Quantidade de placas não informada" : `${value.plates} placas`} · {grams(value.weight_grams)} · {duration(value.time_seconds)}</p>
    {value.filaments.map((filament, index) => <p key={index} className="flex flex-wrap items-center gap-2">
      {filament.color && /^#[0-9a-f]{6}$/i.test(filament.color) && <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: filament.color }} />}
      <span>{filament.type || "Material não informado"} · {filament.color || "Cor não informada"} · {grams(filament.grams)}</span>
    </p>)}
    {value.plate_details.map((plate, index) => <div key={index} className="rounded-md bg-muted/40 p-2">
      {plate.thumbnail && <a href={plate.thumbnail} target="_blank" rel="noopener noreferrer" className="float-right ml-2"><img src={plate.thumbnail} alt={`Vista da placa ${plate.index ?? ""}`} referrerPolicy="no-referrer" loading="lazy" className="h-16 w-16 rounded object-contain" /></a>}
      <p className="font-medium">Placa {plate.index ?? "sem índice"}{plate.name ? ` · ${plate.name}` : ""}</p>
      <p>{grams(plate.weight_grams)} · {duration(plate.time_seconds)}</p>
      {plate.filaments.map((filament, i) => <p key={i} className="break-words text-xs">{filament.type || "Material não informado"} · {filament.color || "Cor não informada"} · {grams(filament.grams)}</p>)}
      <p className="text-xs text-muted-foreground">Rendimento em unidades: confirmar no arquivo</p>
    </div>)}
    {value.warnings.map((warning, index) => <p key={index} className="text-xs text-muted-foreground">{warning}</p>)}
  </div>;
}

/** External specifications remain separate from approved recipes and actual consumption. */
export default function MakerWorldReference({ value }: { value: ProductExternalImport }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const images = [...new Set([value.thumbnail, ...(value.gallery || [])].filter(Boolean))] as string[];
  return <section className="min-w-0 space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:p-4" aria-label="Detalhamento importado do MakerWorld">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Referência do MakerWorld</h3><p className="text-xs text-muted-foreground">{images.length} fotos · {value.profiles.length} perfis</p></div>
      <a href={value.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm text-primary">Abrir original <ExternalLink className="h-4 w-4" /></a>
    </div>
    {images.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {(showAllPhotos ? images : images.slice(0, 3)).map((url, index) => <button key={url} type="button" className="aspect-square min-w-0 overflow-hidden rounded-lg border bg-background" aria-label={`Ampliar foto ${index + 1} do MakerWorld`} onClick={() => setPhoto(url)}>
        <img src={url} alt={`${value.title} — foto ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      </button>)}
    </div>}
    {images.length > 3 && <button type="button" className="min-h-11 text-sm text-primary underline" onClick={() => setShowAllPhotos(value => !value)}>{showAllPhotos ? "Recolher fotos" : `Ver todas as ${images.length} fotos`}</button>}
    {!images.length && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="h-4 w-4" />A origem não forneceu fotos.</p>}
    <details className="min-w-0"><summary className="min-h-11 cursor-pointer text-sm font-medium">Ver ficha técnica, placas e materiais</summary>
    <p className="mb-3 text-sm leading-relaxed">Previsões do arquivo de impressão. Confira a impressora, o rendimento das placas e os materiais e cores do estoque na composição.</p>
    {(value.author?.name || value.license) && <p className="mb-2 text-xs text-muted-foreground">{value.author?.name ? `Autor: ${value.author.name}` : ""}{value.license ? ` · Licença: ${value.license}` : ""}</p>}
    {value.description && <details className="rounded-lg border bg-background p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Descrição completa do modelo</summary><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{value.description}</p></details>}
    {value.profiles.map((profile, index) => <details key={profile.instance_id || index} open={value.selected_profile_id === profile.instance_id} className="min-w-0 rounded-lg border bg-background p-3">
      <summary className="min-h-8 cursor-pointer text-sm font-medium">{profile.name || `Perfil ${index + 1}`} {value.selected_profile_id === profile.instance_id ? "· selecionado" : ""}</summary>
      {profile.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{profile.description}</p>}
      {[profile, ...profile.variants].map((variant, variantIndex) => <details key={variantIndex} open={value.selected_variant_profile_id === variant.profile_id} className="mt-2 min-w-0 rounded-lg border p-2">
        <summary className="min-h-8 cursor-pointer text-sm">{variant.printer_model || "Configuração original"}{value.selected_variant_profile_id === variant.profile_id ? " · selecionada" : ""}</summary><VariantDetails value={variant} />
      </details>)}
    </details>)}
    {!value.profiles.length && <p className="text-sm text-muted-foreground">Nenhum perfil de impressão público disponível. Vincule o arquivo 3MF para preparar a produção.</p>}
    {value.tags.length > 0 && <p className="my-3 break-words text-xs text-muted-foreground">{value.tags.join(" · ")}</p>}
    {(value.files.length > 0 || value.accessories.length > 0 || value.documentation.length > 0) && <details className="min-w-0 rounded-lg border bg-background p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Arquivos, acessórios e instruções</summary>
      {value.files.map((file, index) => <p key={index} className="my-2 break-words text-sm">{file.name}{file.url && file.download_available ? <a className="ml-2 text-primary underline" href={file.url} target="_blank" rel="noopener noreferrer">Baixar arquivo</a> : " · download disponível no original"}</p>)}
      {value.accessories.map((item, index) => <p key={index} className="my-2 break-words text-sm">{item.quantity != null ? `${item.quantity} × ` : ""}{item.name}{item.sku ? ` · ${item.sku}` : ""}</p>)}
      {value.documentation.map((item, index) => <a key={index} className="my-2 block min-h-11 break-words text-sm text-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>)}
    </details>}
    {value.warnings.length > 0 && <div className="space-y-1 rounded-lg bg-background p-3 text-xs text-muted-foreground">{value.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    </details>
    <Dialog open={!!photo} onOpenChange={open => { if (!open) setPhoto(null); }}>
      <DialogContent className="max-w-3xl"><DialogHeader className="pr-10"><DialogTitle>Foto do produto</DialogTitle><DialogDescription>{value.title}</DialogDescription></DialogHeader>
        {photo && <img src={photo} alt={value.title} referrerPolicy="no-referrer" className="max-h-[70dvh] w-full object-contain" />}
      </DialogContent>
    </Dialog>
  </section>;
}
