/** Supabase limits a response to 1,000 rows. Reports must load every page. */
export async function readProductionRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await load(page * 500, page * 500 + 499);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
