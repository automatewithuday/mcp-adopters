import type { EnrichProvider } from "./types.ts";
import { deepline } from "./deepline.ts";

// Add your own: write providers/<name>.ts implementing EnrichProvider and register it here.
const PROVIDERS: Record<string, EnrichProvider> = { deepline };

const name = process.env.ENRICH_PROVIDER ?? "deepline";
export const provider: EnrichProvider = PROVIDERS[name] ?? (() => { throw new Error(`unknown ENRICH_PROVIDER "${name}"; known: ${Object.keys(PROVIDERS).join(", ")}`); })();
export type { EnrichProvider, Hit, Found } from "./types.ts";
