/** A deterministic estimate, not a reservation or a command to a printer. */
export interface OperationalOrder {
  id: string;
  deadlineAt?: string | null;
  internalDeadlineAt?: string | null;
  finishingMinutes?: number | null;
  assemblyMinutes?: number | null;
  packagingMinutes?: number | null;
  /** Required to confirm that every plate/component job is represented. */
  expectedJobIds?: readonly string[];
}

export interface OperationalJob {
  id: string;
  orderId?: string | null;
  machineId?: string | null;
  status: string;
  durationMinutes?: number | null;
  remainingMinutes?: number | null;
  setupMinutes?: number | null;
  clearanceMinutes?: number | null;
  readyAt?: string | null;
  deadlineAt?: string | null;
  internalDeadlineAt?: string | null;
  priority?: number;
  createdAt?: string;
  /** null/undefined means compatibility has not been verified; [] means no match. */
  compatibleMachineIds?: readonly string[] | null;
}

export interface OperationalMachine {
  id: string;
  /** available means the bed/setup is explicitly ready, not merely online. */
  state: "available" | "busy" | "maintenance" | "offline" | "unknown";
  availableAt?: string | null;
}

export interface OperatorWindow { startAt: string; endAt: string }
export interface PlannedJob {
  id: string;
  orderId: string | null;
  machineId: string | null;
  startAt: string | null;
  printEndsAt: string | null;
  readyAt: string | null;
  issues: string[];
}
export interface PlannedOrder {
  id: string;
  printsReadyAt: string | null;
  readyAt: string | null;
  deadlineAt: string | null;
  slackMinutes: number | null;
  status: "unknown" | "blocked" | "late" | "at_risk" | "estimated_on_time";
  issues: string[];
}
export interface OperationalPlanInput {
  now: string;
  orders: readonly OperationalOrder[];
  jobs: readonly OperationalJob[];
  machines: readonly OperationalMachine[];
  /** One shared operator resource. null means its calendar is unknown. */
  operatorWindows: readonly OperatorWindow[] | null;
  /** A warning threshold, not additional production capacity or time. */
  riskBufferMinutes?: number;
}

const minute = 60_000;
const knownMinutes = (value: number | null | undefined, allowZero = true): value is number =>
  typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A DATE is useful for sorting, but is not an expediting cutoff time. */
function timestamp(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !validDay(value.slice(0, 10))) return null;
  const number = Date.parse(value);
  return Number.isFinite(number) ? number : null;
}
const sortableDeadline = (value: string | null | undefined) => timestamp(value) ?? (value && validDay(value) ? Date.parse(`${value}T00:00:00Z`) : null);
const iso = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const unique = (values: string[]) => [...new Set(values)];

/** Sorts by latest start (deadline less known print time), then deadline and priority. */
export function compareOperationalJobs(a: OperationalJob, b: OperationalJob, _now?: string): number {
  const key = (job: OperationalJob) => {
    const deadline = sortableDeadline(job.internalDeadlineAt) ?? sortableDeadline(job.deadlineAt);
    const duration = job.status === "printing" ? job.remainingMinutes : job.durationMinutes;
    return { deadline: deadline ?? Infinity, latestStart: deadline == null ? Infinity : deadline - (knownMinutes(duration) ? duration * minute : 0) };
  };
  const left = key(a), right = key(b);
  if (left.latestStart !== right.latestStart) return left.latestStart < right.latestStart ? -1 : 1;
  if (left.deadline !== right.deadline) return left.deadline < right.deadline ? -1 : 1;
  return (a.priority ?? 5) - (b.priority ?? 5) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}

