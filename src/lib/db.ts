import { createClient } from "@supabase/supabase-js";

export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/**
 * Every row of a query. PostgREST caps one response at 1000 rows, so `.limit(10000)` silently truncates.
 * `page` receives the range to apply; give the query a stable `.order()` first.
 */
export async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return out;
  }
}
