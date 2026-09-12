import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 5173);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  const requestPath = request.url?.split("?", 1)[0] || "/";
  const fileName = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  if (fileName.includes("..") || fileName.includes("\\")) {
    response.writeHead(400);
    response.end("bad path");
    return;
  }
  try {
    const data = await readFile(resolve(root, fileName));
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(fileName)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`OFD Viewer frontend: http://127.0.0.1:${port}\n`);
});
