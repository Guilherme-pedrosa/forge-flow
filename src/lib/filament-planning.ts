import type { SupabaseClient } from "@supabase/supabase-js";
import { readProductionRows } from "./production-read";
import { excludeUnstartedCancelledJobs } from "./job-source-cancellation";
import { deliveryPreparationDay } from "./order-preparation-deadline";
import { isMissingDatabaseStructure } from "./database-readiness";

export interface FilamentMaterial {
  id: string; name: string; unit: string; current_stock: number; min_stock: number | null;
  vendor_id: string | null; material_code?: string | null; color?: string | null; color_code?: string | null; avg_cost?: number | null;
}
export interface FilamentSpool {
  id: string; item_id: string; label: string; tare_grams: number; initial_net_grams: number;
  estimated_remaining_grams: number; measured_gross_grams: number | null; measured_at: string | null;
  weight_source: "manual_estimate" | "manual_weighing"; location_kind: "storage" | "printer" | "ams";
  location_label: string; printer_id: string | null; ams_unit: number | null; ams_slot: number | null;
  needs_weighing: boolean; is_active: boolean; updated_at: string;
}
export interface FilamentReservation { id: string; job_id: string; item_id: string; spool_id: string | null; grams: number; status: string; released_at: string | null }
export interface FilamentPolicy { item_id: string; vendor_id: string | null; multiple_kg: number; lead_days: number; buffer_grams: number }
export interface FilamentJob {
  id: string; code: string; name: string; status: string; due_date: string | null; est_grams: number | null;
  material_id: string | null; secondary_material_id: string | null; print_plate_id: string | null;
  production_snapshot: unknown; inventory_posted_at: string | null; order_id?: string | null;
  production_order_id?: string | null; production_order_item_id?: string | null;
  order_item_id?: string | null;
  reprint_of?: string | null;
  started_at?: string | null;
}
export interface FilamentDemand { id: string; label: string; due_date: string | null; lines: { item_id: string; grams: number }[] | null; draft_job_ids?: string[] }
export interface FilamentPurchase {
  id: string; code: string; status: string; expected_date: string | null;
  items: { inventory_item_id: string | null; stock_quantity: number | null }[];
}
export interface FilamentPlanningSnapshot {
  items: FilamentMaterial[]; jobs: FilamentJob[]; purchases: FilamentPurchase[];
  reservations: FilamentReservation[]; spools: FilamentSpool[]; policies: FilamentPolicy[];
  committedDemand: FilamentDemand[]; vendors: { id: string; name: string }[];
  printers: { id: string; name: string }[];
}
export interface FilamentPlanMaterial {
  item: FilamentMaterial; stockGrams: number; reservedGrams: number; freeGrams: number;
  spoolGrams: number; spoolCount: number; spoolDifferenceGrams: number | null; spoolsNeedingWeighing: number;
  demandGrams: number; incomingGrams: number; undatedIncomingGrams: number;
  timeline: { date: string; demandGrams: number; incomingGrams: number; balanceGrams: number }[];
  shortageDate: string | null; minimumProjectedGrams: number; suggestedKg: number;
  orderByDate: string | null; expectedDeliveryDate: string | null; vendorId: string | null;
  multipleKg: number; leadDays: number; bufferGrams: number;
  currentSafetyGapGrams: number;
  staleReservationCount: number; staleReservedGrams: number;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): number | null => value != null && typeof value !== "boolean" && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const lineGrams = (lines: FilamentDemand["lines"], itemId: string) => lines?.filter(line => line.item_id === itemId).reduce((sum, line) => sum + line.grams, 0) ?? 0;
