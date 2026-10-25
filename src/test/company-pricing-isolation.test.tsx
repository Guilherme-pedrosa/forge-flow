import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Empresa from "@/pages/configuracoes/Empresa";
const mock = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  let columns = "";
  const query = { select: (value: string) => { columns = value; return query; }, eq: (...args: unknown[]) => { mock.eq(...args); return query; }, update: (value: unknown) => { mock.update(value); return query; },
    single: async () => ({ data: columns === "settings,updated_at" ? { settings: { energy_cost_kwh: 1.25, labor_cost_hour: 35, target_margin: 42, preserved: "latest" }, updated_at: "latest-revision" } : { id: "tenant", name: "Empresa", currency: "BRL", timezone: "America/Sao_Paulo", logo_url: null, settings: {} }, error: null }),
    maybeSingle: async () => ({ data: { id: "tenant" }, error: null }) };
  return query;
} } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("company details and pricing configuration", () => {
  it("preserves the current pricing rates when saving an older company-details form", async () => {
    render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Empresa /></QueryClientProvider></MemoryRouter>);
    const save = await screen.findByRole("button", { name: /Salvar/ });
    await screen.findByDisplayValue("Empresa"); fireEvent.click(save);
    await waitFor(() => expect(mock.update).toHaveBeenCalled());
    expect(mock.update.mock.calls[0][0].settings).toEqual(expect.objectContaining({ energy_cost_kwh: 1.25, labor_cost_hour: 35, target_margin: 42, preserved: "latest" }));
    expect(mock.update.mock.calls[0][0].settings).not.toHaveProperty("overhead_percent");
    expect(mock.eq).toHaveBeenCalledWith("updated_at", "latest-revision");
    expect(screen.getByRole("link", { name: "Configurar custos e margem" })).toHaveAttribute("href", "/configuracoes/precificacao");
  });
});
