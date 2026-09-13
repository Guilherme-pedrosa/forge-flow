import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { normalizeMakerWorldDesign, parseMakerWorldUrl, type MakerWorldModel } from "../../supabase/functions/_shared/makerworld";

export type ProductExternalImport = MakerWorldModel & { provider: "makerworld"; source_url: string; selected_profile_id: string | null; fetched_at: string };

const optionalText = z.string().nullable().catch(null);
const identifier = z.string().regex(/^[1-9]\d{0,18}$/).nullable().catch(null);
const quantity = z.number().finite().nonnegative().nullable().catch(null);
const count = z.number().finite().int().nonnegative().nullable().catch(null);
const httpsAddress = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}).transform(value => new URL(value).toString());
const optionalAddress = httpsAddress.nullable().catch(null);
function safeArray<T extends z.ZodTypeAny>(schema: T) {
  return z.unknown().transform(value => (Array.isArray(value) ? value : []).flatMap(entry => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data as z.output<T>] : [];
  }));
}
const strings = safeArray(z.string());
const images = safeArray(httpsAddress);
const filamentSchema = z.object({ id: optionalText, type: optionalText, color: optionalText, grams: quantity, meters: quantity }).passthrough();
const plateSchema = z.object({
  index: count, name: optionalText, weight_grams: quantity, time_seconds: quantity,
  filaments: safeArray(filamentSchema), thumbnail: optionalAddress, images,
  objects: safeArray(z.object({ id: optionalText, name: optionalText }).passthrough()),
  units_per_plate: z.null().catch(null), warnings: strings,
}).passthrough();
const variantFields = {
  profile_id: identifier, printer_model: optionalText, printer_code: optionalText, nozzle_diameter: quantity,
  weight_grams: quantity, time_seconds: quantity, plates: count, plate_details: safeArray(plateSchema),
  filaments: safeArray(filamentSchema), images, warnings: strings,
};
const variantSchema = z.object(variantFields).passthrough();
const profileSchema = z.object({
  ...variantFields, instance_id: identifier, name: optionalText, description: z.string().catch(""),
  is_default: z.boolean().catch(false), need_ams: z.boolean().nullable().catch(null), variants: safeArray(variantSchema),
}).passthrough();
const externalReferenceSchema = z.object({
  schema_version: z.literal(1), provider: z.literal("makerworld"), id: z.string().regex(/^[1-9]\d{0,18}$/),
  design_id: z.string().regex(/^[1-9]\d{0,18}$/), model_id: optionalText, source_url: z.string(),
  title: z.string().trim().min(1), description: z.string().catch(""), description_html: z.string().catch(""),
  thumbnail: optionalAddress, gallery: images, images, profiles: safeArray(profileSchema),
  default_instance_id: identifier, selected_instance_id: identifier, selected_profile_id: identifier,
  selected_variant_profile_id: identifier,
  author: z.object({ name: optionalText, handle: optionalText, url: optionalAddress }).passthrough().nullable().catch(null),
  license: optionalText, tags: strings, categories: strings,
  files: safeArray(z.object({
    name: z.string(), type: optionalText, size_bytes: quantity, url: optionalAddress, thumbnail: optionalAddress,
    download_available: z.boolean().catch(false), temporary_url: z.boolean().catch(false),
  }).passthrough().transform(file => ({ ...file, download_available: !!file.url && file.download_available }))),
  accessories: safeArray(z.object({ name: z.string(), sku: optionalText, quantity, url: optionalAddress }).passthrough()),
  documentation: safeArray(z.object({ title: z.string(), url: httpsAddress }).passthrough()),
  plates: count, warnings: strings, metadata_complete: z.boolean().catch(false), fetched_at: z.string().catch(""),
}).passthrough();

/** Read persisted normalized metadata, without treating it as raw MakerWorld API data.
 * Invalid identity rejects the reference; missing optional details stay unknown.
 * Every field used as a URL or collection by the reference UI is checked here.
 */
export function readProductExternalImport(value: unknown): ProductExternalImport | null {
  const parsed = externalReferenceSchema.safeParse(value);
  if (!parsed.success) return null;
  const reference = parsed.data;
  let source: ReturnType<typeof parseMakerWorldUrl>;
  try { source = parseMakerWorldUrl(reference.source_url); } catch { return null; }
  if (source.designId !== reference.design_id || reference.id !== reference.design_id) return null;
  const selectedId = reference.selected_profile_id ?? reference.selected_instance_id;
  const selected = reference.profiles.find(profile => selectedId !== null && profile.instance_id === selectedId);
  const variant = selected && [selected, ...selected.variants].find(entry =>
    reference.selected_variant_profile_id !== null && entry.profile_id === reference.selected_variant_profile_id);
  return { ...reference, source_url: source.url,
    selected_profile_id: selected?.instance_id ?? null, selected_instance_id: selected?.instance_id ?? null,
    selected_variant_profile_id: variant?.profile_id ?? null,
  } as ProductExternalImport;
}

export async function fetchMakerWorldModel(url: string, signal?: AbortSignal): Promise<MakerWorldModel> {
  signal?.throwIfAborted();
  const source = parseMakerWorldUrl(url);
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const started = await rpc("request_makerworld_import", { p_url: source.url });
  if (started.error) throw new Error(started.error.message);
  const requestId = started.data;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const response = await rpc("get_makerworld_import", { p_request_id: requestId });
    if (response.error) throw new Error(response.error.message);
    const result = response.data as { status: string; payload?: unknown; message?: string };
    if (result.status === "ready") { signal?.throwIfAborted(); return normalizeMakerWorldDesign(result.payload, source.url); }
    if (result.status === "error") throw new Error(result.message || "O MakerWorld não disponibilizou os dados deste modelo.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Consulta cancelada", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 700);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  throw new Error("A consulta demorou mais que o esperado. Tente novamente em alguns instantes.");
}

export function externalImportReference(model: MakerWorldModel, sourceUrl: string, profileIndex: number): ProductExternalImport {
  const source = parseMakerWorldUrl(sourceUrl);
  if (source.designId !== model.design_id || model.id !== model.design_id) throw new Error("O modelo importado não corresponde ao link informado.");
  const selected = model.profiles[profileIndex]?.instance_id || null;
  const url = new URL(source.url);
  url.hash = selected ? `profileId-${selected}` : "";
  return { ...model, provider: "makerworld", source_url: url.toString(),
    selected_instance_id: selected, selected_profile_id: selected, fetched_at: new Date().toISOString() };
}

export function legacyMakerWorldUrl(notes: string | null | undefined): string | null {
  const designId = notes?.match(/Importado do MakerWorld\s*[—-]\s*ID:\s*(\d+)/i)?.[1];
  return designId ? `https://makerworld.com/pt/models/${designId}` : null;
}