function residualDraftDemand(lines: FilamentDemand["lines"], jobs: FilamentJob[]) {
  // A replacement is another attempt at the same frozen plate, not coverage
  // of a second OP slot. Failed attempts provide no usable physical output.
  const replaced = new Set(jobs.map(job => job.reprint_of).filter(Boolean));
  const covered = jobs.filter(job => job.status !== "failed" && !replaced.has(job.id) && (job.status !== "draft" || job.inventory_posted_at)).map(jobFilamentDemand);
  if (lines === null || covered.some(value => value === null)) return null;
  return lines.map(line => ({ ...line, grams: rounded(Math.max(0, line.grams - covered.reduce((sum, value) => sum + lineGrams(value, line.item_id), 0))) }));
}
export function stockQuantityToGrams(quantity: number, unit: string): number {
  if (!Number.isFinite(quantity)) throw new Error("Saldo de filamento inválido.");
  const normalized = unit.trim().toLowerCase();
  if (!["g", "kg"].includes(normalized)) throw new Error("Filamento deve usar g ou kg.");
  return rounded(quantity * (normalized === "kg" ? 1000 : 1));
}
export function validPlanningDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addPlanningDays(date: string, days: number): string {
  if (!validPlanningDate(date) || !Number.isInteger(days)) throw new Error("Data de planejamento inválida.");
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function operatingDemandDate(order: { internal_due_at?: string | null; ship_by_at?: string | null; marketplace_order_id?: string | null; due_date: string | null }, timezone = "America/Sao_Paulo", hasMarketplaceLink = false): string | null {
  const timestamp = order.internal_due_at || order.ship_by_at;
  if (!timestamp) return deliveryPreparationDay(order, hasMarketplaceLink) ?? (validPlanningDate(order.due_date) ? order.due_date : null);
  const date = new Date(timestamp); if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(name => parts.find(part => part.type === name)?.value).join("-");
}

/** Read the frozen per-print requirements. A total cannot be guessed across two colors. */
export function jobFilamentDemand(job: FilamentJob): FilamentDemand["lines"] {
  const snapshot = record(job.production_snapshot);
  const requirements = Array.isArray(snapshot.requirements) ? snapshot.requirements : [];
  const lines = requirements.filter(value => (record(value).plate_id || null) === (job.print_plate_id || null));
  if (lines.length) {
    const result = new Map<string, number>();
    for (const value of lines) {
      const line = record(value); const grams = finite(line.grams_per_print);
      if (typeof line.item_id !== "string" || grams === null) return null;
      result.set(line.item_id, (result.get(line.item_id) ?? 0) + grams);
    }
    return [...result].map(([item_id, grams]) => ({ item_id, grams: rounded(grams) }));
  }
  if (job.secondary_material_id && job.secondary_material_id !== job.material_id) return null;
  const grams = finite(job.est_grams);
  if (grams === 0) return [];
  return job.material_id && grams !== null ? [{ item_id: job.material_id, grams }] : null;
}

/** Unscheduled committed orders use whole print runs, including the last partial plate. */
export function snapshotFilamentDemand(value: unknown, quantity: number, depth = 0): FilamentDemand["lines"] {
  if (depth > 20 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return null;
  const snapshot = record(value); const totals = new Map<string, number>();
  const add = (lines: FilamentDemand["lines"]) => {
    if (lines === null) return false;
    for (const line of lines) totals.set(line.item_id, (totals.get(line.item_id) ?? 0) + line.grams);
    return true;
  };
  if (Array.isArray(snapshot.components) && snapshot.components.length) {
    for (const value of snapshot.components) {
      const component = record(value); const count = finite(component.quantity);
      if (count === null || !add(snapshotFilamentDemand(component.snapshot, quantity * count, depth + 1))) return null;
    }
  } else {
    const plates = Array.isArray(snapshot.plates) && snapshot.plates.length ? snapshot.plates.map(record) : [{ recipe: snapshot.recipe }];
    for (const plate of plates) {
      const recipe = record(plate.recipe); const capacity = finite(recipe.units_per_print);
      if (!capacity || !Number.isInteger(capacity) || !Array.isArray(recipe.lines) || !recipe.lines.length) return null;
      const runs = Math.ceil(quantity / capacity);
      for (const value of recipe.lines) {
        const line = record(value); const grams = finite(line.grams_per_print);
        if (typeof line.item_id !== "string" || grams === null) return null;
        totals.set(line.item_id, (totals.get(line.item_id) ?? 0) + grams * runs);
      }
    }
  }
  return [...totals].map(([item_id, grams]) => ({ item_id, grams: rounded(grams) }));
}

export function calculateFilamentPlan(snapshot: FilamentPlanningSnapshot, today: string) {
  if (!validPlanningDate(today)) throw new Error("Informe a data do planejamento.");
  const activeJobs = snapshot.jobs.filter(job => !job.inventory_posted_at && ["draft", "queued", "printing", "paused", "reprint"].includes(job.status));
  const activeJobIds = new Set(activeJobs.map(job => job.id));
  const reservations = snapshot.reservations.filter(r => r.status === "reserved" && !r.released_at && activeJobIds.has(r.job_id));
  const staleReservations = snapshot.reservations.filter(r => r.status === "reserved" && !r.released_at && !activeJobIds.has(r.job_id));
  const jobDemand = activeJobs.flatMap(job => {
    const held = reservations.filter(r => r.job_id === job.id);
    if (job.status === "draft" && !held.length) return [];
    const recipe = job.status === "draft" ? [] : jobFilamentDemand(job);
    const quantities = new Map((recipe ?? []).map(line => [line.item_id, line.grams]));
    for (const reservation of held) quantities.set(reservation.item_id, Math.max(quantities.get(reservation.item_id) ?? 0, reservation.grams));
    const entries: FilamentDemand[] = [{ id: job.id, label: job.code, due_date: job.due_date, lines: [...quantities].map(([item_id, grams]) => ({ item_id, grams })) }];
    // A reservation is a known hold, not proof that an incomplete recipe is sufficient.
    if (recipe === null) entries.push({ id: `${job.id}:unknown`, label: job.code, due_date: job.due_date, lines: null });
    return entries;
  });
  const committedDemand = snapshot.committedDemand.map(entry => {
    if (!entry.lines || !entry.draft_job_ids?.length) return entry;
    // A draft reservation for this same physical demand covers its residual;
    // it is not an additional print or a second consumption of the same grams.
    const held = jobDemand.filter(job => entry.draft_job_ids!.includes(job.id));
    return { ...entry, lines: entry.lines.map(line => ({ ...line, grams: rounded(Math.max(0, line.grams - held.reduce((sum, job) => sum + lineGrams(job.lines, line.item_id), 0))) })) };
  });
  const demand = [...jobDemand, ...committedDemand];
  let undatedPurchaseCount = 0; let unconvertedPurchaseCount = 0;
  const incoming = snapshot.purchases.filter(p => p.status === "pending");
  for (const purchase of incoming) {
    if (!validPlanningDate(purchase.expected_date)) undatedPurchaseCount++;
    if (purchase.items.some(line => line.inventory_item_id && finite(line.stock_quantity) === null)) unconvertedPurchaseCount++;
  }
  const materials: FilamentPlanMaterial[] = snapshot.items.map(item => {
    const policy = snapshot.policies.find(p => p.item_id === item.id);
    const stockGrams = stockQuantityToGrams(item.current_stock, item.unit);
    const reservedGrams = rounded(reservations.filter(r => r.item_id === item.id).reduce((sum, r) => sum + r.grams, 0));
    const stale = staleReservations.filter(reservation => reservation.item_id === item.id);
    const spools = snapshot.spools.filter(s => s.item_id === item.id && s.is_active);
    const spoolGrams = rounded(spools.reduce((sum, spool) => sum + spool.estimated_remaining_grams, 0));
    const bufferGrams = policy?.buffer_grams ?? stockQuantityToGrams(item.min_stock ?? 0, item.unit);
    const events = new Map<string, { demandGrams: number; incomingGrams: number }>();
    const event = (date: string) => { if (!events.has(date)) events.set(date, { demandGrams: 0, incomingGrams: 0 }); return events.get(date)!; };
    let demandGrams = 0, incomingGrams = 0, undatedIncomingGrams = 0;
    for (const entry of demand) {
      const grams = lineGrams(entry.lines, item.id);
      demandGrams += grams;
      // Missing/overdue demand is immediate; it must not disappear from the projection.
      event(validPlanningDate(entry.due_date) && entry.due_date > today ? entry.due_date : today).demandGrams += grams;
    }
    for (const purchase of incoming) {
      for (const line of purchase.items.filter(line => line.inventory_item_id === item.id)) {
        const quantity = finite(line.stock_quantity); if (quantity === null) continue;
        const grams = stockQuantityToGrams(quantity, item.unit);
        // An overdue ETA does not prove that physical stock has arrived.
        if (!validPlanningDate(purchase.expected_date) || purchase.expected_date < today) { undatedIncomingGrams += grams; continue; }
        incomingGrams += grams; event(purchase.expected_date).incomingGrams += grams;
      }
    }
    const currentSafetyGapGrams = Math.max(0, rounded(bufferGrams - stockGrams));
    // Today's ETA is still expected stock. Consider it before today's demand
    // for net purchasing, while retaining the physical safety gap separately.
    const incomingToday = events.get(today)?.incomingGrams ?? 0;
    let balance = stockGrams; let minimum = incomingToday > 0 ? Infinity : stockGrams;
    let shortageDate: string | null = currentSafetyGapGrams > 0 && incomingToday === 0 ? today : null;
    const timeline = [...events].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => {
      // Reservations are part of job demand, never another deduction from the projection.
      balance = rounded(balance + row.incomingGrams - row.demandGrams); minimum = Math.min(minimum, balance);
      if (balance < bufferGrams && !shortageDate) shortageDate = date;
      return { date, demandGrams: rounded(row.demandGrams), incomingGrams: rounded(row.incomingGrams), balanceGrams: balance };
    });
    if (!Number.isFinite(minimum)) minimum = stockGrams;
    const multipleKg = policy?.multiple_kg ?? 1, leadDays = policy?.lead_days ?? 7;
    const shortage = Math.max(0, bufferGrams - minimum);
    const suggestedKg = shortage > 0 ? rounded(Math.ceil((shortage / 1000) / multipleKg - 1e-10) * multipleKg) : 0;
    return { item, stockGrams, reservedGrams, freeGrams: rounded(stockGrams - reservedGrams), spoolGrams, spoolCount: spools.length,
      spoolDifferenceGrams: spools.length ? rounded(spoolGrams - stockGrams) : null,
      spoolsNeedingWeighing: spools.filter(s => s.needs_weighing).length, demandGrams: rounded(demandGrams), incomingGrams: rounded(incomingGrams), undatedIncomingGrams: rounded(undatedIncomingGrams), timeline,
      shortageDate, minimumProjectedGrams: minimum, suggestedKg, orderByDate: shortageDate ? addPlanningDays(shortageDate, -leadDays) : null,
      expectedDeliveryDate: shortageDate, vendorId: policy?.vendor_id ?? item.vendor_id, multipleKg, leadDays, bufferGrams, currentSafetyGapGrams,
      staleReservationCount: stale.length, staleReservedGrams: rounded(stale.reduce((sum, reservation) => sum + reservation.grams, 0)) };
  });
  return { materials, unknownDemandCount: demand.filter(d => d.lines === null).length,
    undatedDemandCount: demand.filter(d => !validPlanningDate(d.due_date)).length,
    undatedPurchaseCount, unconvertedPurchaseCount, staleReservationCount: staleReservations.length, calculatedAt: today };
}

export function filamentPurchaseHref(material: FilamentPlanMaterial) {
  const params = new URLSearchParams({ reposicao_item: material.item.id, reposicao_kg: String(material.suggestedKg) });
  if (material.vendorId) params.set("reposicao_fornecedor", material.vendorId);
  if (material.expectedDeliveryDate) params.set("reposicao_entrega", material.expectedDeliveryDate);
  return `/estoque/compras?${params}`;
}

export interface FilamentPurchaseSuggestionItem { item_id: string; kg: number }
function validatePurchaseSuggestionItems(value: unknown): FilamentPurchaseSuggestionItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new Error("A sugestão deve conter entre 1 e 500 materiais.");
  const seen = new Set<string>();
  return value.map(entry => {
    const item = record(entry);
    if (Object.keys(item).length !== 2 || typeof item.item_id !== "string" || !item.item_id.trim() || item.item_id.length > 128
      || typeof item.kg !== "number" || !Number.isFinite(item.kg) || item.kg < 0.001 || item.kg > 100000
      || Math.abs(item.kg * 1000 - Math.round(item.kg * 1000)) > 0.0000001) {
      throw new Error("Revise os materiais e as quantidades da sugestão: use identificador e peso positivo em kg.");
    }
    if (seen.has(item.item_id)) throw new Error("A sugestão repete um material. Revise as quantidades antes de abrir a compra.");
    seen.add(item.item_id);
    return { item_id: item.item_id, kg: item.kg };
  });
}

