import { Menu, Bell, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AppHeaderProps {
  onMenuClick: () => void;
  showMenuButton?: boolean;
}

export function AppHeader({ onMenuClick, showMenuButton }: AppHeaderProps) {
  return (
    <header className="h-14 flex items-center gap-4 border-b border-border bg-card px-4 md:px-6 flex-shrink-0">
      {showMenuButton && (
        <Button variant="ghost" size="icon" onClick={onMenuClick} className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar jobs, materiais, fornecedores..."
          className="pl-9 h-9 bg-muted/50 border-border text-sm"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Argus quick ask */}
        <Button variant="outline" size="sm" className="gap-2 text-xs hidden md:flex">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Perguntar ao Argus
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
            3
          </span>
        </Button>

        {/* User avatar */}
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
          A
        </div>
      </div>
    </header>
  );
}
