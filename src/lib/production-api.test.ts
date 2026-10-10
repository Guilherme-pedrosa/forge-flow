import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJobs, readFinishedOutputAvailability, requiresFinishedOutputCount, transitionJob, type CreateJobInput } from "./production-api";
import { orderRequest } from "./sales-order";

const { rpc, probe } = vi.hoisted(() => ({ rpc: vi.fn(), probe: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: () => ({ select: () => ({ limit: probe }) }) } }));

const batch: CreateJobInput[] = [{ name: "Placa de 6 suportes", status: "queued", est_grams: 120, est_total_cost: 8.25 }];

describe("criação de ordens após falha de conexão", () => {
  beforeEach(() => rpc.mockReset());

  it("reenvia o mesmo lote com a mesma identidade após timeout", async () => {
    const first = orderRequest(null, JSON.stringify(batch), () => "request-1");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Conexão interrompida" } });
    await expect(createJobs(batch, first.id)).rejects.toThrow("Conexão interrompida");
    const retry = orderRequest(first, JSON.stringify(batch), () => "request-2");
    rpc.mockResolvedValueOnce({ data: ["saved-job"], error: null });
    await expect(createJobs(batch, retry.id)).resolves.toEqual(["saved-job"]);
    expect(rpc.mock.calls.map(call => call[1].p_request_id)).toEqual(["request-1", "request-1"]);
    expect(rpc.mock.contexts[0]).toMatchObject({ rpc });
  });

  it.each([NaN, Infinity, -Infinity])("rejeita %s antes que o JSON transforme o valor em nulo", async value => {
    await expect(createJobs([{ ...batch[0], est_total_cost: value }], "request")).rejects.toThrow("número inválido");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não confirma sucesso sem a lista de ordens salva", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(createJobs(batch, "request")).rejects.toThrow("confirmar a criação");
  });

  it("não recria uma operação antiga cujas ordens foram removidas", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(createJobs(batch, "request")).rejects.toThrow("ordens foram removidas");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("ativação e conferência da quantidade física", () => {
  beforeEach(() => { rpc.mockReset(); probe.mockReset(); });
  it("reconhece estrutura ainda ausente sem tratar falha de autorização ou rede como legado", async () => {
    probe.mockResolvedValueOnce({ error: { code: "42703", message: "column missing" } });
    await expect(readFinishedOutputAvailability()).resolves.toBe(false);
    probe.mockResolvedValueOnce({ error: { code: "42501", message: "permission denied" } });
    await expect(readFinishedOutputAvailability()).rejects.toThrow("permission denied");
    probe.mockResolvedValueOnce({ error: { message: "Network timeout" } });
    await expect(readFinishedOutputAvailability()).rejects.toThrow("Network timeout");
    probe.mockResolvedValueOnce({ error: null });
    await expect(readFinishedOutputAvailability()).resolves.toBe(true);
  });
  it("aprova a quantidade pela operação idempotente sem enviar novo consumo", async () => {
    rpc.mockResolvedValue({ data: "job-1", error: null });
    await transitionJob({ id: "job-1", status: "ready", approvedQuantity: 3, failureReason: "Uma peça rejeitada", qualityRequestId: "review-1" });
    expect(rpc).toHaveBeenCalledWith("confirm_finished_output", { p_job_id: "job-1", p_good_quantity: 3, p_reason: "Uma peça rejeitada", p_request_id: "review-1" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("mantém a transição legada quando a página reconhece que a conferência ainda não foi ativada", async () => {
    rpc.mockResolvedValue({ error: null });
    await transitionJob({ id: "job-1", status: "ready" });
    expect(rpc.mock.calls[0][0]).toBe("transition_job");
  });
  it("não usa a conferência de produto simples para saídas físicas por SKU ou componentes de montagem", () => {
    expect(requiresFinishedOutputCount({ production_snapshot: { physical_outputs: [{ component_product_id: "part" }] } }, "ready")).toBe(false);
    expect(requiresFinishedOutputCount({ component_stock_key: "physical-key" }, "ready")).toBe(false);
    expect(requiresFinishedOutputCount({}, "quality_check")).toBe(false);
    expect(requiresFinishedOutputCount({}, "ready")).toBe(true);
  });
});
