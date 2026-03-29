import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.join(__dirname, "site");
const port = Number(process.env.PORT || 4180);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

const compressible = new Set([
  "text/css; charset=utf-8",
  "text/html; charset=utf-8",
  "application/javascript; charset=utf-8",
  "application/json; charset=utf-8",
  "image/svg+xml",
  "text/plain; charset=utf-8",
  "application/xml; charset=utf-8",
]);

function sanitize(urlPath) {
  let pathname = (urlPath || "/").split("?")[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    pathname = "/";
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized.startsWith(path.sep) ? normalized.slice(1) : normalized;
}

async function readFileIfPresent(filePath) {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats || !stats.isFile()) {
    return null;
  }

  return {
    body: await fs.readFile(filePath),
    filePath,
  };
}

async function resolveRequestPath(requestPath) {
  const clean = sanitize(requestPath);
  const candidates = [];

  if (!clean) {
    candidates.push("index.html");
  } else {
    candidates.push(clean);
    candidates.push(`${clean}.html`);
    candidates.push(path.join(clean, "index.html"));
  }

  for (const candidate of candidates) {
    const resolved = await readFileIfPresent(path.join(siteRoot, candidate));
    if (resolved) {
      return resolved;
    }
  }

  return readFileIfPresent(path.join(siteRoot, "index.html"));
}

function cacheControlFor(filePath) {
  const rel = path.relative(siteRoot, filePath).replace(/\\/g, "/");
  if (rel.startsWith("_next/static/")) {
    return "public, max-age=31536000, immutable";
  }
  if (rel === "react-build" || rel.startsWith("react-build/")) {
    return "public, max-age=31536000, immutable";
  }
  if (/\.(png|jpg|jpeg|gif|ico|webp|woff2?|svg)$/.test(rel)) {
    return "public, max-age=86400";
  }
  return "no-cache";
}

const server = createServer(async (req, res) => {
  const resolved = await resolveRequestPath(req.url);

  if (!resolved) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("site/index.html was not found");
    return;
  }

  const ext = path.extname(resolved.filePath).toLowerCase();
  const contentType = contentTypes.get(ext) || "application/octet-stream";
  const cacheControl = cacheControlFor(resolved.filePath);

  let body = resolved.body;
  const headers = {
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };

  const enc = String(req.headers["accept-encoding"] || "");
  const mayCompress =
    enc.includes("gzip") &&
    compressible.has(contentType) &&
    body.length > 512;

  if (mayCompress) {
    try {
      const compressed = await gzipAsync(body);
      if (compressed.length < body.length) {
        body = compressed;
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
      }
    } catch {
      /* send uncompressed */
    }
  }

  headers["Content-Length"] = String(body.length);
  res.writeHead(200, headers);
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Published build preview running at http://127.0.0.1:${port}`);
});
