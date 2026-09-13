import type { MaterialRecipe } from "@/lib/product-material-recipe";

export function ProductionRecipeSummary({ recipe }: { recipe: MaterialRecipe }) {
  const cost = recipe.cost_per_unit == null ? null : recipe.cost_per_unit * recipe.units_per_print;
  return <div className="min-w-0 space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
    <p className="font-medium">Composição v{recipe.version} · {recipe.units_per_print} peça(s) por impressão</p>
    {recipe.lines.map(line => <p className="break-words" key={line.item_id}>{line.name} · {line.material_code} · {line.color_code || line.color} · {line.grams_per_print.toLocaleString("pt-BR")} g por impressão</p>)}
    <p className="font-medium">Custo previsto por impressão: {cost == null ? "Pendente" : cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
    <p className="text-xs text-muted-foreground">A ordem preserva esta versão de materiais, cores e custo. Os gramas incluem o total cadastrado na composição, sem acrescentar a purga novamente.</p>
    {!recipe.complete && <ul role="alert" className="list-disc pl-4 text-destructive">{recipe.missing.map((text, index) => <li key={index}>{text}</li>)}</ul>}
  </div>;
}
