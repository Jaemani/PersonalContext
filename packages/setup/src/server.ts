import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import http, {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { SetupService, type SetupConnectOptions } from "./service.js";

export interface SetupServerOptions {
  service: SetupService;
  assetsPath: string;
  openBrowser?: boolean;
  port?: number;
}

export interface SetupServerResult {
  url: string;
  browserOpened: boolean;
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function startSetupServer(
  options: SetupServerOptions,
): Promise<SetupServerResult> {
  const token = randomBytes(32).toString("base64url");
  const assetsRoot = path.resolve(options.assetsPath);
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = http.createServer((request, response) => {
    void handleRequest(
      request,
      response,
      token,
      assetsRoot,
      options.service,
      async () => {
        response.once("finish", () => {
          setTimeout(() => void close(), 50);
        });
      },
    );
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("The local setup server could not bind to loopback.");
  }
  const url = `http://127.0.0.1:${address.port}/`;
  const browserOpened =
    options.openBrowser === false ? false : await openBrowser(url);

  async function close(): Promise<void> {
    if (!server.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    finish();
  }

  return { url, browserOpened, closed, close };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  assetsRoot: string,
  service: SetupService,
  onFinish: () => Promise<void>,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (!authorized(request, token)) {
        sendJson(response, 403, { error: "Setup authorization failed." });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/setup/detect"
      ) {
        sendJson(response, 200, await service.detect());
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/connect"
      ) {
        const body = await readJsonBody<SetupConnectOptions>(request);
        sendJson(response, 200, await service.connect(body));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/choose-folder"
      ) {
        const folder = await chooseFolder();
        if (!folder) {
          sendJson(response, 409, {
            error: "No knowledge folder was selected.",
          });
          return;
        }
        sendJson(response, 200, await service.addChosenFolder(folder));
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/finish"
      ) {
        response.writeHead(204, securityHeaders());
        response.end();
        await onFinish();
        return;
      }
      sendJson(response, 404, { error: "Setup route not found." });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, securityHeaders());
      response.end();
      return;
    }
    await serveAsset(response, assetsRoot, url.pathname, token, request.method);
  } catch {
    sendJson(response, 500, {
      error: "Setup could not complete this step. Nothing was changed.",
    });
  }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers["x-personal-context-token"];
  const origin = request.headers.origin;
  const sameLoopbackOrigin =
    !origin || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
  return sameLoopbackOrigin && supplied === token;
}

async function serveAsset(
  response: ServerResponse,
  assetsRoot: string,
  requestPath: string,
  token: string,
  method = "GET",
): Promise<void> {
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const target = path.resolve(assetsRoot, relative);
  if (target !== assetsRoot && !target.startsWith(`${assetsRoot}${path.sep}`)) {
    response.writeHead(404, securityHeaders());
    response.end();
    return;
  }
  try {
    let content = await fs.readFile(target);
    if (relative === "index.html") {
      content = Buffer.from(
        content
          .toString("utf8")
          .replace(
            "</head>",
            `<meta name="personal-context-token" content="${token}"></head>`,
          ),
      );
    }
    response.writeHead(200, {
      ...securityHeaders(),
      "content-type": contentType(target),
      "cache-control": "no-store",
      "content-length": content.byteLength,
    });
    if (method === "HEAD") response.end();
    else response.end(content);
  } catch {
    response.writeHead(404, securityHeaders());
    response.end();
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const content = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": content.byteLength,
  });
  response.end(content);
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > 64 * 1024) throw new Error("Setup request is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function contentType(target: string): string {
  switch (path.extname(target)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
    child.unref();
  });
}

async function chooseFolder(): Promise<string | null> {
  if (process.platform === "darwin") {
    return capture("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Choose your knowledge folder")',
    ]);
  }
  if (process.platform === "linux") {
    return capture("zenity", [
      "--file-selection",
      "--directory",
      "--title=Choose your knowledge folder",
    ]);
  }
  return null;
}

function capture(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.once("error", () => resolve(null));
    child.once("close", (code) => {
      const selected = stdout.trim().replace(/[\\/]$/, "");
      resolve(code === 0 && selected ? selected : null);
    });
  });
}
