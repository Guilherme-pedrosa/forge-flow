import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const auth = vi.hoisted(() => ({ listener: null as any, read: vi.fn(), getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: auth.read }) }) }),
  auth: { onAuthStateChange: (listener: any) => { auth.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; }, getSession: auth.getSession, signOut: auth.signOut },
} }));
const session = (id: string) => ({ user: { id }, access_token: "test", refresh_token: "test" });
const profile = (id: string) => ({ id: `profile-${id}`, user_id: id, tenant_id: `tenant-${id}`, display_name: id });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Probe() {
  const { user, profile, loading, profileError, signOut, retryProfile } = useAuth();
  const location = useLocation();
  return <><span data-testid="user">{user?.id ?? "none"}</span><span data-testid="profile">{profile?.display_name ?? "none"}</span><span data-testid="loading">{String(loading)}</span><span data-testid="error">{profileError ?? "none"}</span><span data-testid="path">{location.pathname}</span><button onClick={() => void signOut()}>Sair</button><button onClick={() => void retryProfile()}>Repetir</button></>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.clearAllMocks(); auth.getSession.mockResolvedValue({ data: { session: null }, error: null }); auth.signOut.mockResolvedValue({ error: null }); });
afterEach(cleanup);

describe("Isolamento de sessão e perfil", () => {
  it("ignora consulta de perfil que termina depois de logout", async () => {
    const pending = deferred<any>(); auth.read.mockReturnValue(pending.promise); mount();
    await act(async () => { auth.listener("SIGNED_IN", session("A")); });
    await waitFor(() => expect(auth.read).toHaveBeenCalledTimes(1));
    await act(async () => { auth.listener("SIGNED_OUT", null); pending.resolve({ data: profile("A"), error: null }); });
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("path")).toHaveTextContent("/login");
  });
  it("não confunde falha do banco com perfil ausente e permite retry", async () => {
    auth.read.mockResolvedValueOnce({ data: null, error: new Error("offline") }).mockResolvedValueOnce({ data: profile("A"), error: null }); mount();
    await act(async () => { auth.listener("SIGNED_IN", session("A")); });
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("offline"));
    expect(screen.getByTestId("path")).not.toHaveTextContent("/setup");
    fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("A"));
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });
  it("limpa o cache e ignora perfil da conta anterior ao trocar usuário", async () => {
    const first = deferred<any>(), second = deferred<any>();
    auth.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const client = mount();
    await act(async () => { auth.listener("SIGNED_IN", session("A")); });
    await waitFor(() => expect(auth.read).toHaveBeenCalledTimes(1));
    client.setQueryData(["private-finance"], { tenant: "A", value: 999 });
    await act(async () => { auth.listener("SIGNED_IN", session("B")); });
    expect(client.getQueryData(["private-finance"])).toBeUndefined();
    await waitFor(() => expect(auth.read).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve({ data: profile("B"), error: null }); first.resolve({ data: profile("A"), error: null }); });
    expect(screen.getByTestId("profile")).toHaveTextContent("B");
  });
  it("encaminha onboarding apenas quando a consulta retorna vazio sem erro", async () => {
    auth.read.mockResolvedValue({ data: null, error: null }); mount();
    await act(async () => { auth.listener("SIGNED_IN", session("A")); });
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/setup"));
  });
  it("não deixa getSession antigo sobrescrever evento de sessão recente", async () => {
    const oldSession = deferred<any>(); auth.getSession.mockReturnValue(oldSession.promise); auth.read.mockResolvedValue({ data: profile("B"), error: null }); mount();
    await act(async () => { auth.listener("SIGNED_IN", session("B")); oldSession.resolve({ data: { session: session("A") }, error: null }); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("B"));
    expect(screen.getByTestId("user")).toHaveTextContent("B");
  });
});
