import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "./handler.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export function startServer({
  port = Number(process.env.PORT || 5175),
  host = "127.0.0.1",
} = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return handle(req, res);
    try {
      const relative = decodeURIComponent(
        url.pathname === "/" ? "index.html" : url.pathname.slice(1),
      );
      if (
        !["GET", "HEAD"].includes(req.method) ||
        relative.includes("..") ||
        relative.includes("\\") ||
        !(
          /^(index|about|admin|order|order-list|cart|privacy)\.html$/.test(
            relative,
          ) || /^(css|js|images)\/[\w/ .-]+$/.test(relative)
        )
      )
        throw Error();
      const file = await realpath(path.join(root, relative));
      if (!file.startsWith(root) || !mime[path.extname(file)]) throw Error();
      const bytes = await readFile(file);
      res.setHeader("Content-Type", mime[path.extname(file)]);
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () =>
      resolve({ server, url: `http://${host}:${server.address().port}` }),
    );
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, url } = await startServer();
  console.log("CardCraft Studio BD: " + url);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => server.close(() => process.exit(0)));
}
