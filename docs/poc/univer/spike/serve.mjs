import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.SPIKE_PORT || 8125);

const requestLog = [];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function createSolidPng(size, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const redPng = createSolidPng(64, [220, 30, 30]);
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBytes = fs.existsSync(fontPath) ? fs.readFileSync(fontPath) : null;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  return raw
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${name}=1`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  const enterRoute =
    pathname === "/spike/enter"
      ? "/bundle/advanced.html"
      : pathname === "/spike/enter-roundtrip"
        ? "/bundle/roundtrip.html"
        : pathname === "/spike/enter-convert"
          ? "/bundle/convert.html"
          : null;

  if (enterRoute) {
    res.writeHead(302, {
      "Set-Cookie": "spike_auth=1; Path=/; SameSite=Lax",
      Location: enterRoute,
    });
    res.end();
    return;
  }

  if (pathname === "/spike/log") {
    res.writeHead(200, { "Content-Type": contentTypes[".json"] });
    res.end(JSON.stringify({ requests: requestLog }));
    return;
  }

  if (pathname === "/protected/dot.png") {
    const hasCookie = readCookie(req, "spike_auth");
    requestLog.push({
      path: pathname,
      host: req.headers.host,
      cookie: hasCookie,
      referer: req.headers.referer || "",
    });
    if (!hasCookie) {
      res.writeHead(401, { "Content-Type": pathname.endsWith(".png") ? "text/plain" : "text/plain" });
      res.end("unauthorized");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(redPng);
    return;
  }

  if (pathname === "/font/arial.ttf") {
    if (!fontBytes) {
      res.writeHead(404);
      res.end("font not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "font/ttf" });
    res.end(fontBytes);
    return;
  }

  const filePath = path.join(root, pathname);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
});

export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer()
    .then(() => console.log(`spike advanced server: http://127.0.0.1:${PORT}/spike/enter`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
