import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ArgusSuggestion {
  id: string;
  text: string;
  impact?: string;
  module: string;
}

const mockSuggestions: ArgusSuggestion[] = [
  {
    id: "1",
    text: "3 jobs com PLA Preto podem ser agrupados na X1C-01. Economia de 45min em troca de material.",
    impact: "Redução de 12% no idle time",
    module: "Produção",
  },
  {
    id: "2",
    text: "Spool de PETG Branco em 156g — abaixo do ponto de reposição (200g).",
    impact: "Risco de parada na P1S-01",
    module: "Estoque",
  },
];

export function ArgusPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-primary text-xs font-mono">
        <Sparkles className="w-3 h-3" />
        <span>SUGESTÕES ARGUS</span>
      </div>

      {mockSuggestions.map((s, i) => (
        <motion.div
          key={s.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1, duration: 0.3, ease: [0.2, 0, 0, 1] }}
          className="bg-primary/5 border border-primary/20 p-3 rounded-md space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase">
            <span className="badge-argus px-1.5 py-0.5 rounded text-[10px]">{s.module}</span>
          </div>
          <p className="text-sm text-foreground/90">{s.text}</p>
          {s.impact && (
            <p className="text-xs text-primary font-mono">{s.impact}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="argus" size="sm">Aplicar</Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground">Ignorar</Button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
