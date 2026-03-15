import { AppLayout } from "@/components/AppLayout";
import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";

export default function ModulePlaceholder() {
  const location = useLocation();
  
  // Extract module name from path
  const segments = location.pathname.split("/").filter(Boolean);
  const moduleName = segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" › ");

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-3">
        <Construction className="w-8 h-8 text-muted-foreground mx-auto" />
        <h2 className="text-sm font-semibold text-foreground">{moduleName || "Módulo"}</h2>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          Módulo em construção. Ative o Lovable Cloud para criar as tabelas e funcionalidades deste módulo.
        </p>
      </div>
    </div>
  );
}