/** Links only prepare review; the regular purchase transaction remains the writer. */
export function filamentSupplierPurchaseHref(materials: FilamentPlanMaterial[]) {
  const items = validatePurchaseSuggestionItems(materials.map(material => ({ item_id: material.item.id, kg: material.suggestedKg })));
  const vendorId = materials[0].vendorId;
  if (materials.some(material => material.vendorId !== vendorId)) throw new Error("Consolide apenas materiais do mesmo fornecedor.");
  const params = new URLSearchParams({ reposicao_itens: JSON.stringify(items) });
  if (vendorId) params.set("reposicao_fornecedor", vendorId);
  const firstNeeded = materials.map(material => material.expectedDeliveryDate).filter(validPlanningDate).sort()[0];
  if (firstNeeded) params.set("reposicao_entrega", firstNeeded);
  return `/estoque/compras?${params}`;
}

/** Reject the entire request on any malformed line; never open a partial color order. */
export function parseFilamentPurchaseSuggestion(params: URLSearchParams): FilamentPurchaseSuggestionItem[] | null {
  const fields = ["reposicao_itens", "reposicao_item", "reposicao_kg", "reposicao_fornecedor", "reposicao_entrega"];
  if (!params.has("reposicao_itens") && !params.has("reposicao_item") && !params.has("reposicao_kg")) return null;
  if (fields.some(field => params.getAll(field).length > 1)) throw new Error("A sugestão contém parâmetros repetidos. Abra novamente pela reposição.");
  const list = params.get("reposicao_itens");
  if (list !== null) {
    if (params.has("reposicao_item") || params.has("reposicao_kg") || list.length > 128000) throw new Error("A sugestão contém dados conflitantes ou excede o limite.");
    let value: unknown;
    try { value = JSON.parse(list); } catch { throw new Error("Os materiais da sugestão não estão em um formato válido."); }
    return validatePurchaseSuggestionItems(value);
  }
  const kg = params.get("reposicao_kg") ?? "";
  if (!/^\d+(?:\.\d+)?$/.test(kg)) throw new Error("A quantidade sugerida deve ser um peso válido em kg.");
  return validatePurchaseSuggestionItems([{ item_id: params.get("reposicao_item"), kg: Number(kg) }]);
}

