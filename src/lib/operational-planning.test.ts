import { describe, expect, it } from "vitest";
import { compareOperationalJobs, operationalJobTiming, planOperations, type OperationalJob, type OperationalPlanInput } from "./operational-planning";

const now = "2026-10-10T08:00:00Z";
const job = (id = "base", overrides: Partial<OperationalJob> = {}): OperationalJob => ({
  id, orderId: "pedido", machineId: "p1", status: "queued", durationMinutes: 60,
  setupMinutes: 0, clearanceMinutes: 0, compatibleMachineIds: ["p1", "p2"], ...overrides,
});
const input = (overrides: Partial<OperationalPlanInput> = {}): OperationalPlanInput => ({
  now,
  orders: [{ id: "pedido", deadlineAt: "2026-10-10T17:00:00Z", expectedJobIds: ["base"], finishingMinutes: 10, assemblyMinutes: 10, packagingMinutes: 10 }],
  jobs: [job()],
  machines: [{ id: "p1", state: "available" }, { id: "p2", state: "available" }],
  operatorWindows: [{ startAt: now, endAt: "2026-10-10T17:00:00Z" }],
  ...overrides,
});

describe("planejamento operacional por pedido", () => {
  it("conclui todas as placas paralelas antes de acabamento, montagem e embalagem", () => {
    const plan = input({ jobs: [job(), job("tampa", { machineId: "p2", durationMinutes: 120 })] });
    plan.orders = [{ ...plan.orders[0], expectedJobIds: ["base", "tampa"] }];
    const result = planOperations(plan);
    expect(result.jobs.map(row => row.printEndsAt)).toEqual(["2026-10-10T09:00:00.000Z", "2026-10-10T10:00:00.000Z"]);
    expect(result.orders[0]).toMatchObject({ printsReadyAt: "2026-10-10T10:00:00.000Z", readyAt: "2026-10-10T10:30:00.000Z", status: "estimated_on_time" });
  });

  it("não sobrepõe duas placas na mesma máquina e inclui preparação e retirada", () => {
    const plan = input({ jobs: [job("base", { setupMinutes: 10, clearanceMinutes: 10 }), job("tampa", { setupMinutes: 10, clearanceMinutes: 10 })] });
    plan.orders = [{ ...plan.orders[0], expectedJobIds: ["base", "tampa"] }];
    const result = planOperations(plan);
    expect(result.jobs[1].startAt).toBe("2026-10-10T09:30:00.000Z");
    expect(result.orders[0].readyAt).toBe("2026-10-10T11:10:00.000Z");
  });

  it("imprime fora do turno, mas a máquina continua ocupada até a retirada atendida", () => {
    const plan = input({
      now: "2026-10-10T16:40:00Z",
      jobs: [job("base", { durationMinutes: 120, clearanceMinutes: 5 }), job("tampa", { durationMinutes: 30 })],
      operatorWindows: [{ startAt: now, endAt: "2026-10-10T17:00:00Z" }, { startAt: "2026-10-11T08:00:00Z", endAt: "2026-10-11T17:00:00Z" }],
    });
    plan.orders = [{ ...plan.orders[0], deadlineAt: "2026-10-11T17:00:00Z", expectedJobIds: ["base", "tampa"] }];
    const result = planOperations(plan);
    expect(result.jobs[0]).toMatchObject({ printEndsAt: "2026-10-10T18:40:00.000Z", readyAt: "2026-10-11T08:05:00.000Z" });
    expect(result.jobs[1].startAt).toBe("2026-10-11T08:05:00.000Z");
  });

  it("divide trabalho final pelos turnos sem trabalhar durante a noite", () => {
    const plan = input({ jobs: [job("base", { status: "completed" })], operatorWindows: [
      { startAt: now, endAt: "2026-10-10T09:00:00Z" },
      { startAt: "2026-10-11T08:00:00Z", endAt: "2026-10-11T09:00:00Z" },
    ] });
    plan.orders = [{ ...plan.orders[0], deadlineAt: "2026-10-11T17:00:00Z", finishingMinutes: 90, assemblyMinutes: 0, packagingMinutes: 0 }];
    expect(planOperations(plan).orders[0].readyAt).toBe("2026-10-11T08:30:00.000Z");
  });

  it("reserva um único operador para setups de máquinas paralelas", () => {
    const plan = input({ jobs: [job("base", { setupMinutes: 10 }), job("tampa", { machineId: "p2", setupMinutes: 10 })] });
    plan.orders = [{ ...plan.orders[0], expectedJobIds: ["base", "tampa"] }];
    expect(planOperations(plan).jobs.map(row => row.startAt)).toEqual(["2026-10-10T08:10:00.000Z", "2026-10-10T08:20:00.000Z"]);
  });

  it("não multiplica capacidade por janelas de operador sobrepostas", () => {
    const order = input().orders[0];
    const result = planOperations(input({
      orders: [{ ...order, expectedJobIds: ["base"], finishingMinutes: 60, assemblyMinutes: 0, packagingMinutes: 0 }, { ...order, id: "segundo", expectedJobIds: ["tampa"], finishingMinutes: 60, assemblyMinutes: 0, packagingMinutes: 0 }],
      jobs: [job("base", { status: "completed" }), job("tampa", { orderId: "segundo", status: "completed" })],
      operatorWindows: [{ startAt: now, endAt: "2026-10-10T09:00:00Z" }, { startAt: now, endAt: "2026-10-10T09:00:00Z" }],
    }));
    expect(result.orders[0].readyAt).toBe("2026-10-10T09:00:00.000Z");
    expect(result.orders[1]).toMatchObject({ readyAt: null, status: "blocked", issues: ["operator_unavailable"] });
  });

  it.each(["maintenance", "offline"] as const)("exclui impressora %s da capacidade", state => {
    const result = planOperations(input({ machines: [{ id: "p1", state }] }));
    expect(result.jobs[0].startAt).toBeNull();
    expect(result.orders[0].status).toBe("blocked");
    expect(result.jobs[0].issues).toContain("machine_unavailable");
  });

  it("não usa máquina busy sem instante conhecido de liberação", () => {
    const result = planOperations(input({ machines: [{ id: "p1", state: "busy" }] }));
    expect(result.jobs[0].issues).toContain("machine_availability_unknown");
    expect(result.orders[0].status).toBe("unknown");
  });

  it("não usa status desconhecido ou disponibilidade malformada como mesa livre", () => {
    expect(planOperations(input({ machines: [{ id: "p1", state: "unknown" }] })).jobs[0].startAt).toBeNull();
    expect(planOperations(input({ machines: [{ id: "p1", state: "available", availableAt: "2026-10-10" }] })).jobs[0].startAt).toBeNull();
  });

  it("confere compatibilidade explícita mesmo quando a máquina foi atribuída", () => {
    const result = planOperations(input({ jobs: [job("base", { compatibleMachineIds: ["p2"] })] }));
    expect(result.jobs[0].issues).toContain("no_compatible_machine");
    expect(result.orders[0].status).toBe("blocked");
  });

  it("seleciona deterministicamente a primeira máquina elegível livre", () => {
    const result = planOperations(input({ jobs: [job("base", { machineId: null })], machines: [{ id: "p2", state: "available" }, { id: "p1", state: "available" }] }));
    expect(result.jobs[0].machineId).toBe("p1");
    expect(result.orders[0].status).toBe("estimated_on_time");
  });

  it.each([
    ["durationMinutes", null, "print_time_unknown"],
    ["durationMinutes", 0, "print_time_unknown"],
    ["durationMinutes", NaN, "print_time_unknown"],
    ["setupMinutes", null, "setup_time_unknown"],
    ["clearanceMinutes", null, "clearance_time_unknown"],
  ])("não substitui %s=%s por zero", (field, value, issue) => {
    const result = planOperations(input({ jobs: [job("base", { [field as string]: value })] }));
    expect(result.jobs[0].issues).toContain(issue);
    expect(result.orders[0].readyAt).toBeNull();
    expect(result.orders[0].status).toBe("unknown");
  });

  it("não declara prazo confirmado com compatibilidade desconhecida", () => {
    const result = planOperations(input({ jobs: [job("base", { compatibleMachineIds: null })] }));
    expect(result.orders[0].readyAt).not.toBeNull();
    expect(result.orders[0]).toMatchObject({ status: "unknown", issues: ["compatibility_unknown"] });
  });

  it("mantém prazo DATE útil para ordenar, sem inventar horário limite", () => {
    const plan = input();
    plan.orders = [{ ...plan.orders[0], deadlineAt: "2026-10-10" }];
    expect(planOperations(plan).orders[0]).toMatchObject({ status: "unknown", slackMinutes: null, issues: ["deadline_time_unknown"] });
  });

  it("não confirma conclusão sem composição completa ou tempos finais", () => {
    const plan = input();
    plan.orders = [{ ...plan.orders[0], expectedJobIds: undefined, assemblyMinutes: null }];
    const result = planOperations(plan).orders[0];
    expect(result.issues).toContain("job_manifest_unknown");
    expect(result.issues).toContain("final_operations_time_unknown");
    expect(result.readyAt).toBeNull();
    expect(result.status).toBe("unknown");
  });

  it("reconhece placa requerida ausente, sem concluir só as placas carregadas", () => {
    const plan = input();
    plan.orders = [{ ...plan.orders[0], expectedJobIds: ["base", "tampa"] }];
    const result = planOperations(plan).orders[0];
    expect(result.issues).toContain("job_manifest_incomplete");
    expect(result.printsReadyAt).toBeNull();
    expect(result.status).toBe("unknown");
  });

  it("distingue calendário desconhecido de ausência de atendimento no horizonte", () => {
    expect(planOperations(input({ operatorWindows: null })).orders[0].status).toBe("unknown");
    expect(planOperations(input({ operatorWindows: [] })).orders[0].status).toBe("blocked");
  });

  it("uma placa prioritária sem tempo bloqueia as seguintes na mesma máquina", () => {
    const plan = input({ jobs: [job("base", { durationMinutes: null, internalDeadlineAt: "2026-10-10T11:00:00Z" }), job("tampa")] });
    plan.orders = [{ ...plan.orders[0], expectedJobIds: ["base", "tampa"] }];
    expect(planOperations(plan).jobs[1].issues).toContain("machine_queue_unresolved");
  });

  it("impressão pausada ocupa a máquina mesmo quando está abaixo na prioridade", () => {
    const result = planOperations(input({ jobs: [job("base", { priority: 1 }), job("pausada", { orderId: null, status: "paused", priority: 10 })] }));
    expect(result.jobs[0].startAt).toBeNull();
    expect(result.jobs[0].issues).toContain("machine_queue_unresolved");
  });

  it("não trata estimativa original como tempo restante de impressão iniciada", () => {
    const result = planOperations(input({ jobs: [job("base", { status: "printing", remainingMinutes: null })] }));
    expect(result.jobs[0].issues).toContain("remaining_time_unknown");
    expect(result.orders[0].status).toBe("unknown");
  });

  it("impressão em andamento usa restante e exige retirada, sem repetir preparação", () => {
    const result = planOperations(input({ jobs: [job("base", { status: "printing", remainingMinutes: 20, setupMinutes: null, clearanceMinutes: 5 })], machines: [{ id: "p1", state: "busy" }] }));
    expect(result.jobs[0]).toMatchObject({ startAt: "2026-10-10T08:00:00.000Z", printEndsAt: "2026-10-10T08:20:00.000Z", readyAt: "2026-10-10T08:25:00.000Z", issues: [] });
  });

  it("dois jobs simultaneamente printing na mesma máquina exigem reconciliação", () => {
    const result = planOperations(input({ jobs: [job("base", { status: "printing", remainingMinutes: 30 }), job("outro", { orderId: null, status: "printing", remainingMinutes: 30 })] }));
    expect(result.jobs.every(row => row.issues.includes("machine_queue_unresolved"))).toBe(true);
    expect(result.jobs.every(row => row.readyAt == null)).toBe(true);
  });

  it("mostra atraso e pouca folga somente com os dados necessários completos", () => {
    const plan = input();
    plan.orders = [{ ...plan.orders[0], deadlineAt: "2026-10-10T09:29:00Z" }];
    expect(planOperations(plan).orders[0].status).toBe("late");
    plan.orders = [{ ...plan.orders[0], deadlineAt: "2026-10-10T09:45:00Z" }];
    expect(planOperations(plan).orders[0]).toMatchObject({ status: "at_risk", slackMinutes: 15 });
  });

  it("não modifica entradas e mantém o resultado determinístico", () => {
    const plan = input(), original = JSON.stringify(plan);
    expect(planOperations(plan)).toEqual(planOperations(plan));
    expect(JSON.stringify(plan)).toBe(original);
  });

  it("não confirma capacidade se a consulta trouxer a mesma identidade duas vezes", () => {
    const result = planOperations(input({ jobs: [job(), job()] }));
    expect(result.orders[0]).toMatchObject({ status: "unknown", readyAt: null, issues: ["duplicate_identity"] });
  });

  it("não confirma operador livre enquanto houver etapas manuais fora dos pedidos representados", () => {
    const result = planOperations(input({ jobs: [job(), job("manual-avulso", { orderId: null, status: "post_processing", readyAt: now })] }));
    expect(result.orders[0].status).toBe("unknown");
    expect(result.orders[0].issues).toContain("unallocated_manual_work");
  });

  it("mantém condicional a capacidade de outra máquina quando uma impressão sem tempo também disputa o operador", () => {
    const order = input().orders[0];
    const result = planOperations(input({
      jobs: [job("base", { durationMinutes: null }), job("tampa", { orderId: "segundo", machineId: "p2" })],
      orders: [order, { ...order, id: "segundo", expectedJobIds: ["tampa"] }],
    }));
    expect(result.orders.find(row => row.id === "segundo")).toMatchObject({ status: "unknown" });
    expect(result.orders.find(row => row.id === "segundo")?.issues).toContain("operator_queue_unresolved");
  });

  it("quantidades de tempo excessivas não geram datas falsas nem derrubam o planejamento", () => {
    const plan = input();
    plan.orders = [{ ...plan.orders[0], finishingMinutes: Number.MAX_VALUE }];
    const result = planOperations(plan).orders[0];
    expect(result.readyAt).toBeNull();
    expect(result.status).toBe("blocked");
  });

  it("rejeita instante sem fuso ou data inválida", () => {
    expect(() => planOperations(input({ now: "2026-10-10T08:00:00" }))).toThrow();
    expect(() => planOperations(input({ now: "2026-02-30T08:00:00Z" }))).toThrow();
  });
});

