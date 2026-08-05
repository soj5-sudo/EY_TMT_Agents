import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = pathToFileURL(process.cwd() + "/").href;

export async function resolve(specifier, context, next) {
  let s = specifier;
  if (s.startsWith("@/")) s = ROOT + s.slice(2);
  if ((s.startsWith("file:") || s.startsWith("./") || s.startsWith("../")) && !/\.[mc]?[jt]sx?$/.test(s)) {
    const base = s.startsWith("file:") ? s : new URL(s, context.parentURL).href;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(fileURLToPath(base + ext))) { s = base + ext; break; }
    }
  }
  return next(s, context);
}
