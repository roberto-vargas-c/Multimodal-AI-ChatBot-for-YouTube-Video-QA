// Ingests everything listed in a library file (see library.example.json), one source after the other.
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const flags = (o: Record<string, unknown>) => Object.entries(o).filter(([k, v]) => !k.startsWith("_") && v !== false).flatMap(([k, v]) => v === true ? [`--${k}`] : [`--${k}`, String(v)]);

const file = process.argv[2] ?? "ingest/library.json";
const lib = JSON.parse(await readFile(file, "utf8")) as { videos?: Record<string, unknown>[]; books?: Record<string, unknown>[] };
let failed = 0;
for (const [script, items] of [["youtube.ts", lib.videos ?? []], ["book.ts", lib.books ?? []]] as const)
  for (const item of items) {
    const r = spawnSync("npx", ["tsx", join(here, script), ...flags(item)], { stdio: "inherit" });
    if (r.status !== 0) failed++;
  }
console.log(failed ? `${failed} source(s) failed` : "All sources ingested");
process.exit(failed ? 1 : 0);
