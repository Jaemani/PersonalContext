import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const runtime = path.join(projectRoot, "dist/runtime/personal-context.mjs");

interface SetupFixture {
  root: string;
  home: string;
  wiki: string;
  state: string;
  launch(options?: { clients?: "both" | "codex" | "claude" | "none"; conflict?: "codex" | "claude"; failVerify?: "codex" | "claude" }): Promise<{ url: string; process: ChildProcess }>;
  cleanup(): Promise<void>;
}

async function fixture(): Promise<SetupFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-context-e2e-"));
  const home = path.join(root, "home");
  const wiki = path.join(root, "Vault", "Wiki");
  const bin = path.join(root, "bin");
  const state = path.join(root, "fake-agent-state.json");
  await fs.mkdir(wiki, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(wiki, "context.md"), "---\ntitle: Test context\ntype: knowledge\n---\n# Test context\nA local note for browser setup testing.\n");
  await fs.writeFile(state, "{}");
  for (const client of ["codex", "claude"] as const) {
    const target = path.join(bin, client);
    await fs.writeFile(target, fakeAgentSource(client));
    await fs.chmod(target, 0o755);
  }

  return {
    root, home, wiki, state,
    async launch(options = {}) {
      const clients = options.clients ?? "both";
      for (const client of ["codex", "claude"] as const) {
        if (clients === "both" || clients === client) continue;
        await fs.rm(path.join(bin, client));
      }
      if (options.conflict) await writeState(state, options.conflict, { command: "/old/node", args: ["/old/runtime.mjs", "mcp"] });
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".data"),
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        PC_FAKE_STATE: state,
        ...(options.failVerify ? { PC_FAKE_FAIL_VERIFY: options.failVerify } : {}),
      };
      const child = spawn(process.execPath, [runtime, "setup", "--store", wiki, "--no-open"], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
      const url = await readSetupUrl(child);
      return { url, process: child };
    },
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

test("single detected vault connects both agents, passes a11y, and closes on Done", async ({ page }, testInfo) => {
  const value = await fixture();
  const { url, process: setupProcess } = await value.launch();
  try {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Personal Context found what it needs" })).toBeVisible();
    await expect(page.getByText("1 knowledge notes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Codex & Claude" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("setup-review-1440x1024.png"), fullPage: true, animations: "disabled" });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    await page.getByRole("button", { name: "Connect Codex & Claude" }).press("Enter");
    await expect(page.getByRole("heading", { name: "You’re all set" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).press("Enter");
    await expectProcessExit(setupProcess);
    expect((await readState(value.state)).codex).toBeDefined();
    expect((await readState(value.state)).claude).toBeDefined();
  } finally { setupProcess.kill(); await value.cleanup(); }
});

test("keeps an unavailable client out of the primary action and supports a narrow viewport", async ({ page }, testInfo) => {
  const value = await fixture();
  const { url, process: setupProcess } = await value.launch({ clients: "codex" });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await expect(page.getByText("Claude Code").locator("..")) .toContainText("Unavailable");
    await expect(page.getByRole("button", { name: "Connect Codex" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("setup-review-narrow.png"), fullPage: true, animations: "disabled" });
  } finally { setupProcess.kill(); await value.cleanup(); }
});

test("shows an existing connection as a deliberate replacement choice", async ({ page }) => {
  const value = await fixture();
  const { url, process: setupProcess } = await value.launch({ clients: "codex", conflict: "codex" });
  try {
    await page.goto(url);
    const replace = page.getByRole("checkbox", { name: "Replace Codex connection" });
    await expect(replace).not.toBeChecked();
    await expect(page.locator("button.button").last()).toBeDisabled();
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByLabel("Codex connection difference")).toContainText("Current connection: node (2 arguments)");
    await expect(page.getByLabel("Codex connection difference")).toContainText("Proposed connection: node → managed Personal Context runtime");
    await replace.check();
    await expect(page.getByRole("button", { name: "Connect Codex" })).toBeEnabled();
    await page.getByRole("button", { name: "Connect Codex" }).click();
    await expect(page.getByRole("heading", { name: "You’re all set" })).toBeVisible();
    expect((await readState(value.state)).codex?.command).toBe(process.execPath);
  } finally { setupProcess.kill(); await value.cleanup(); }
});

test("reports a partial connection and rolls back a failed client", async ({ page }) => {
  const value = await fixture();
  const { url, process: setupProcess } = await value.launch({ failVerify: "codex" });
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "Connect Codex & Claude" }).click();
    await expect(page.getByRole("heading", { name: "Some tools need your attention" })).toBeVisible();
    await expect(page.getByText(/previous connection was restored/)).toBeVisible();
    const current = await readState(value.state);
    expect(current.codex).toBeUndefined();
    expect(current.claude).toBeDefined();
  } finally { setupProcess.kill(); await value.cleanup(); }
});

async function readSetupUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Setup did not report a URL: ${output}`)), 12_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => { if (!output.includes("http://127.0.0.1:")) { clearTimeout(timeout); reject(new Error(`Setup exited early (${code}): ${output}`)); } });
  });
}

function expectProcessExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Setup did not close after Done.")), 5_000);
    child.once("exit", (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Setup exited with ${code}`)); });
  });
}

type State = Record<string, { command: string; args: string[] }>;
async function readState(file: string): Promise<State> { return JSON.parse(await fs.readFile(file, "utf8")) as State; }
async function writeState(file: string, client: string, value: { command: string; args: string[] }): Promise<void> { const data = await readState(file); data[client] = value; await fs.writeFile(file, JSON.stringify(data)); }

function fakeAgentSource(kind: "codex" | "claude"): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const [,, ...args] = process.argv; const kind = '${kind}'; const stateFile = process.env.PC_FAKE_STATE;
const read = () => JSON.parse(readFileSync(stateFile, 'utf8')); const write = (v) => writeFileSync(stateFile, JSON.stringify(v));
if (args[0] === '--version') { console.log('fake 1.0'); process.exit(0); }
const state = read(); const op = args[1];
if (args[0] !== 'mcp') process.exit(2);
if (op === 'get') { const value = state[kind]; if (!value) process.exit(1); if (process.env.PC_FAKE_FAIL_VERIFY === kind && value.__added) { console.log(kind === 'codex' ? JSON.stringify({transport:{command:'/wrong',args:['bad']}}) : 'Scope: User config\\nCommand: /wrong\\nArgs: bad'); process.exit(0); } console.log(kind === 'codex' ? JSON.stringify({transport:value}) : 'Scope: User config\\nCommand: ' + value.command + '\\nArgs: ' + value.args.map((v) => JSON.stringify(v)).join(' ')); process.exit(0); }
if (op === 'remove') { delete state[kind]; write(state); process.exit(0); }
if (op === 'add') { const marker = args.indexOf('--'); const command = args[marker + 1]; const values = args.slice(marker + 2); state[kind] = {command, args: values, __added:true}; write(state); process.exit(0); }
process.exit(2);`;
}
