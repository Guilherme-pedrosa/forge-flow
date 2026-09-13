import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAuth } from "@/contexts/AuthContext";
import { navigationGroups } from "@/components/shared/navigation";

interface AppHeaderProps { onMenuClick: () => void; showMenuButton?: boolean }

export function AppHeader({ onMenuClick, showMenuButton }: AppHeaderProps) {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const currentGroup = navigationGroups.find(group => group.items.some(item => item.href === location.pathname));
  const currentPage = currentGroup?.items.find(item => item.href === location.pathname);
  const initials = (profile?.display_name || "Usuário").trim().split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(open => !open); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return <>
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-7">
      {showMenuButton && <Button variant="ghost" size="icon" onClick={onMenuClick} className="h-11 w-11 md:hidden" aria-label="Abrir menu principal"><Menu className="h-5 w-5" /></Button>}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm"><span className="hidden text-muted-foreground lg:inline">{currentGroup?.label || "Forge & Flow"}</span><ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/60 lg:block" /><span className="truncate font-medium">{currentPage?.title || "Forge & Flow"}</span></div>
      <Button variant="outline" onClick={() => setSearchOpen(true)} className="h-10 gap-2 border-transparent bg-muted/60 px-3 text-muted-foreground sm:w-60 sm:justify-start" aria-label="Buscar página"><Search className="h-4 w-4" /><span className="hidden text-xs sm:inline">Ir para uma página...</span><kbd className="ml-auto hidden rounded border bg-card px-1.5 py-0.5 text-[10px] sm:block">Ctrl K</kbd></Button>
      <Link to="/configuracoes" title={profile?.display_name || "Configurações da empresa"} aria-label="Configurações da empresa" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-primary/5 text-xs font-semibold text-primary">{initials}</Link>
    </header>
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="overflow-hidden p-0 sm:max-w-xl"><DialogTitle className="sr-only">Buscar página</DialogTitle><DialogDescription className="sr-only">Digite o nome de um módulo para acessá-lo.</DialogDescription><Command><CommandInput placeholder="Buscar financeiro, materiais, pedidos..." /><CommandList className="max-h-[min(60dvh,420px)]"><CommandEmpty>Nenhuma página encontrada.</CommandEmpty>{navigationGroups.map(group => <CommandGroup key={group.label} heading={group.label}>{group.items.map(item => <CommandItem key={item.href} value={`${group.label} ${item.title}`} className="min-h-11 gap-3" onSelect={() => { setSearchOpen(false); navigate(item.href); }}><item.icon className="h-4 w-4 text-muted-foreground" />{item.title}<ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" /></CommandItem>)}</CommandGroup>)}</CommandList></Command></DialogContent></Dialog>
  </>;
}