describe("prioridade e leitura de prazo da fila", () => {
  it("antecipa o job com menor folga até o prazo interno", () => {
    const short = job("curto", { deadlineAt: "2026-10-14", durationMinutes: 60 });
    const long = job("longo", { deadlineAt: "2026-10-15", durationMinutes: 72 * 60 });
    expect([short, long].sort(compareOperationalJobs).map(row => row.id)).toEqual(["longo", "curto"]);
  });

  it("respeita prazo interno e conserva prioridade/criação como desempate", () => {
    const low = job("baixa", { deadlineAt: "2026-10-14", priority: 10 });
    const high = job("alta", { deadlineAt: "2026-10-14", priority: 1 });
    const earlier = job("interno", { deadlineAt: "2026-10-20", internalDeadlineAt: "2026-10-12" });
    const missing = job("sem-prazo", { priority: 1 });
    expect([low, missing, high, earlier].sort(compareOperationalJobs).map(row => row.id)).toEqual(["interno", "alta", "baixa", "sem-prazo"]);
  });

  it("não considera zero tempo conhecido e identifica prazo vencido ou hoje", () => {
    expect(operationalJobTiming(job("base", { deadlineAt: "2026-10-09", durationMinutes: 0 }), "2026-10-10")).toMatchObject({ overdue: true, durationMinutes: null });
    expect(operationalJobTiming(job("base", { deadlineAt: "2026-10-10" }), "2026-10-10").dueToday).toBe(true);
    expect(operationalJobTiming(job("base", { deadlineAt: "2026-02-30" }), "2026-10-10").deadlineKnown).toBe(false);
  });
});
