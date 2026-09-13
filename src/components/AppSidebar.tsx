import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Box, ChevronDown, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { navigationGroups } from "@/components/shared/navigation";

interface AppSidebarProps { collapsed: boolean; onToggle: () => void; mobileOpen?: boolean; onMobileClose?: () => void }

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "Operação": true, "Financeiro": true });
  useEffect(() => {
    const active = navigationGroups.find(group => group.items.some(item => item.href === location.pathname));
    if (active) setOpenGroups(previous => ({ ...previous, [active.label]: true }));
    onMobileClose?.();
    // Close the mobile sheet only when navigating, not on callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const content = (compact: boolean) => <div className="flex h-full min-h-0 flex-col">
    <Link to="/" className={cn("flex h-20 shrink-0 items-center gap-3 border-b border-sidebar-border px-5", compact && "justify-center px-2")} aria-label="Forge & Flow, início"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white"><Box className="h-5 w-5" /></span>{!compact && <span><strong className="block whitespace-nowrap text-base tracking-tight text-white">Forge <span className="text-white/40">&</span> Flow</strong><span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/50">Gestão de impressão 3D</span></span>}</Link>
    <nav aria-label="Navegação principal" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-5">
      {navigationGroups.map(group => {
        const open = openGroups[group.label] ?? false;
        return <div key={group.label}>{!compact && <button type="button" aria-expanded={open} onClick={() => setOpenGroups(previous => ({ ...previous, [group.label]: !open }))} className="mb-1 flex min-h-9 w-full items-center justify-between rounded px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50 hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span>{group.label}</span><ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} /></button>}{(compact || open) && <ul className="space-y-0.5">{group.items.map(item => <li key={item.href}><NavLink end to={item.href} title={compact ? item.title : undefined} aria-label={compact ? item.title : undefined} className={({ isActive }) => cn("sidebar-item", compact && "justify-center px-2", isActive && "sidebar-item-active")}><item.icon className="h-4 w-4 shrink-0" />{!compact && <span className="min-w-0 flex-1 truncate">{item.title}</span>}</NavLink></li>)}</ul>}</div>;
      })}
    </nav>
    <div className={cn("flex shrink-0 items-center gap-2 border-t border-sidebar-border px-4 py-4", compact && "justify-center px-1")}>
      {!compact && <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-sidebar-foreground">{profile?.display_name || "Minha conta"}</p><p className="mt-1 truncate text-[11px] text-sidebar-foreground/45">{profile?.email}</p></div>}
      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-sidebar-foreground/60 hover:bg-white/5 hover:text-white" aria-label="Sair da conta" onClick={() => void signOut()}><LogOut className="h-4 w-4" /></Button>
    </div>
  </div>;
  return <>
    <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex", collapsed ? "w-20" : "w-64")}>
      {content(collapsed)}<Button variant="ghost" className="h-10 shrink-0 rounded-none border-t border-sidebar-border text-xs text-sidebar-foreground/50 hover:bg-white/5 hover:text-white" onClick={onToggle} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="mr-2 h-3.5 w-3.5" />Recolher menu</>}</Button>
    </aside>
    <Sheet open={!!mobileOpen} onOpenChange={open => { if (!open) onMobileClose?.(); }}><SheetContent side="left" className="flex h-dvh w-[min(320px,90vw)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-white"><SheetTitle className="sr-only">Menu Forge & Flow</SheetTitle><SheetDescription className="sr-only">Acesse os módulos de gestão da empresa.</SheetDescription>{content(false)}</SheetContent></Sheet>
  </>;
}
