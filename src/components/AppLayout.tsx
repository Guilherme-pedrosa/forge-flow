import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 md:ml-60",
          collapsed && "md:ml-16",
        )}
      >
        <AppHeader onMenuClick={() => setMobileOpen(true)} showMenuButton />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
        <TelemetryStrip />
      </div>
    </div>
  );
}
