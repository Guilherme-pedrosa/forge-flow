import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { AlertTriangle, CheckCircle2, Loader2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Alertas() {
  const { profile } = useAuth();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const alerts = useMemo(() => {
    return items
      .filter((i) => i.min_stock != null && i.min_stock > 0 && i.current_stock < i.min_stock)
      .map((i) => ({
        ...i,
        deficit: i.min_stock! - i.current_stock,
        deficitPercent: i.min_stock! > 0 ? ((i.min_stock! - i.current_stock) / i.min_stock!) * 100 : 0,
        restockCost: (i.min_stock! - i.current_stock) * i.avg_cost,
      }))
      .sort((a, b) => b.deficitPercent - a.deficitPercent);
  }, [items]);

  const criticalCount = alerts.filter((a) => a.current_stock === 0).length;
  const warningCount = alerts.length - criticalCount;
  const totalRestockCost = alerts.reduce((s, a) => s + a.restockCost, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Alertas de Estoque"
        description="Itens abaixo do estoque mínimo"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Alertas" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/estoque/movimentacoes">Registrar Entrada</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/estoque/compras">Nova Compra</Link>
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Críticos (zerado)</p>
          <p className={cn("text-2xl font-bold", criticalCount > 0 ? "text-destructive" : "text-foreground")}>{criticalCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Abaixo do Mínimo</p>
          <p className={cn("text-2xl font-bold", warningCount > 0 ? "text-amber-600" : "text-foreground")}>{warningCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Custo p/ Repor</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totalRestockCost)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mb-3 opacity-40 text-emerald-500" />
            <p className="font-medium">Estoque OK!</p>
            <p className="text-xs mt-1">Todos os itens estão acima do mínimo configurado.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severidade</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Estoque Atual</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Déficit</TableHead>
                <TableHead className="text-right">Custo p/ Repor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.current_stock === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> ZERADO
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" /> BAIXO
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-sm">{a.name}</p>
                    {a.brand && <p className="text-xs text-muted-foreground">{a.brand}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{a.material_type || "—"} {a.color ? `· ${a.color}` : ""}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-destructive font-semibold">
                    {a.current_stock.toLocaleString("pt-BR")}{a.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {a.min_stock?.toLocaleString("pt-BR")}{a.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">
                    {a.deficit.toLocaleString("pt-BR")}{a.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(a.restockCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
