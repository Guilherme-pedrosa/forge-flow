import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import ModulePlaceholder from "./pages/ModulePlaceholder";
import BambuLab from "./pages/integracoes/BambuLab";
import ContasPagar from "./pages/financeiro/ContasPagar";
import ContasReceber from "./pages/financeiro/ContasReceber";
import CaixaBancos from "./pages/financeiro/CaixaBancos";
import Conciliacao from "./pages/financeiro/Conciliacao";
import DRE from "./pages/financeiro/DRE";
import Itens from "./pages/estoque/Itens";
import Movimentacoes from "./pages/estoque/Movimentacoes";
import Alertas from "./pages/estoque/Alertas";
import Compras from "./pages/estoque/Compras";
import Jobs from "./pages/producao/Jobs";
import Impressoras from "./pages/producao/Impressoras";
import Produtos from "./pages/comercial/Produtos";
import Pedidos from "./pages/comercial/Pedidos";
import Clientes from "./pages/comercial/Clientes";
import Empresa from "./pages/configuracoes/Empresa";
import Usuarios from "./pages/configuracoes/Usuarios";
import Logs from "./pages/configuracoes/Logs";
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
        <Route path="/financeiro/receber" element={<ContasReceber />} />
        <Route path="/financeiro/caixa" element={<CaixaBancos />} />
        <Route path="/financeiro/conciliacao" element={<Conciliacao />} />
        <Route path="/financeiro/dre" element={<DRE />} />
        {/* Estoque */}
        <Route path="/estoque/itens" element={<Itens />} />
        <Route path="/estoque/movimentacoes" element={<Movimentacoes />} />
        <Route path="/estoque/alertas" element={<Alertas />} />
        {/* Produção */}
        <Route path="/producao/jobs" element={<Jobs />} />
        <Route path="/producao/impressoras" element={<Impressoras />} />
        <Route path="/producao/perdas" element={<ModulePlaceholder />} />
        {/* Planejamento */}
        <Route path="/planejamento/gantt" element={<ModulePlaceholder />} />
        {/* Comercial */}
        <Route path="/comercial/produtos" element={<Produtos />} />
        <Route path="/comercial/pedidos" element={<Pedidos />} />
        <Route path="/comercial/clientes" element={<Clientes />} />
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
