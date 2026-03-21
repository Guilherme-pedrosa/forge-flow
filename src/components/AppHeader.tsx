import { Menu, Bell, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

interface AppHeaderProps {
  onMenuClick: () => void;
  showMenuButton?: boolean;
}

export function AppHeader({ onMenuClick, showMenuButton }: AppHeaderProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");

  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  // Count pending notifications (overdue payables + stock alerts)
  const { data: notifCount = 0 } = useQuery({
    queryKey: ["header_notif_count"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [payables, items] = await Promise.all([
        supabase.from("accounts_payable").select("id", { count: "exact", head: true })
          .in("status", ["open", "partial"]).lt("due_date", today),
        supabase.from("inventory_items").select("current_stock, min_stock")
          .eq("is_active", true).not("min_stock", "is", null).gt("min_stock", 0),
      ]);
      const overdueCount = payables.count || 0;
      const alertCount = (items.data || []).filter(i => i.current_stock < (i.min_stock || 0)).length;
      return overdueCount + alertCount;
    },
    enabled: !!profile,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchValue.trim()) {
      // Navigate to jobs as default search target
      navigate(`/producao/jobs`);
    }
  };

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
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={handleSearch}
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Argus quick ask */}
        <Button variant="outline" size="sm" className="gap-2 text-xs hidden md:flex">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Perguntar ao Argus
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative" onClick={() => navigate("/financeiro/pagar")}>
          <Bell className="h-4 w-4" />
          {notifCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
              {notifCount > 9 ? "9+" : notifCount}
            </span>
          )}
        </Button>

        {/* User avatar */}
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
          {initials}
        </div>
      </div>
    </header>
  );
}
