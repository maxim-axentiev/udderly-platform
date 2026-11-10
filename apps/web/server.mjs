import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 3000);
const host = "0.0.0.0";
const clientRoot = fileURLToPath(new URL("./dist/client/", import.meta.url));
const app = (await import("./dist/server/server.js")).default;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

function clientFile(url) {
  const pathOnly = (url ?? "/").split("?")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) {
    return null;
  }
  const file = join(clientRoot, decoded.replace(/^\/+/, ""));
  const fromRoot = relative(clientRoot, file);
  if (fromRoot.startsWith("..") || fromRoot.includes(`..${sep}`)) {
    return null;
  }
  if (!existsSync(file)) {
    return null;
  }
  const info = statSync(file);
  if (!info.isFile()) {
    return null;
  }
  return file;
}

function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") {
      res.setHeader(key, value);
    }
  });
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    res.appendHeader("set-cookie", cookie);
  }
  if (!response.body || response.status === 204) {
    res.end();
    return;
  }
  void response.body
    .pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
        abort() {
          res.end();
        },
      }),
    )
    .catch(() => {
      res.destroy();
    });
}

const server = createServer(async (req, res) => {
  try {
    const file = clientFile(req.url);
    if (file) {
      const asset = file.includes(`${sep}assets${sep}`);
      res.writeHead(200, {
        "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream",
        "cache-control": asset
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      createReadStream(file).pipe(res);
      return;
    }

    const requestHost = req.headers.host ?? `${host}:${port}`;
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const response = await app.fetch(
      new Request(`http://${requestHost}${req.url ?? "/"}`, {
        method,
        headers: req.headers,
        body: hasBody ? req : undefined,
        duplex: hasBody ? "half" : undefined,
      }),
    );
    send(res, response);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal Server Error");
  }
});

server.listen(port, host);