/** A date-only deadline can show overdue/today, but cannot promise spare capacity. */
export function operationalJobTiming(job: OperationalJob, today: string) {
  const deadline = job.internalDeadlineAt ?? job.deadlineAt;
  const deadlineDay = deadline?.slice(0, 10);
  const deadlineKnown = !!deadlineDay && validDay(deadlineDay);
  const duration = job.status === "printing" ? job.remainingMinutes : job.durationMinutes;
  return {
    deadlineKnown,
    deadlineDay: deadlineKnown ? deadlineDay : null,
    durationMinutes: knownMinutes(duration, false) ? duration : null,
    overdue: deadlineKnown && validDay(today) && deadlineDay < today,
    dueToday: deadlineKnown && deadlineDay === today,
  };
}

const issueLabels: Record<string, string> = {
  deadline_time_unknown: "Informe o horário limite de postagem e o fuso.",
  internal_deadline_time_unknown: "Confira o horário do prazo interno.",
  job_manifest_unknown: "Confirme todas as placas e peças necessárias ao pedido.",
  job_manifest_incomplete: "Vincule as placas e peças que faltam neste pedido.",
  job_missing: "Vincule a ordem de impressão que falta.",
  print_time_unknown: "Informe o tempo previsto da placa.",
  remaining_time_unknown: "Confira o tempo restante da impressão.",
  setup_time_unknown: "Informe o tempo de preparação da impressora.",
  clearance_time_unknown: "Informe o tempo para retirada e liberação da mesa.",
  final_operations_time_unknown: "Informe os tempos de acabamento, montagem e embalagem.",
  operator_calendar_unknown: "Configure os horários de atendimento da farm.",
  operator_unavailable: "Amplie os turnos ou reveja as operações que aguardam atendimento.",
  compatibility_unknown: "Confirme a compatibilidade da placa com a impressora.",
  no_compatible_machine: "Escolha uma impressora compatível com a placa.",
  machine_unknown: "Atribua uma impressora cadastrada à placa.",
  machine_availability_unknown: "Confirme mesa livre e disponibilidade da impressora.",
  machine_unavailable: "Retire o bloqueio ou atribua outra impressora disponível.",
  machine_queue_unresolved: "Resolva a impressão que bloqueia esta máquina.",
  unassigned_queue_unresolved: "Resolva as ordens sem máquina antes de confirmar a capacidade.",
  unallocated_manual_work: "Confira as etapas manuais das ordens que estão fora dos pedidos representados.",
  operator_queue_unresolved: "Confira os tempos e a liberação das ordens que disputam atendimento.",
  job_paused: "Confira e retome a impressão pausada.",
  job_failed: "Apure a falha e planeje somente as peças que faltam.",
  job_not_queued: "Confirme se a ordem deve entrar na fila.",
  printed_output_readiness_unknown: "Confira as peças e libere a saída da impressão.",
  job_readiness_unknown: "Confira quando esta placa estará liberada para iniciar.",
  jobs_not_forecastable: "Resolva as pendências das placas para calcular a conclusão.",
  duplicate_identity: "Atualize os dados: há ordens ou impressoras duplicadas na consulta.",
};

export const operationalIssueLabel = (issue: string): string => issueLabels[issue] ?? "Confira os dados de planejamento.";

