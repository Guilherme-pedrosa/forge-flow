import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJobs, type CreateJobInput } from "./production-api";
import { orderRequest } from "./sales-order";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

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
