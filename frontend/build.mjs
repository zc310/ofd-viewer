import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const source = resolve(root, "src");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "main.js", "state.js", "tabs.js", "viewer.js", "thumbnails.js", "text-layer.js", "app.css"]) {
  await cp(resolve(source, file), resolve(output, file));
}
await cp(resolve(source, "fonts"), resolve(output, "fonts"), { recursive: true });