type Interval = { start: number; end: number };
function calendarWindows(windows: readonly OperatorWindow[] | null): Interval[] | null {
  if (windows == null) return null;
  const intervals: Interval[] = [];
  for (const window of windows) {
    const start = timestamp(window.startAt), end = timestamp(window.endAt);
    if (start == null || end == null || end <= start) return null;
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function freeWindows(windows: Interval[], bookings: Interval[]): Interval[] {
  let free = windows.map(window => ({ ...window }));
  for (const booking of bookings) {
    free = free.flatMap(window => {
      if (booking.end <= window.start || booking.start >= window.end) return [window];
      const parts: Interval[] = [];
      if (booking.start > window.start) parts.push({ start: window.start, end: booking.start });
      if (booking.end < window.end) parts.push({ start: booking.end, end: window.end });
      return parts;
    });
  }
  return free;
}

function attendedTask(earliest: number, minutes: number, windows: Interval[], bookings: Interval[], split: boolean) {
  let remaining = minutes * minute;
  const used: Interval[] = [];
  for (const window of freeWindows(windows, bookings)) {
    const start = Math.max(earliest, window.start);
    // An action at the end of a shift requires the next staffed window.
    if (start >= window.end) continue;
    if (!split && remaining > window.end - start) continue;
    const work = Math.min(remaining, window.end - start);
    if (work > 0) used.push({ start, end: start + work });
    remaining -= work;
    if (remaining <= 0) return { start: used[0]?.start ?? start, end: start + work, bookings: used };
  }
  return null;
}

const finished = new Set(["ready", "completed", "shipped"]);
const printed = new Set(["post_processing", "quality_check"]);
const printable = new Set(["queued", "reprint", "printing"]);
const blockingIssues = new Set(["machine_unavailable", "no_compatible_machine", "operator_unavailable", "job_paused", "job_failed", "job_not_queued", "machine_queue_unresolved"]);

export function planOperations(input: OperationalPlanInput): { jobs: PlannedJob[]; orders: PlannedOrder[] } {
  const now = timestamp(input.now);
  if (now == null) throw new Error("Informe o instante de planejamento com horário e fuso.");
  if ([input.jobs, input.orders, input.machines].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)) {
    return {
      jobs: input.jobs.map(job => ({ id: job.id, orderId: job.orderId ?? null, machineId: job.machineId ?? null, startAt: null, printEndsAt: null, readyAt: null, issues: ["duplicate_identity"] })),
      orders: input.orders.map(order => ({ id: order.id, printsReadyAt: null, readyAt: null, deadlineAt: order.deadlineAt ?? null, slackMinutes: null, status: "unknown", issues: ["duplicate_identity"] })),
    };
  }
  const windows = calendarWindows(input.operatorWindows);
  const machines = [...input.machines].sort((a, b) => a.id.localeCompare(b.id));
  const machineReady = new Map<string, number>();
  const machineBlocked = new Set<string>();
  const bookings: Interval[] = [];
  const byOrder = new Map(input.orders.map(order => [order.id, order]));
  const byId = new Map<string, PlannedJob>();
  const runningCount = new Map<string, number>();
  for (const job of input.jobs) if (job.status === "printing" && job.machineId) runningCount.set(job.machineId, (runningCount.get(job.machineId) ?? 0) + 1);
  for (const machine of machines) {
    const available = timestamp(machine.availableAt);
    if (machine.availableAt != null && available == null) continue;
    if (machine.state === "available") machineReady.set(machine.id, Math.max(now, available ?? now));
    else if (machine.state === "busy" && (available != null || runningCount.get(machine.id) === 1)) machineReady.set(machine.id, Math.max(now, available ?? now));
  }
  for (const job of input.jobs) if (job.status === "paused" && job.machineId) machineBlocked.add(job.machineId);
  const orderedJobs = [...input.jobs].sort((a, b) => {
    if ((a.status === "printing") !== (b.status === "printing")) return a.status === "printing" ? -1 : 1;
    const withOrder = (job: OperationalJob) => {
      const order = job.orderId ? byOrder.get(job.orderId) : undefined;
      const manual = [order?.finishingMinutes, order?.assemblyMinutes, order?.packagingMinutes];
      const finalDeadline = timestamp(order?.deadlineAt ?? job.deadlineAt);
      const internal = order?.internalDeadlineAt ?? job.internalDeadlineAt;
      return { ...job, deadlineAt: order?.deadlineAt ?? job.deadlineAt, internalDeadlineAt: internal ?? (finalDeadline != null && manual.every(value => knownMinutes(value)) ? iso(finalDeadline - manual.reduce((sum, value) => sum + value!, 0) * minute) : null) };
    };
    return compareOperationalJobs(withOrder(a), withOrder(b));
  });

  for (const job of orderedJobs) {
    const result: PlannedJob = { id: job.id, orderId: job.orderId ?? null, machineId: job.machineId ?? null, startAt: null, printEndsAt: null, readyAt: null, issues: [] };
    byId.set(job.id, result);
    if (finished.has(job.status) || printed.has(job.status)) {
      const ready = timestamp(job.readyAt);
      if (finished.has(job.status)) result.readyAt = iso(ready ?? now);
      else if (ready != null) result.readyAt = iso(Math.max(now, ready));
      else result.issues.push("printed_output_readiness_unknown");
      result.printEndsAt = result.readyAt;
      continue;
    }
    if (!printable.has(job.status)) result.issues.push(job.status === "paused" ? "job_paused" : job.status === "failed" ? "job_failed" : "job_not_queued");
    const duration = job.status === "printing" ? job.remainingMinutes : job.durationMinutes;
    if (!knownMinutes(duration, job.status === "printing")) result.issues.push(job.status === "printing" ? "remaining_time_unknown" : "print_time_unknown");
    if (!knownMinutes(job.clearanceMinutes)) result.issues.push("clearance_time_unknown");
    if (job.status !== "printing" && !knownMinutes(job.setupMinutes)) result.issues.push("setup_time_unknown");
    if (windows == null) result.issues.push("operator_calendar_unknown");
    if (job.compatibleMachineIds == null) result.issues.push("compatibility_unknown");
    if (job.status === "printing" && !job.machineId) result.issues.push("machine_unknown");
    if (job.readyAt != null && timestamp(job.readyAt) == null) result.issues.push("job_readiness_unknown");
    if (job.machineId && (runningCount.get(job.machineId) ?? 0) > 1) result.issues.push("machine_queue_unresolved");
    const candidates = machines.filter(machine => job.machineId ? machine.id === job.machineId : job.compatibleMachineIds?.includes(machine.id));
    if (!candidates.length) result.issues.push(job.machineId || job.compatibleMachineIds == null ? "machine_unknown" : "no_compatible_machine");
    if (candidates.length && candidates.every(machine => ["maintenance", "offline"].includes(machine.state))) result.issues.push("machine_unavailable");
    const eligible = candidates.filter(machine => machineReady.has(machine.id) && !machineBlocked.has(machine.id) && (job.compatibleMachineIds == null || job.compatibleMachineIds.includes(machine.id)));
    if (candidates.length && !eligible.length && !result.issues.includes("machine_unavailable")) {
      result.issues.push(candidates.some(machine => machineBlocked.has(machine.id)) ? "machine_queue_unresolved" : job.compatibleMachineIds != null && candidates.every(machine => !job.compatibleMachineIds!.includes(machine.id)) ? "no_compatible_machine" : "machine_availability_unknown");
    }
    const hardUnknown = result.issues.some(issue => issue !== "compatibility_unknown");
    if (hardUnknown) {
      if (job.machineId) machineBlocked.add(job.machineId);
      continue;
    }
    const options = eligible.map(machine => {
      const earliest = Math.max(now, machineReady.get(machine.id)!, timestamp(job.readyAt) ?? now);
      const setup = job.status === "printing" ? { start: now, end: now, bookings: [] as Interval[] } : attendedTask(earliest, job.setupMinutes!, windows!, bookings, false);
      if (!setup) return null;
      const printEnd = setup.end + duration! * minute;
      const clearance = attendedTask(printEnd, job.clearanceMinutes!, windows!, [...bookings, ...setup.bookings], false);
      if (!clearance) return null;
      return { machine, setup, printEnd, clearance };
    }).filter(option => option != null).sort((a, b) => a!.clearance.end - b!.clearance.end || a!.machine.id.localeCompare(b!.machine.id));
    const selected = options[0];
    if (!selected) {
      result.issues.push("operator_unavailable");
      if (job.machineId) machineBlocked.add(job.machineId);
      continue;
    }
    result.machineId = selected.machine.id;
    result.startAt = iso(selected.setup.end);
    result.printEndsAt = iso(selected.printEnd);
    result.readyAt = iso(selected.clearance.end);
    machineReady.set(selected.machine.id, selected.clearance.end);
    bookings.push(...selected.setup.bookings, ...selected.clearance.bookings);
  }

  const orderedOrders = [...input.orders].sort((a, b) => (sortableDeadline(a.deadlineAt) ?? Infinity) - (sortableDeadline(b.deadlineAt) ?? Infinity) || a.id.localeCompare(b.id));
  const unresolvedUnassigned = input.jobs.some(job => !job.machineId && !finished.has(job.status) && !printed.has(job.status) && !byId.get(job.id)?.readyAt);
  const unallocatedManualWork = input.jobs.some(job => printed.has(job.status) && (!job.orderId || !byOrder.has(job.orderId)));
  const unresolvedOperatorWork = input.jobs.some(job => {
    const output = byId.get(job.id)!;
    return (printable.has(job.status) || printed.has(job.status)) && !output.readyAt && !output.issues.some(issue => blockingIssues.has(issue));
  });
  const forecasts = orderedOrders.map(order => {
    const issues: string[] = [];
    if (unresolvedUnassigned) issues.push("unassigned_queue_unresolved");
    if (unallocatedManualWork) issues.push("unallocated_manual_work");
    if (unresolvedOperatorWork) issues.push("operator_queue_unresolved");
    const deadline = timestamp(order.deadlineAt);
    if (deadline == null) issues.push("deadline_time_unknown");
    if (order.internalDeadlineAt != null && timestamp(order.internalDeadlineAt) == null) issues.push("internal_deadline_time_unknown");
    const listed = input.jobs.filter(job => job.orderId === order.id).map(job => job.id);
    const manifest = order.expectedJobIds;
    if (!manifest) issues.push("job_manifest_unknown");
    if (manifest && (new Set(manifest).size !== manifest.length || manifest.some(id => !listed.includes(id)) || listed.some(id => !manifest.includes(id)))) issues.push("job_manifest_incomplete");
    const required = manifest ?? listed;
    const outputs = required.map(id => byId.get(id));
    for (const output of outputs) issues.push(...(output?.issues ?? ["job_missing"]));
    const printReady = outputs.every(output => output?.readyAt) ? Math.max(now, ...outputs.map(output => timestamp(output!.readyAt)!)) : null;
    if (printReady == null) issues.push("jobs_not_forecastable");
    const manual = [order.finishingMinutes, order.assemblyMinutes, order.packagingMinutes];
    if (!manual.every(value => knownMinutes(value))) issues.push("final_operations_time_unknown");
    if (windows == null) issues.push("operator_calendar_unknown");
    let ready: number | null = null;
    if (printReady != null && manual.every(value => knownMinutes(value)) && windows != null) {
      const duration = manual.reduce((sum, value) => sum + value!, 0);
      // Explicitly zero remaining work needs no staffed operation.
      const task = duration === 0 ? { end: printReady, bookings: [] as Interval[] } : attendedTask(printReady, duration, windows, bookings, true);
      if (task) { ready = task.end; bookings.push(...task.bookings); }
      else issues.push("operator_unavailable");
    }
    const slackMinutes = deadline != null && ready != null ? (deadline - ready) / minute : null;
    const internal = timestamp(order.internalDeadlineAt);
    const internalLate = internal != null && printReady != null && printReady > internal;
    const buffer = knownMinutes(input.riskBufferMinutes) ? input.riskBufferMinutes : 60;
    const distinct = unique(issues);
    const status: PlannedOrder["status"] = distinct.some(issue => blockingIssues.has(issue)) ? "blocked" : distinct.length || slackMinutes == null ? "unknown" : slackMinutes < 0 ? "late" : internalLate || slackMinutes <= buffer ? "at_risk" : "estimated_on_time";
    return { id: order.id, printsReadyAt: iso(printReady), readyAt: iso(ready), deadlineAt: order.deadlineAt ?? null, slackMinutes, status, issues: distinct };
  });
  return { jobs: input.jobs.map(job => byId.get(job.id)!), orders: forecasts };
}
