import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useLocation } from "react-router-dom";

interface Profile {
  id: string;
  user_id: string;
  tenant_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
}
interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  retryProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthState>({ session: null, user: null, profile: null, loading: true, profileError: null, retryProfile: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);
const PUBLIC_ROUTES = ["/login", "/signup"];
const AUTH_READ_TIMEOUT_MS = 15000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const generation = useRef(0);
  const sessionRead = useRef(0);
  const mounted = useRef(false);
  const deferredLoads = useRef(new Set<ReturnType<typeof setTimeout>>());
  const pendingReads = useRef(new Set<() => void>());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const clearCache = useCallback(() => { void qc.cancelQueries(); qc.clear(); }, [qc]);
  // The SDK can leave a refresh or REST request pending without rejecting. Bound
  // the UI wait without deleting its session or trusting a stored profile.
  const boundedRead = useCallback(<T,>(operation: PromiseLike<T>, timeoutMessage: string): Promise<T> => new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingReads.current.delete(cancel);
      complete();
    };
    const cancel = () => finish(() => reject(new Error("Consulta interrompida.")));
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), AUTH_READ_TIMEOUT_MS);
    pendingReads.current.add(cancel);
    Promise.resolve(operation).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  }), []);
  const loadProfile = useCallback(async (userId: string, request: number) => {
    try {
      const { data, error } = await boundedRead(supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        "A consulta do perfil demorou mais que o esperado. Tente novamente.");
      if (!mounted.current || generation.current !== request || sessionRef.current?.user.id !== userId) return;
      if (error) throw error;
      // Only a successful empty result means onboarding is needed.
      profileRef.current = data as Profile | null;
      setProfile(data as Profile | null);
      setProfileError(null);
    } catch (error) {
      if (!mounted.current || generation.current !== request || sessionRef.current?.user.id !== userId) return;
      profileRef.current = null;
      setProfile(null);
      setProfileError(error instanceof Error ? error.message : "Não foi possível consultar seu perfil. Verifique a conexão e tente novamente.");
    } finally {
      if (mounted.current && generation.current === request) setLoading(false);
    }
  }, [boundedRead]);

  const applySession = useCallback((newSession: Session | null, event: string) => {
    if (!mounted.current) return;
    const previousUser = sessionRef.current?.user.id;
    const nextUser = newSession?.user.id;
    sessionRef.current = newSession;
    setSession(newSession);
    if (previousUser !== nextUser) {
      clearCache(); profileRef.current = null; setProfile(null);
    }
    if (!newSession) {
      ++generation.current;
      profileRef.current = null; setProfile(null); setProfileError(null); setLoading(false);
      return;
    }
    if (previousUser === nextUser && profileRef.current?.user_id === nextUser && event !== "USER_UPDATED") {
      setProfileError(null); setLoading(false); return;
    }
    const request = ++generation.current;
    setLoading(true); setProfileError(null);
    // Supabase auth callbacks must return before another auth-backed request.
    const timer = setTimeout(() => {
      deferredLoads.current.delete(timer);
      if (mounted.current && generation.current === request && sessionRef.current?.user.id === nextUser) void loadProfile(nextUser!, request);
    }, 0);
    deferredLoads.current.add(timer);
  }, [clearCache, loadProfile]);

  const readSession = useCallback(async () => {
    const attempt = ++sessionRead.current;
    const request = ++generation.current;
    setLoading(true); setProfileError(null);
    try {
      const { data, error } = await boundedRead(supabase.auth.getSession(),
        "A consulta da sessão demorou mais que o esperado. Tente novamente.");
      if (!mounted.current || sessionRead.current !== attempt || generation.current !== request) return;
      if (error) throw error;
      applySession(data.session, "INITIAL_SESSION");
    } catch (error) {
      if (!mounted.current || sessionRead.current !== attempt || generation.current !== request) return;
      setProfileError(error instanceof Error ? error.message : "Não foi possível recuperar a sessão. Tente novamente.");
      setLoading(false);
    }
  }, [applySession, boundedRead]);

  const retryProfile = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      await readSession();
      return;
    }
    const request = ++generation.current;
    setLoading(true); setProfileError(null);
    await loadProfile(current.user.id, request);
  }, [loadProfile, readSession]);

  const signOut = useCallback(async () => {
    const request = ++generation.current;
    ++sessionRead.current;
    profileRef.current = null;
    setProfile(null); setLoading(true); setProfileError(null); clearCache();
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      if (!mounted.current || generation.current !== request) return;
      sessionRef.current = null; setSession(null); setLoading(false);
      navigate("/login", { replace: true });
    } catch (error) {
      if (!mounted.current || generation.current !== request) return;
      setProfileError("Não foi possível encerrar a sessão. Tente sair novamente.");
      setLoading(false);
    }
  }, [clearCache, navigate]);

  useEffect(() => {
    mounted.current = true;
    let authEventSeen = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted.current) return;
      authEventSeen = true;
      ++sessionRead.current;
      applySession(newSession, event);
    });
    if (!authEventSeen) void readSession();
    return () => {
      mounted.current = false; ++generation.current; ++sessionRead.current;
      deferredLoads.current.forEach(clearTimeout); deferredLoads.current.clear();
      pendingReads.current.forEach(cancel => cancel()); pendingReads.current.clear();
      subscription.unsubscribe();
    };
  }, [applySession, readSession]);

  useEffect(() => {
    if (loading || profileError) return;
    const path = location.pathname;
    if (!session && !PUBLIC_ROUTES.includes(path)) navigate("/login", { replace: true });
    else if (session && !profile && path !== "/setup") navigate("/setup", { replace: true });
    else if (session && profile && [...PUBLIC_ROUTES, "/setup"].includes(path)) navigate("/", { replace: true });
  }, [session, profile, loading, profileError, location.pathname, navigate]);

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, profileError, retryProfile, signOut }}>{children}</AuthContext.Provider>;
}
