export function productionLossTotals(
  movements: { total_cost: number | null }[],
  failed: { actual_total_cost: number | null }[],
  quality: { material_cost: number; total_cost: number; quantity: number }[],
) {
  return {
    material: movements.reduce((sum, row) => sum + (row.total_cost ?? 0), 0)
      + quality.reduce((sum, row) => sum + row.material_cost, 0),
    uncosted: movements.filter(row => row.total_cost == null).length,
    // Quality rejection allocates costs already on the OI; it is not a new expense.
    failedCost: failed.reduce((sum, row) => sum + (row.actual_total_cost ?? 0), 0),
    unmeasured: failed.filter(row => row.actual_total_cost == null).length,
    qualityCost: quality.reduce((sum, row) => sum + row.total_cost, 0),
    rejectedUnits: quality.reduce((sum, row) => sum + row.quantity, 0),
  };
}
