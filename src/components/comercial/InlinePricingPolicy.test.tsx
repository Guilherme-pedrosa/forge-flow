import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlinePricingPolicy } from "./InlinePricingPolicy";
import type { PricingPolicy, PricingPolicyKey } from "@/lib/pricing-policy";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), policy: {} as PricingPolicy }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
const complete: PricingPolicy = { revision: "r1", machine_rate_scope: "commercial_excludes_energy", machine_hour_cost: 2, labor_cost_hour: 25, energy_cost_kwh: 1.14, target_margin: 50, handling_minutes_per_plate: 5, finishing_minutes_per_piece: null, assembly_minutes_per_product: null, extras_cost_per_product: null, overhead_percent: 3, printer_hour_costs: [{ printer_id: "a1", hour_cost: 4 }, { printer_id: "archived", hour_cost: 0 }] };
const missing: PricingPolicyKey[] = ["finishing_minutes_per_piece", "assembly_minutes_per_product", "extras_cost_per_product"];
const finish = "Acabamento padrão por peça (min)";
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["pricing_settings", "tenant"], mock.policy);
  const invalidate = vi.spyOn(client, "invalidateQueries"), busy = vi.fn(), draft = vi.fn();
  render(<QueryClientProvider client={client}><InlinePricingPolicy policy={mock.policy} missingKeys={missing} printers={[{ id: "a1", name: "A1" }]} onBusy={busy} onDraft={draft} /></QueryClientProvider>);
  return { client, invalidate, busy, draft };
}
beforeEach(() => {
  mock.policy = structuredClone(complete);
  mock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "pricing_settings") return { data: mock.policy, error: null };
    if (name === "save_pricing_settings") { mock.policy = { ...mock.policy, ...(args.p_settings as PricingPolicy), revision: "r2" }; return { data: "saved", error: null }; }
    throw new Error(`Unexpected RPC ${name}`);
  });
});
describe("InlinePricingPolicy", () => {
  it("asks only the missing defaults and saves explicit zero without dropping other fields or printer exceptions", async () => {
    const { client, invalidate, busy, draft } = mount();
    expect(screen.getByLabelText(finish, { exact: true })).toHaveValue("");
    expect(screen.queryByLabelText("Energia elétrica (R$/kWh)", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Considerar zero: ${finish}` }));
    change("Montagem por produto completo (min)", "3,5");
    change("Outros insumos padrão por produto (R$)", "1,25");
    expect(draft).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await screen.findByText(/Parâmetros salvos/);
    expect(mock.rpc.mock.calls.find(([name]) => name === "save_pricing_settings")?.[1]).toMatchObject({ p_expected_revision: "r1", p_settings: { energy_cost_kwh: 1.14, labor_cost_hour: 25, target_margin: 50, handling_minutes_per_plate: 5, printer_hour_costs: complete.printer_hour_costs, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 3.5, extras_cost_per_product: 1.25 } });
    expect(client.getQueryData(["pricing_settings", "tenant"])).toMatchObject({ revision: "r2", finishing_minutes_per_piece: 0 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["product_pricing_preview"] });
    expect(busy).toHaveBeenLastCalledWith(false); expect(draft).toHaveBeenLastCalledWith(false);
  });
  it("retries the same request after a lost committed response and preserves entered values", async () => {
    const original = mock.rpc.getMockImplementation()!; let lost = true;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      const result = await original(name, args);
      if (name === "save_pricing_settings" && lost) { lost = false; throw new Error("Conexão perdida depois de salvar"); }
      return result;
    });
    mount(); change(finish, "2");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conexão perdida");
    expect(screen.getByLabelText(finish, { exact: true })).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await screen.findByText(/Parâmetros salvos/);
    const calls = mock.rpc.mock.calls.filter(([name]) => name === "save_pricing_settings");
    expect(calls).toHaveLength(2); expect(calls[1][1]).toEqual(calls[0][1]);
  });
  it("keeps a stale edit for review, merges only touched values after explicit refresh and uses the new revision", async () => {
    const original = mock.rpc.getMockImplementation()!; let conflict = true;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "save_pricing_settings" && conflict) { conflict = false; mock.policy = { ...mock.policy, revision: "remote-r2", energy_cost_kwh: 2, printer_hour_costs: [{ printer_id: "a1", hour_cost: 6 }] }; return { data: null, error: { message: "Os parâmetros mudaram. Atualize antes de salvar." } }; }
      return original(name, args);
    });
    mount(); change(finish, "2,5");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText(finish, { exact: true })).toHaveValue("2,5");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar parâmetros e manter meus valores" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Conferir todos os parâmetros da empresa" }));
    expect(screen.getByLabelText("Energia elétrica (R$/kWh)", { exact: true })).toHaveValue("2");
    expect(screen.getByLabelText(finish, { exact: true })).toHaveValue("2,5");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await screen.findByText(/Parâmetros salvos/);
    const calls = mock.rpc.mock.calls.filter(([name]) => name === "save_pricing_settings");
    expect(calls[1][1]).toMatchObject({ p_expected_revision: "remote-r2", p_settings: { energy_cost_kwh: 2, finishing_minutes_per_piece: 2.5, printer_hour_costs: [{ printer_id: "a1", hour_cost: 6 }] } });
    expect(calls[1][1].p_request_id).not.toBe(calls[0][1].p_request_id);
  });
  it("blocks repeated save and cancellation while writing, then releases both parent guards", async () => {
    let resolve!: (value: unknown) => void; const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "save_pricing_settings" ? new Promise(done => { resolve = done; }) : original(name, args));
    const { busy, draft } = mount(); change(finish, "0");
    const button = screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }); fireEvent.click(button); fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Cancelar alterações de custos" })).toBeDisabled();
    expect(screen.getByLabelText(finish, { exact: true })).toBeDisabled();
    expect(busy).toHaveBeenLastCalledWith(true); expect(draft).toHaveBeenLastCalledWith(true);
    await act(async () => { resolve({ data: "saved", error: null }); });
    await screen.findByText(/Parâmetros salvos/);
    expect(mock.rpc.mock.calls.filter(([name]) => name === "save_pricing_settings")).toHaveLength(1);
    expect(busy).toHaveBeenLastCalledWith(false); expect(draft).toHaveBeenLastCalledWith(false);
  });
});
