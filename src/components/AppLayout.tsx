import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { TelemetryStrip } from "@/components/TelemetryStrip";

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
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main area — offset by sidebar width */}
      <div
        className="flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-200"
        style={{ marginLeft: collapsed ? 64 : 240 }}
      >
        <AppHeader
          onMenuClick={() => setMobileOpen(true)}
          showMenuButton
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
        <TelemetryStrip />
      </div>

      {/* Mobile: no margin, full width */}
      <style>{`
        @media (max-width: 767px) {
          .flex-1[style] { margin-left: 0 !important; }
        }
      `}</style>
    </div>
  );
}
