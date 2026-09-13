import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { usePrinterIdleAlerts } from "@/hooks/usePrinterIdleAlerts";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  usePrinterIdleAlerts();

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:p-3">Ir para o conteúdo</a>
      <AppSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 md:ml-64",
          collapsed && "md:ml-20",
        )}
      >
        <AppHeader onMenuClick={() => setMobileOpen(true)} showMenuButton />
        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none md:p-7"><div className="mx-auto w-full max-w-[1600px]">{children}</div></main>
        <TelemetryStrip />
      </div>
    </div>
  );
}
