import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  DollarSign,
  Package,
  Factory,
  CalendarClock,
  ShoppingCart,
  Plug,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CreditCard,
  Landmark,
  FileBarChart,
  Box,
  ArrowDownUp,
  AlertTriangle,
  Printer,
  Hammer,
  BarChart3,
  Store,
  Link2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavSection {
  label: string;
  icon: React.ElementType;
  basePath: string;
  children: { label: string; path: string; icon: React.ElementType }[];
}

const navigation: NavSection[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    basePath: "/",
    children: [],
  },
  {
    label: "Financeiro",
    icon: DollarSign,
    basePath: "/financeiro",
    children: [
      { label: "Contas a Pagar", path: "/financeiro/pagar", icon: Receipt },
      { label: "Contas a Receber", path: "/financeiro/receber", icon: CreditCard },
      { label: "Caixa e Bancos", path: "/financeiro/caixa", icon: Landmark },
      { label: "Conciliação", path: "/financeiro/conciliacao", icon: ArrowDownUp },
      { label: "DRE", path: "/financeiro/dre", icon: FileBarChart },
    ],
  },
  {
    label: "Estoque",
    icon: Package,
    basePath: "/estoque",
    children: [
      { label: "Itens", path: "/estoque/itens", icon: Box },
      { label: "Movimentações", path: "/estoque/movimentacoes", icon: ArrowDownUp },
      { label: "Alertas", path: "/estoque/alertas", icon: AlertTriangle },
    ],
  },
  {
    label: "Produção",
    icon: Factory,
    basePath: "/producao",
    children: [
      { label: "Jobs", path: "/producao/jobs", icon: Hammer },
      { label: "Impressoras", path: "/producao/impressoras", icon: Printer },
      { label: "Perdas", path: "/producao/perdas", icon: AlertTriangle },
    ],
  },
  {
    label: "Planejamento",
    icon: CalendarClock,
    basePath: "/planejamento",
    children: [
      { label: "Fila / Gantt", path: "/planejamento/gantt", icon: BarChart3 },
    ],
  },
  {
    label: "Comercial",
    icon: ShoppingCart,
    basePath: "/comercial",
    children: [
      { label: "Produtos", path: "/comercial/produtos", icon: Box },
      { label: "Pedidos", path: "/comercial/pedidos", icon: Receipt },
      { label: "Marketplaces", path: "/comercial/marketplaces", icon: Store },
    ],
  },
  {
    label: "Integrações",
    icon: Plug,
    basePath: "/integracoes",
    children: [
      { label: "Bambu Lab", path: "/integracoes/bambu", icon: Link2 },
      { label: "Mercado Livre", path: "/integracoes/ml", icon: Store },
    ],
  },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(["Dashboard"]);
  const location = useLocation();

  const toggleSection = (label: string) => {
    setOpenSections((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    );
  };

  const isActive = (path: string) => location.pathname === path;
  const isSectionActive = (section: NavSection) =>
    section.basePath === "/" 
      ? location.pathname === "/" 
      : location.pathname.startsWith(section.basePath);

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 240 }}
      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
      className="h-screen flex flex-col bg-sidebar border-r border-sidebar-border flex-shrink-0 overflow-hidden"
    >
      {/* Logo */}
      <div className="h-12 flex items-center px-3 border-b border-sidebar-border gap-2">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
          <Factory className="w-4 h-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col min-w-0"
          >
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">ForgeOS</span>
            <span className="text-[10px] text-muted-foreground leading-none">Manufacturing ERP</span>
          </motion.div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
        {navigation.map((section) => {
          const Icon = section.icon;
          const active = isSectionActive(section);
          const isOpen = openSections.includes(section.label);
          const hasChildren = section.children.length > 0;

          return (
            <div key={section.label}>
              {hasChildren ? (
                <button
                  onClick={() => toggleSection(section.label)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{section.label}</span>
                      <ChevronDown
                        className={cn(
                          "w-3 h-3 transition-transform",
                          isOpen && "rotate-180"
                        )}
                      />
                    </>
                  )}
                </button>
              ) : (
                <NavLink
                  to={section.basePath}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="truncate">{section.label}</span>}
                </NavLink>
              )}

              {/* Children */}
              {hasChildren && !collapsed && (
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="ml-3 pl-3 border-l border-sidebar-border space-y-0.5 py-0.5">
                        {section.children.map((child) => (
                          <NavLink
                            key={child.path}
                            to={child.path}
                            className={cn(
                              "flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors",
                              isActive(child.path)
                                ? "bg-sidebar-accent text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                            )}
                          >
                            <child.icon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{child.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          );
        })}
      </nav>

      {/* Argus CTA */}
      {!collapsed && (
        <div className="px-2 pb-2">
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs hover:bg-primary/15 transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-medium">Perguntar ao Argus</span>
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-sidebar-border px-1.5 py-1.5 flex items-center gap-1">
        {!collapsed && (
          <NavLink
            to="/configuracoes"
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex-1 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configurações</span>
          </NavLink>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </motion.aside>
  );
}
