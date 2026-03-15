import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const PUBLIC_ROUTES = ["/login", "/signup", "/setup"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);

  // Keep ref always up-to-date so the onAuthStateChange closure never goes stale
  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Profile;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    navigate("/login");
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        setSession(newSession);

        if (!newSession) {
          setProfile(null);
          setLoading(false);
          if (!PUBLIC_ROUTES.includes(locationRef.current)) {
            navigate("/login");
          }
          return;
        }

        // On token refresh, just update the session — don't re-fetch profile or navigate
        if (event === "TOKEN_REFRESHED") {
          return;
        }

        // Fetch profile with setTimeout to avoid Supabase auth deadlock
        setTimeout(async () => {
          if (!mounted) return;
          const p = await fetchProfile(newSession.user.id);
          if (!mounted) return;
          setProfile(p);
          setLoading(false);

          if (!p && locationRef.current !== "/setup") {
            navigate("/setup");
          } else if (p && PUBLIC_ROUTES.includes(locationRef.current)) {
            navigate("/");
          }
        }, 0);
      }
    );

    // Then check existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      if (!s) {
        setLoading(false);
        if (!PUBLIC_ROUTES.includes(locationRef.current)) {
          navigate("/login");
        }
      }
      // onAuthStateChange will handle the rest
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
