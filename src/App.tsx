import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import ModulePlaceholder from "./pages/ModulePlaceholder";
import ContasPagar from "./pages/financeiro/ContasPagar";
import Impressoras from "./pages/producao/Impressoras";
import Jobs from "./pages/producao/Jobs";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import SetupTenant from "./pages/onboarding/SetupTenant";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AuthenticatedRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* Financeiro */}
        <Route path="/financeiro/pagar" element={<ContasPagar />} />
        <Route path="/financeiro/receber" element={<ModulePlaceholder />} />
        <Route path="/financeiro/caixa" element={<ModulePlaceholder />} />
        <Route path="/financeiro/conciliacao" element={<ModulePlaceholder />} />
        <Route path="/financeiro/dre" element={<ModulePlaceholder />} />
        {/* Estoque */}
        <Route path="/estoque/itens" element={<ModulePlaceholder />} />
        <Route path="/estoque/movimentacoes" element={<ModulePlaceholder />} />
        <Route path="/estoque/alertas" element={<ModulePlaceholder />} />
        {/* Produção */}
        <Route path="/producao/jobs" element={<Jobs />} />
        <Route path="/producao/impressoras" element={<Impressoras />} />
        <Route path="/producao/perdas" element={<ModulePlaceholder />} />
        {/* Planejamento */}
        <Route path="/planejamento/gantt" element={<ModulePlaceholder />} />
        {/* Comercial */}
        <Route path="/comercial/produtos" element={<ModulePlaceholder />} />
        <Route path="/comercial/pedidos" element={<ModulePlaceholder />} />
        <Route path="/comercial/marketplaces" element={<ModulePlaceholder />} />
        {/* Integrações */}
        <Route path="/integracoes/bambu" element={<ModulePlaceholder />} />
        <Route path="/integracoes/ml" element={<ModulePlaceholder />} />
        {/* Config */}
        <Route path="/configuracoes" element={<ModulePlaceholder />} />
        {/* Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
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
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/setup" element={<SetupTenant />} />
            <Route path="/*" element={<AuthenticatedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
