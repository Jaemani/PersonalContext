import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "personal-context-package-"));

try {
  const home = path.join(temporaryRoot, "home");
  const xdgConfig = path.join(temporaryRoot, "config");
  const xdgData = path.join(temporaryRoot, "data");
  const fakeBin = path.join(temporaryRoot, "fake-bin");
  const statePath = path.join(temporaryRoot, "fake-mcp-state.json");
  const wiki = path.join(temporaryRoot, "Vault", "Wiki");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(xdgConfig, { recursive: true }), mkdir(xdgData, { recursive: true }), mkdir(fakeBin, { recursive: true }), mkdir(wiki, { recursive: true })]);
  await writeFile(path.join(wiki, "Evidence.md"), "---\ntype: knowledge\ntags: [testing]\n---\n# Package smoke evidence\n\nA knowledge record that must survive uninstall.\n");
  await writeFile(statePath, JSON.stringify({ codex: { "another-server": { command: "other", args: [] } }, claude: { "another-server": { command: "other", args: [] } } }));
  await installFakeClients(fakeBin);

  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
    APPDATA: path.join(temporaryRoot, "app-data"),
    FAKE_MCP_STATE: statePath,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    npm_config_ignore_scripts: "true",
  };

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable.");
  const packed = await run(process.execPath, [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot], process.cwd(), environment);
  const report = parseJsonArray(packed, "npm pack");
  assert.ok(
    report[0]?.files?.some((file) => file.path === "docs/CONTEXT_DELIVERY.md"),
    "the package must include the context-delivery documentation linked from README",
  );
  const archive = path.join(temporaryRoot, report[0]?.filename ?? "");
  await access(archive);

  const prefix = path.join(temporaryRoot, "install");
  await run(process.execPath, [npmCli, "install", "--global", "--ignore-scripts", "--prefix", prefix, archive], temporaryRoot, environment);
  const executable = await installedExecutable(prefix);
  const help = await run(executable, ["--help"], temporaryRoot, environment);
  assert.match(help, /personal-context setup/);

  await run(executable, ["setup", "--headless", "--yes", "--store", wiki], temporaryRoot, environment);
  const status = JSON.parse(await run(executable, ["status", "--json"], temporaryRoot, environment));
  assert.equal(status.configured, true);
  assert.equal(status.source, "config");
  assert.equal(status.runtimeVersion, "0.1.2");
  assert.deepEqual(status.clients.map((client) => client.status), ["connected", "connected"]);

  const hits = JSON.parse(await run(executable, ["query", "package smoke"], temporaryRoot, environment));
  assert.ok(hits.length > 0, "the installed package must query the selected Wiki");

  const configPath = path.join(xdgConfig, "personal-context", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(config).sort(), ["knowledgeRoot", "lastValidatedAt", "schemaVersion"]);
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.knowledgeRoot, wiki);
  assert.ok(Number.isFinite(Date.parse(config.lastValidatedAt)));

  const runtime = runtimeRoot({ home, xdgData, localAppData: environment.LOCALAPPDATA });
  await stat(path.join(runtime, "current", "personal-context.mjs"));
  const beforeUninstall = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(beforeUninstall.codex["personal-context"]);
  assert.ok(beforeUninstall.claude["personal-context"]);
  assert.ok(beforeUninstall.codex["another-server"]);
  assert.ok(beforeUninstall.claude["another-server"]);

  await run(executable, ["uninstall"], temporaryRoot, environment);
  await assert.rejects(access(runtime));
  await stat(path.join(wiki, "Evidence.md"));
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), config);
  const afterUninstall = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(afterUninstall.codex["personal-context"], undefined);
  assert.equal(afterUninstall.claude["personal-context"], undefined);
  assert.deepEqual(afterUninstall.codex["another-server"], { command: "other", args: [] });
  assert.deepEqual(afterUninstall.claude["another-server"], { command: "other", args: [] });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function installFakeClients(directory) {
  const program = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const statePath = process.env.FAKE_MCP_STATE;
const client = require("node:path").basename(process.argv[1]).replace(/\\.(cmd|exe)$/i, "");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
const state = JSON.parse(readFileSync(statePath, "utf8"));
state[client] ||= {};
const name = client === "codex" ? args[2] : args[4];
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const found = state[client][args[2]];
  if (!found) process.exit(1);
  if (client === "codex") console.log(JSON.stringify({ transport: found }));
    else console.log("Scope: User config\\nCommand: " + found.command + "\\nArgs: " + found.args.map((value) => JSON.stringify(value)).join(" "));
  process.exit(0);
}
if (args[1] === "add") {
  const separator = args.indexOf("--");
  const server = client === "codex" ? args[2] : args[4];
  state[client][server] = { command: args[separator + 1], args: args.slice(separator + 2) };
  writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
if (args[1] === "remove") {
  const server = client === "codex" ? args[2] : args[4];
  delete state[client][server];
  writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
process.exit(2);
`;
  for (const name of ["codex", "claude"]) {
    const target = path.join(directory, name);
    await writeFile(target, program, { mode: 0o755 });
    await chmod(target, 0o755);
  }
}

async function installedExecutable(prefix) {
  const candidates = process.platform === "win32"
    ? [path.join(prefix, "personal-context.cmd"), path.join(prefix, "personal-context")]
    : [path.join(prefix, "bin", "personal-context"), path.join(prefix, "personal-context")];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  throw new Error(`The global package executable was not installed in ${prefix}.`);
}

function runtimeRoot({ home, xdgData, localAppData }) {
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "personal-context", "runtime");
  if (process.platform === "win32") return path.join(localAppData, "personal-context", "runtime");
  return path.join(xdgData, "personal-context", "runtime");
}

function parseJsonArray(output, commandName) {
  const candidates = [];
  if (output.trimStart().startsWith("[")) candidates.push(output.indexOf("["));
  for (let index = output.indexOf("\n["); index >= 0; index = output.indexOf("\n[", index + 2)) {
    candidates.push(index + 1);
  }
  for (const index of candidates.reverse()) {
    try {
      const parsed = JSON.parse(output.slice(index).trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // npm lifecycle output can precede the final --json report.
    }
  }
  throw new Error(`${commandName} did not return a JSON array.`);
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else {
        const details = [
          `${command} ${args.join(" ")} exited with ${code}.`,
          stdout ? `stdout:\n${stdout}` : "",
          stderr ? `stderr:\n${stderr}` : "",
        ].filter(Boolean).join("\n");
        reject(new Error(details));
      }
    });
  });
}
