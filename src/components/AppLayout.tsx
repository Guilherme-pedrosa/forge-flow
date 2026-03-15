import { AppSidebar } from "@/components/AppSidebar";
import { TelemetryStrip } from "@/components/TelemetryStrip";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
        <TelemetryStrip />
      </div>
    </div>
  );
}
