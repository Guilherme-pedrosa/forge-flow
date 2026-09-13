import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ModulePlaceholder = lazy(() => import("./pages/ModulePlaceholder"));
const BambuLab = lazy(() => import("./pages/integracoes/BambuLab"));
const ContasPagar = lazy(() => import("./pages/financeiro/ContasPagar"));
const ContasReceber = lazy(() => import("./pages/financeiro/ContasReceber"));
const CaixaBancos = lazy(() => import("./pages/financeiro/CaixaBancos"));
const Conciliacao = lazy(() => import("./pages/financeiro/Conciliacao"));
const DRE = lazy(() => import("./pages/financeiro/DRE"));
const Itens = lazy(() => import("./pages/estoque/Itens"));
const Movimentacoes = lazy(() => import("./pages/estoque/Movimentacoes"));
const Alertas = lazy(() => import("./pages/estoque/Alertas"));
const Compras = lazy(() => import("./pages/estoque/Compras"));
const Jobs = lazy(() => import("./pages/producao/Jobs"));
const MargemSKU = lazy(() => import("./pages/producao/MargemSKU"));
const Impressoras = lazy(() => import("./pages/producao/Impressoras"));
const Perdas = lazy(() => import("./pages/producao/Perdas"));
const Fila = lazy(() => import("./pages/planejamento/Fila"));
const Produtos = lazy(() => import("./pages/comercial/Produtos"));
const Pedidos = lazy(() => import("./pages/comercial/Pedidos"));
const Clientes = lazy(() => import("./pages/comercial/Clientes"));
const Consignado = lazy(() => import("./pages/comercial/Consignado"));
const Empresa = lazy(() => import("./pages/configuracoes/Empresa"));
const Usuarios = lazy(() => import("./pages/configuracoes/Usuarios"));
const Logs = lazy(() => import("./pages/configuracoes/Logs"));
const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const SetupTenant = lazy(() => import("./pages/onboarding/SetupTenant"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 bg-background text-sm text-muted-foreground ${fullScreen ? "min-h-dvh" : "min-h-[40vh]"}`}><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Carregando página…</div>;
}

export function AuthAccess({ children, setup = false, publicPage = false }: { children: ReactNode; setup?: boolean; publicPage?: boolean }) {
  const { loading, user, profile, profileError, retryProfile, signOut } = useAuth();
  if (loading) return <div role="status" className="flex min-h-dvh items-center justify-center gap-3 bg-background text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando sua operação…</div>;
  if (profileError) return <div className="flex min-h-dvh items-center justify-center bg-background p-6"><div role="alert" className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6"><h1 className="text-xl font-semibold">Não foi possível carregar sua conta</h1><p className="text-sm text-muted-foreground">Seus dados continuam preservados. Verifique a conexão e tente novamente.</p><div className="flex flex-wrap gap-2"><Button onClick={() => void retryProfile()}>Tentar novamente</Button><Button variant="outline" onClick={() => void signOut()}>Sair da conta</Button></div></div></div>;
  if (publicPage) return user ? <Navigate to={profile ? "/" : "/setup"} replace /> : <>{children}</>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile && !setup) return <Navigate to="/setup" replace />;
  if (profile && setup) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthenticatedRoutes() {
  return (
    <AuthAccess>
    <AppLayout>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* Financeiro */}
        <Route path="/financeiro/pagar" element={<ContasPagar />} />
        <Route path="/financeiro/receber" element={<ContasReceber />} />
        <Route path="/financeiro/caixa" element={<CaixaBancos />} />
        <Route path="/financeiro/conciliacao" element={<Conciliacao />} />
        <Route path="/financeiro/dre" element={<DRE />} />
        {/* Estoque */}
        <Route path="/estoque/itens" element={<Itens />} />
        <Route path="/estoque/movimentacoes" element={<Movimentacoes />} />
        <Route path="/estoque/alertas" element={<Alertas />} />
        <Route path="/estoque/compras" element={<Compras />} />
        {/* Produção */}
        <Route path="/producao/jobs" element={<Jobs />} />
        <Route path="/producao/margem" element={<MargemSKU />} />
        <Route path="/producao/impressoras" element={<Impressoras />} />
        <Route path="/producao/perdas" element={<Perdas />} />
        {/* Planejamento */}
        <Route path="/planejamento/fila" element={<Fila />} />
        <Route path="/planejamento/gantt" element={<Fila />} />
        {/* Comercial */}
        <Route path="/comercial/produtos" element={<Produtos />} />
        <Route path="/comercial/pedidos" element={<Pedidos />} />
        <Route path="/comercial/clientes" element={<Clientes />} />
        <Route path="/comercial/consignado" element={<Consignado />} />
        <Route path="/comercial/marketplaces" element={<ModulePlaceholder />} />
        {/* Integrações */}
        <Route path="/integracoes/bambu" element={<BambuLab />} />
        <Route path="/integracoes/ml" element={<ModulePlaceholder />} />
        {/* Config */}
        <Route path="/configuracoes" element={<Empresa />} />
        <Route path="/configuracoes/usuarios" element={<Usuarios />} />
        <Route path="/configuracoes/logs" element={<Logs />} />
        {/* Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </AppLayout>
    </AuthAccess>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AuthAccess publicPage><Suspense fallback={<PageLoading fullScreen />}><Login /></Suspense></AuthAccess>} />
            <Route path="/signup" element={<AuthAccess publicPage><Suspense fallback={<PageLoading fullScreen />}><Signup /></Suspense></AuthAccess>} />
            <Route path="/setup" element={<AuthAccess setup><Suspense fallback={<PageLoading fullScreen />}><SetupTenant /></Suspense></AuthAccess>} />
            <Route path="/*" element={<AuthenticatedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
