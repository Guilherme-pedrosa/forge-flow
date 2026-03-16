import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ArrowUpFromLine, ArrowDownToLine, Wallet, PiggyBank,
  BookOpen, Package, ArrowRightLeft, AlertTriangle, Printer, Hammer,
  BarChart3, ShoppingCart, FileText, Store, Link2, Building, UserCog,
  FileText as LogsIcon, ChevronLeft, ChevronRight, ChevronDown,
  LogOut, Factory, X, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface MenuItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  badge?: number;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}

const menuGroups: MenuGroup[] = [
  {
    label: "",
    items: [{ title: "Dashboard", icon: LayoutDashboard, href: "/" }],
    defaultOpen: true,
  },
  {
    label: "Financeiro",
    items: [
      { title: "Contas a Pagar", icon: ArrowUpFromLine, href: "/financeiro/pagar" },
      { title: "Contas a Receber", icon: ArrowDownToLine, href: "/financeiro/receber" },
      { title: "Caixa e Bancos", icon: Wallet, href: "/financeiro/caixa" },
      { title: "Conciliação", icon: PiggyBank, href: "/financeiro/conciliacao" },
      { title: "DRE", icon: BookOpen, href: "/financeiro/dre" },
    ],
    defaultOpen: true,
  },
  {
    label: "Estoque",
    items: [
      { title: "Itens / Materiais", icon: Package, href: "/estoque/itens" },
      { title: "Movimentações", icon: ArrowRightLeft, href: "/estoque/movimentacoes" },
      { title: "Compras", icon: ShoppingCart, href: "/estoque/compras" },
      { title: "Alertas", icon: AlertTriangle, href: "/estoque/alertas", badge: 2 },
    ],
  },
  {
    label: "Produção",
    items: [
      { title: "Jobs", icon: Hammer, href: "/producao/jobs" },
      { title: "Margem por SKU", icon: BarChart3, href: "/producao/margem" },
      { title: "Impressoras", icon: Printer, href: "/producao/impressoras" },
      { title: "Perdas / QC", icon: AlertTriangle, href: "/producao/perdas" },
    ],
  },
  {
    label: "Planejamento",
    items: [{ title: "Fila / Gantt", icon: BarChart3, href: "/planejamento/gantt" }],
  },
  {
    label: "Comercial",
    items: [
      { title: "Clientes", icon: Users, href: "/comercial/clientes" },
      { title: "Produtos", icon: ShoppingCart, href: "/comercial/produtos" },
      { title: "Pedidos", icon: FileText, href: "/comercial/pedidos" },
      { title: "Marketplaces", icon: Store, href: "/comercial/marketplaces" },
    ],
  },
  {
    label: "Integrações",
    items: [
      { title: "Bambu Lab", icon: Link2, href: "/integracoes/bambu" },
      { title: "Mercado Livre", icon: Store, href: "/integracoes/ml" },
    ],
  },
  {
    label: "Configurações",
    items: [
      { title: "Empresa", icon: Building, href: "/configuracoes" },
      { title: "Usuários", icon: UserCog, href: "/configuracoes/usuarios" },
      { title: "Logs", icon: LogsIcon, href: "/configuracoes/logs" },
    ],
  },
];

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const newOpenGroups: Record<string, boolean> = {};
    menuGroups.forEach((group) => {
      if (group.defaultOpen) newOpenGroups[group.label] = true;
      if (group.items.some(item => location.pathname === item.href)) newOpenGroups[group.label] = true;
    });
    setOpenGroups(newOpenGroups);
  }, [location.pathname]);

  useEffect(() => {
    onMobileClose?.();
  }, [location.pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "??";

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-sidebar-border px-4">
        {(!collapsed || mobileOpen) ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Factory className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white tracking-tight">ForgeOS</span>
              <span className="text-[10px] text-sidebar-foreground/50 leading-none">3D Print ERP</span>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <Factory className="w-4 h-4 text-white" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3">
        <nav className="space-y-0.5 px-3">
          {menuGroups.map((group, groupIndex) => {
            const isOpen = openGroups[group.label] ?? false;
            return (
              <div key={groupIndex} className={cn(group.label && "mt-4")}>
                {group.label && (!collapsed || mobileOpen) && (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
                  >
                    <span>{group.label}</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", isOpen && "rotate-180")} />
                  </button>
                )}
                <ul className={cn(
                  "space-y-0.5 overflow-hidden transition-all duration-200",
                  group.label && (!collapsed || mobileOpen) && !isOpen && "max-h-0 opacity-0",
                  group.label && (!collapsed || mobileOpen) && isOpen && "max-h-[500px] opacity-100",
                  !group.label && "space-y-0.5",
                )}>
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                      <li key={item.href}>
                        <NavLink
                          to={item.href}
                          className={cn(
                            "sidebar-item",
                            collapsed && !mobileOpen && "justify-center px-2",
                            isActive && "sidebar-item-active"
                          )}
                          title={collapsed && !mobileOpen ? item.title : undefined}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          {(!collapsed || mobileOpen) && (
                            <>
                              <span className="flex-1 truncate">{item.title}</span>
                              {item.badge && item.badge > 0 && (
                                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
                                  {item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer - Real user data */}
      <div className="border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-3", collapsed && !mobileOpen && "justify-center")}>
          <div className="h-9 w-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-medium text-sidebar-foreground flex-shrink-0">
            {initials}
          </div>
          {(!collapsed || mobileOpen) && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{profile?.display_name || "Carregando..."}</p>
              <p className="text-[11px] text-sidebar-foreground/50 truncate">{profile?.email || ""}</p>
            </div>
          )}
          {(!collapsed || mobileOpen) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="h-8 w-8 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={mobileOpen ? onMobileClose : onToggle}
          className={cn(
            "w-full text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed && !mobileOpen && "px-2"
          )}
        >
          {mobileOpen ? (
            <><X className="h-4 w-4 mr-2" /><span>Fechar</span></>
          ) : collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <><ChevronLeft className="h-4 w-4 mr-2" /><span className="text-xs">Recolher menu</span></>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn(
        "fixed left-0 top-0 z-40 hidden md:flex h-screen flex-col bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}>
        {sidebarContent}
      </aside>
      <aside className={cn(
        "fixed left-0 top-0 z-50 flex md:hidden h-screen w-72 flex-col bg-sidebar transition-transform duration-300 shadow-2xl",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}
