import path from "node:path";
import { runCommand } from "./command.js";
import type {
  AdapterPlan,
  AgentAdapter,
  AgentConnection,
  AgentName,
  ApplyOptions,
  CommandResult,
  CommandRunner,
  ExistingAgentConnection,
} from "./types.js";

interface AdapterDefinition {
  name: AgentName;
  executable: string;
}

class CliAdapter implements AgentAdapter {
  readonly name: AgentName;

  constructor(
    private readonly definition: AdapterDefinition,
    private readonly runner: CommandRunner,
  ) {
    this.name = definition.name;
  }

  async detect(): Promise<boolean> {
    return (
      await this.runner(this.definition.executable, ["--version"])
    ).exitCode === 0;
  }

  async inspect(): Promise<CommandResult> {
    const args =
      this.name === "codex"
        ? ["mcp", "get", "personal-context", "--json"]
        : ["mcp", "get", "personal-context"];
    return this.runner(this.definition.executable, args);
  }

  async plan(connection: AgentConnection): Promise<AdapterPlan> {
    const inspection = await this.inspect();
    const desired = desiredConnection(connection);
    if (inspection.exitCode !== 0) {
      return {
        action: "add",
        desired,
        previous: null,
        canRollback: true,
        inspection,
      };
    }

    const previous =
      this.name === "codex"
        ? parseCodexConnection(inspection.stdout)
        : parseClaudeConnection(inspection.stdout, desired);
    const supportedScope =
      this.name === "codex" || previous?.scope?.toLowerCase() === "user";
    const rollbackSafe =
      this.name === "codex" || previous?.rollbackSafe !== false;
    const same = previous
      ? sameConnection(previous, desired) && supportedScope
      : false;
    return {
      action: same ? "noop" : "replace",
      desired,
      previous,
      canRollback:
        same || (previous !== null && supportedScope && rollbackSafe),
      inspection,
    };
  }

  async apply(
    connection: AgentConnection,
    suppliedPlan?: AdapterPlan,
    options: ApplyOptions = {},
  ): Promise<CommandResult> {
    const plan = suppliedPlan ?? (await this.plan(connection));
    if (plan.action === "noop") {
      return ok(this.definition.executable, [], "Already connected.");
    }
    if (plan.action === "replace") {
      if (!options.allowReplace) {
        return failure(
          this.definition.executable,
          [],
          "A different personal-context connection exists. Explicit replacement approval is required.",
          2,
        );
      }
      if (!plan.canRollback || !plan.previous) {
        return failure(
          this.definition.executable,
          [],
          "The existing connection cannot be restored safely, so it was left unchanged.",
          2,
        );
      }
      const removed = await this.disconnect();
      if (removed.exitCode !== 0) return removed;
    }
    return this.add(plan.desired);
  }

  async verify(connection: AgentConnection): Promise<CommandResult> {
    const result = await this.inspect();
    if (result.exitCode !== 0) return result;
    const desired = desiredConnection(connection);
    const actual =
      this.name === "codex"
        ? parseCodexConnection(result.stdout)
        : parseClaudeConnection(result.stdout, desired);
    return actual && sameConnection(actual, desired)
      ? result
      : failure(
          result.command,
          result.args,
          "The configured MCP command does not match the managed runtime.",
        );
  }

  async rollback(plan: AdapterPlan): Promise<CommandResult> {
    const removed = await this.disconnect();
    if (plan.action !== "replace" || !plan.previous) return removed;
    if (removed.exitCode !== 0) return removed;
    return this.add(plan.previous);
  }

  disconnect(): Promise<CommandResult> {
    const args =
      this.name === "codex"
        ? ["mcp", "remove", "personal-context"]
        : ["mcp", "remove", "--scope", "user", "personal-context"];
    return this.runner(this.definition.executable, args);
  }

