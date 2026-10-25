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
beforeEach(() => { vi.clearAllMocks(); auth.read.mockReset(); auth.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null }); auth.signOut.mockResolvedValue({ error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

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

  it("encerra a espera da sessão em 15 segundos e repete a consulta sem apagar a sessão ou forçar login", async () => {
    vi.useFakeTimers();
    const initial = deferred<any>();
    auth.getSession.mockReturnValueOnce(initial.promise).mockResolvedValue({ data: { session: session("A") }, error: null });
    auth.read.mockResolvedValue({ data: profile("A"), error: null });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(14999); });
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("consulta da sessão demorou");
    expect(screen.getByTestId("path")).toHaveTextContent("/");
    expect(screen.getByTestId("path")).not.toHaveTextContent("/login");
    // A late result from the expired attempt cannot erase its recovery screen.
    await act(async () => { initial.resolve({ data: { session: null }, error: null }); });
    expect(screen.getByTestId("error")).toHaveTextContent("consulta da sessão demorou");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Repetir" })); await vi.advanceTimersByTimeAsync(0); });
    expect(auth.getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("user")).toHaveTextContent("A");
    expect(screen.getByTestId("profile")).toHaveTextContent("A");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("limita também a consulta do perfil, ignora o resultado atrasado e permite repetir com a sessão confirmada", async () => {
    vi.useFakeTimers();
    const initialProfile = deferred<any>();
    auth.getSession.mockResolvedValue({ data: { session: session("A") }, error: null });
    auth.read.mockReturnValueOnce(initialProfile.promise).mockResolvedValue({ data: profile("A"), error: null });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(auth.read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("consulta do perfil demorou");
    expect(screen.getByTestId("path")).not.toHaveTextContent("/setup");
    await act(async () => { initialProfile.resolve({ data: profile("Obsoleto"), error: null }); });
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).toHaveTextContent("consulta do perfil demorou");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Repetir" })); await vi.advanceTimersByTimeAsync(0); });
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(auth.read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("profile")).toHaveTextContent("A");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("não ressuscita uma sessão antiga depois de um evento de saída confirmado", async () => {
    vi.useFakeTimers();
    const initial = deferred<any>();auth.getSession.mockReturnValue(initial.promise);mount();
    await act(async () => { auth.listener("SIGNED_OUT", null); initial.resolve({ data: { session: session("A") }, error: null }); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("path")).toHaveTextContent("/login");
    expect(auth.read).not.toHaveBeenCalled();
  });

  it("não usa a primeira leitura atrasada enquanto uma nova tentativa aguarda outra sessão", async () => {
    vi.useFakeTimers();
    const initial = deferred<any>(), repeated = deferred<any>();
    auth.getSession.mockReturnValueOnce(initial.promise).mockReturnValueOnce(repeated.promise);
    auth.read.mockResolvedValue({ data: profile("B"), error: null });mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Repetir" })); initial.resolve({ data: { session: session("A") }, error: null }); });
    expect(screen.getByTestId("loading")).toHaveTextContent("true");expect(screen.getByTestId("user")).toHaveTextContent("none");
    await act(async () => { repeated.resolve({ data: { session: session("B") }, error: null }); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("user")).toHaveTextContent("B");expect(screen.getByTestId("profile")).toHaveTextContent("B");
  });

  it("mostra falha da sessão sem onboarding e só encaminha ao login após confirmação de sessão ausente", async () => {
    vi.useFakeTimers();
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("Conexão indisponível") }).mockResolvedValue({ data: { session: null }, error: null });
    mount();await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");expect(screen.getByTestId("error")).toHaveTextContent("Conexão indisponível");
    expect(screen.getByTestId("path")).not.toHaveTextContent("/login");expect(screen.getByTestId("path")).not.toHaveTextContent("/setup");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Repetir" })); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("path")).toHaveTextContent("/login");expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("cancela os temporizadores ao desmontar e permite recuperação por um evento de autenticação válido", async () => {
    vi.useFakeTimers();const initial = deferred<any>();auth.getSession.mockReturnValue(initial.promise);
    auth.read.mockResolvedValue({ data: profile("B"), error: null });mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByTestId("error")).toHaveTextContent("consulta da sessão demorou");
    await act(async () => { auth.listener("SIGNED_IN", session("B")); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("profile")).toHaveTextContent("B");expect(screen.getByTestId("error")).toHaveTextContent("none");
    cleanup();expect(vi.getTimerCount()).toBe(0);
    mount();expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();expect(vi.getTimerCount()).toBe(0);
  });
});
