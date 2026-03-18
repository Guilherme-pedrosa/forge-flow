import { Sparkles } from "lucide-react";

export function ArgusPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-primary text-xs font-mono">
        <Sparkles className="w-3 h-3" />
        <span>SUGESTÕES ARGUS</span>
      </div>

      <div className="text-sm text-muted-foreground italic py-4 text-center">
        Nenhuma sugestão no momento.
      </div>
    </div>
  );
}
