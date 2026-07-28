import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const COMMAND_OUTPUT_LIMIT_BYTES = 64 * 1_024;
const FINAL_MESSAGE_LIMIT_BYTES = 256 * 1_024;

export interface EvaluationModelAdapter {
  completeJson(prompt: string): Promise<unknown>;
}

export interface CommandRunnerOptions {
  cwd: string;
  stdin: string;
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CommandRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunnerOptions,
) => Promise<CommandRunnerResult>;

export interface CodexEvaluationModelAdapterOptions {
  command?: string;
  runner?: CommandRunner;
  model?: string;
  reasoningEffort?: string;
}

export class CodexEvaluationModelAdapter
  implements EvaluationModelAdapter
{
  private readonly command: string;
  private readonly runner: CommandRunner;
  private readonly model: string | null;
  private readonly reasoningEffort: string | null;

  constructor(options: CodexEvaluationModelAdapterOptions = {}) {
    this.command = options.command ?? "codex";
    this.runner = options.runner ?? runBoundedCommand;
    this.model = safeOption(options.model);
    this.reasoningEffort = safeOption(options.reasoningEffort);
  }

  async completeJson(prompt: string): Promise<unknown> {
    if (!prompt.trim()) {
      throw new Error("The evaluation prompt is empty.");
    }

    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "personal-context-evaluation-"),
    );
    await chmod(temporaryRoot, 0o700);
    const finalMessagePath = path.join(temporaryRoot, "last-message.json");

    try {
      const args = codexArguments(
        temporaryRoot,
        finalMessagePath,
        this.model,
        this.reasoningEffort,
      );
      let result: CommandRunnerResult;
      try {
        result = await this.runner(this.command, args, {
          cwd: temporaryRoot,
          stdin: prompt,
          environment: minimalCodexEnvironment(),
          timeoutMs: COMMAND_TIMEOUT_MS,
          maxOutputBytes: COMMAND_OUTPUT_LIMIT_BYTES,
        });
      } catch {
        throw new Error("The Codex evaluation command failed.");
      }

      if (result.exitCode !== 0) {
        throw new Error("The Codex evaluation command failed.");
      }

      const output = await readBoundedFinalMessage(finalMessagePath);
      return parseSingleJsonObject(output);
    } finally {
      try {
        await rm(temporaryRoot, { recursive: true, force: true });
      } catch {
        throw new Error(
          "Codex evaluation temporary data could not be removed.",
        );
      }
    }
  }
}

function codexArguments(
  cwd: string,
  outputPath: string,
  model: string | null,
  reasoningEffort: string | null,
): string[] {
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--config",
    'approval_policy="never"',
    "--config",
    'web_search="disabled"',
    "--config",
    'shell_environment_policy.inherit="none"',
    "--color",
    "never",
    "--cd",
    cwd,
    "--output-last-message",
    outputPath,
  ];
  if (model) args.push("--model", model);
  if (reasoningEffort) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
  }
  return args;
}

function minimalCodexEnvironment(): Readonly<Record<string, string>> {
  const allowed = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

async function readBoundedFinalMessage(outputPath: string): Promise<string> {
  try {
    const metadata = await stat(outputPath);
    if (!metadata.isFile() || metadata.size > FINAL_MESSAGE_LIMIT_BYTES) {
      throw new Error("invalid");
    }
    return await readFile(outputPath, "utf8");
  } catch {
    throw new Error("The Codex evaluation returned invalid JSON.");
  }
}

function parseSingleJsonObject(output: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("The Codex evaluation returned invalid JSON.");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("The Codex evaluation returned invalid JSON.");
  }
  return value as Record<string, unknown>;
}

function safeOption(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error("The Codex evaluation model parameter is invalid.");
  }
  return value;
}

const runBoundedCommand: CommandRunner = async (
  command,
  args,
  options,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...options.environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const finish = (
      callback: () => void,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const fail = (message: string): void => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(message)));
    };

    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        fail("The evaluation command output limit was exceeded.");
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    const timeout = setTimeout(
      () => fail("The evaluation command timed out."),
      options.timeoutMs,
    );

    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.once("error", () =>
      finish(() => reject(new Error("The evaluation command could not start."))),
    );
    child.once("close", (exitCode) =>
      finish(() =>
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
        }),
      ),
    );
    child.stdin.on("error", () => {
      // A command that exits before consuming stdin is handled by close/error.
    });
    child.stdin.end(options.stdin);
  });
