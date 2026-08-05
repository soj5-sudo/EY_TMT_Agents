/**
 * Resolves the "@/" path alias and extensionless imports for scripts run
 * directly by Node, which does not read tsconfig paths.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(new URL("./alias-hooks.mjs", import.meta.url).pathname));