  private add(connection: ExistingAgentConnection): Promise<CommandResult> {
    const args =
      this.name === "codex"
        ? [
            "mcp",
            "add",
            "personal-context",
            "--",
            connection.command,
            ...connection.args,
          ]
        : [
            "mcp",
            "add",
            "--scope",
            "user",
            "personal-context",
            "--",
            connection.command,
            ...connection.args,
          ];
    return this.runner(this.definition.executable, args);
  }
}

export function codexAdapter(runner: CommandRunner = runCommand): AgentAdapter {
  return new CliAdapter({ name: "codex", executable: "codex" }, runner);
}

export function claudeAdapter(runner: CommandRunner = runCommand): AgentAdapter {
  return new CliAdapter({ name: "claude", executable: "claude" }, runner);
}

export function agentAdapter(
  name: AgentName,
  runner: CommandRunner = runCommand,
): AgentAdapter {
  return name === "codex" ? codexAdapter(runner) : claudeAdapter(runner);
}

function desiredConnection(
  connection: AgentConnection,
): ExistingAgentConnection {
  return {
    command: path.resolve(connection.nodePath),
    args: [path.resolve(connection.runtimePath), "mcp"],
    raw: "",
  };
}

function parseCodexConnection(output: string): ExistingAgentConnection | null {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    const transport =
      value.transport && typeof value.transport === "object"
        ? (value.transport as Record<string, unknown>)
        : value;
    const command = transport.command;
    const args = transport.args;
    if (
      typeof command !== "string" ||
      !Array.isArray(args) ||
      !args.every((item) => typeof item === "string")
    ) {
      return null;
    }
    return { command, args: args as string[], raw: output };
  } catch {
    return null;
  }
}

function parseClaudeConnection(
  output: string,
  desired?: ExistingAgentConnection,
): ExistingAgentConnection | null {
  const command = lineValue(output, "Command");
  const argsLine = lineValue(output, "Args");
  if (!command || argsLine === null) return null;
  const desiredMatchesRaw =
    desired !== undefined &&
    path.resolve(command) === path.resolve(desired.command) &&
    argsLine === desired.args.join(" ");
  const parsedArgs = desiredMatchesRaw
    ? desired.args
    : splitCommandLine(argsLine);
  return {
    command,
    args: parsedArgs,
    raw: output,
    scope: lineValue(output, "Scope")?.split(/\s+/)[0]?.toLowerCase(),
    rollbackSafe: desiredMatchesRaw || safelyTokenizedClaudeArgs(argsLine),
  };
}

function safelyTokenizedClaudeArgs(value: string): boolean {
  if (/['"]/.test(value)) return true;
  // Claude's human-readable output leaves spaces unquoted. Only an exact
  // two-token `<path-without-spaces> mcp` shape is unambiguous enough to
  // restore. Anything else might have been a single path containing spaces,
  // so replacement must fail closed rather than risk overwriting it.
  const args = splitCommandLine(value);
  return args.length === 2 && args[1] === "mcp";
}

function lineValue(output: string, label: string): string | null {
  const match = output.match(new RegExp(`^\\s*${label}:\\s*(.*)$`, "im"));
  return match?.[1]?.trim() ?? null;
}

function splitCommandLine(value: string): string[] {
  const items: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of value.matchAll(pattern)) {
    items.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return items;
}

function sameConnection(
  left: ExistingAgentConnection,
  right: ExistingAgentConnection,
): boolean {
  return (
    path.resolve(left.command) === path.resolve(right.command) &&
    left.args.length === right.args.length &&
    left.args.every((value, index) => {
      const expected = right.args[index];
      return index === 0 && expected
        ? path.resolve(value) === path.resolve(expected)
        : value === expected;
    })
  );
}

function ok(command: string, args: string[], stdout: string): CommandResult {
  return { command, args, exitCode: 0, stdout, stderr: "" };
}

function failure(
  command: string,
  args: string[],
  stderr: string,
  exitCode = 1,
): CommandResult {
  return { command, args, exitCode, stdout: "", stderr };
}