/** Every table is paginated. Read failures remain failures, never a reassuring zero. */
export async function loadFilamentPlanningSnapshot(client: SupabaseClient): Promise<FilamentPlanningSnapshot> {
  const read = async <T,>(table: string, columns: string, orderKey = "id") => readProductionRows<T>(async (from, to) => {
    const result = await client.from(table).select(columns).order(orderKey).range(from, to) as unknown as { data: T[] | null; error: { message: string; code?: string } | null };
    // Keep PostgreSQL/PostgREST error codes for the activation-state UI.
    if (result.error) throw Object.assign(new Error(result.error.message), result.error);
    return result;
  });
  type Order = { id: string; code: string; status: string; due_date: string | null; marketplace_order_id?: string | null; source_order_id?: string | null; source_quote_id?: string | null; ship_by_at?: string | null; internal_due_at?: string | null };
  type DemandItem = { id: string; order_id?: string; production_order_id?: string; quantity: number; product_snapshot?: unknown; commercial_snapshot?: unknown; production_snapshot?: unknown; description: string };
  const marketplaceLinks = async () => {
    try { return await read<{ internal_order_id: string | null }>("marketplace_orders", "id,internal_order_id"); }
    catch (error) { if (isMissingDatabaseStructure(error)) return []; throw error; }
  };
  const [items, jobs, purchases, purchaseItems, reservations, spools, policies, vendors, printers, orders, orderItems, productionOrders, productionItems, tenants, links] = await Promise.all([
    read<FilamentMaterial & { category: string; is_active: boolean }>("inventory_items", "id,name,unit,current_stock,min_stock,vendor_id,material_code,color,color_code,avg_cost,category,is_active"),
    read<FilamentJob>("jobs", "id,code,name,status,due_date,est_grams,material_id,secondary_material_id,print_plate_id,production_snapshot,started_at,inventory_posted_at,order_id,order_item_id,production_order_id,production_order_item_id,reprint_of"),
    read<Omit<FilamentPurchase, "items">>("purchase_orders", "id,code,status,expected_date"),
    read<FilamentPurchase["items"][number] & { purchase_order_id: string }>("purchase_order_items", "id,purchase_order_id,inventory_item_id,stock_quantity"),
    read<FilamentReservation>("filament_reservations", "id,job_id,item_id,spool_id,grams,status,released_at"),
    read<FilamentSpool>("filament_spools", "*"), read<FilamentPolicy>("filament_replenishment_policies", "*", "item_id"),
    read<{ id: string; name: string }>("vendors", "id,name"), read<{ id: string; name: string }>("printers", "id,name"),
    read<Order>("orders", "*"), read<DemandItem>("order_items", "id,order_id,quantity,product_snapshot,description"),
    read<Order>("production_orders", "id,code,status,due_date,source_order_id,source_quote_id"),
    read<DemandItem>("production_order_items", "id,production_order_id,quantity,production_snapshot,commercial_snapshot,description"),
    read<{ id: string; timezone: string }>("tenants", "id,timezone"), marketplaceLinks(),
  ]);
  const timezone = tenants[0]?.timezone || "America/Sao_Paulo";
  const linkedSales = new Set(links.map(link => link.internal_order_id));
  const saleDemandDate = (order: Order) => operatingDemandDate(order, timezone, linkedSales.has(order.id));
  const cancelled = new Set(orders.filter(o => o.status === "cancelled").map(o => o.id));
  const cancelledQuotes = new Set(orders.filter(o => o.status === "cancelled" && o.source_quote_id).map(o => o.source_quote_id));
  const effectiveProductionOrders = productionOrders.map(order => cancelledQuotes.has(order.source_quote_id) ? { ...order, status: "cancelled" } : order);
  const liveJobs = excludeUnstartedCancelledJobs(jobs, orders, effectiveProductionOrders).map(job => {
    const production = productionOrders.find(p => p.id === job.production_order_id);
    const order = orders.find(o => o.id === (job.order_id ?? production?.source_order_id) || (production?.source_quote_id && o.source_quote_id === production.source_quote_id));
    const operationalDate = order ? saleDemandDate(order) : null;
    return { ...job, due_date: operationalDate && (!validPlanningDate(job.due_date) || operationalDate < job.due_date) ? operationalDate : job.due_date };
  });
  const committedDemand: FilamentDemand[] = [];
  for (const order of effectiveProductionOrders.filter(o => ["preparing", "released"].includes(o.status) && !cancelled.has(o.source_order_id ?? ""))) {
    for (const item of productionItems.filter(i => i.production_order_id === order.id)) {
      const linked = liveJobs.filter(j => j.production_order_item_id === item.id);
      const drafts = linked.filter(j => j.status === "draft" && !j.inventory_posted_at);
      // Active/physical prints keep their existing plan. A returned draft does
      // not make the remaining committed OP disappear from purchasing.
      if (linked.length && !drafts.length) continue;
      const sale = orders.find(o => o.id === order.source_order_id || (order.source_quote_id && o.source_quote_id === order.source_quote_id));
      const lines = residualDraftDemand(snapshotFilamentDemand(item.production_snapshot ?? item.commercial_snapshot, item.quantity), linked);
      committedDemand.push({ id: item.id, label: `${order.code} · ${item.description}`, due_date: sale ? saleDemandDate(sale) ?? order.due_date : order.due_date, lines, draft_job_ids: drafts.map(j => j.id) });
    }
  }
  for (const order of orders.filter(o => ["approved", "in_production"].includes(o.status))) {
    if (productionOrders.some(p => p.source_order_id === order.id || (order.source_quote_id && p.source_quote_id === order.source_quote_id))) continue;
    const saleJobs = liveJobs.filter(j => j.order_id === order.id);
    for (const item of orderItems.filter(i => i.order_id === order.id)) {
      const linked = saleJobs.filter(j => j.order_item_id === item.id);
      const drafts = linked.filter(j => j.status === "draft" && !j.inventory_posted_at);
      if (linked.length && !drafts.length) continue;
      // Legacy jobs without a line identity cannot prove how much of this line they cover.
      const unidentified = saleJobs.some(j => !j.order_item_id);
      const lines = unidentified ? null : residualDraftDemand(snapshotFilamentDemand(item.product_snapshot, item.quantity), linked);
      committedDemand.push({ id: item.id, label: `${order.code} · ${item.description}`, due_date: saleDemandDate(order), lines, draft_job_ids: drafts.map(j => j.id) });
    }
  }
  return { items: items.filter(i => i.category === "filament" && i.is_active && ["g", "kg"].includes(i.unit.trim().toLowerCase())), jobs: liveJobs,
    purchases: purchases.map(p => ({ ...p, items: purchaseItems.filter(i => i.purchase_order_id === p.id) })), reservations, spools, policies, committedDemand, vendors, printers };
}
