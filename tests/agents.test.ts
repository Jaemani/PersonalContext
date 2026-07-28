import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeAdapter, codexAdapter } from "../packages/agents/src/index.js";
import type {
  CommandResult,
  CommandRunner,
  ExistingAgentConnection,
} from "../packages/agents/src/types.js";

function fakeRunner(kind: "codex" | "claude"): {
  runner: CommandRunner;
  calls: Array<{ command: string; args: string[] }>;
  current: () => ExistingAgentConnection | null;
  setCurrent(value: ExistingAgentConnection | null): void;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  let current: ExistingAgentConnection | null = null;
  const runner: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === "--version") return result(command, args, 0, "1.0");
    if (args[1] === "get") {
      if (!current) return result(command, args, 1, "", "not found");
      const stdout =
        kind === "codex"
          ? JSON.stringify({
              transport: {
                type: "stdio",
                command: current.command,
                args: current.args,
              },
            })
          : `personal-context:\n  Scope: User\n  Command: ${current.command}\n  Args: ${current.args.join(" ")}\n`;
      return result(command, args, 0, stdout);
    }
    if (args[1] === "remove") {
      current = null;
      return result(command, args, 0);
    }
    if (args[1] === "add") {
      const separator = args.indexOf("--");
      current = {
        command: args[separator + 1] ?? "",
        args: args.slice(separator + 2),
        raw: "",
        ...(kind === "claude" ? { scope: "user" } : {}),
      };
      return result(command, args, 0);
    }
    return result(command, args, 1, "", "unexpected command");
  };
  return {
    runner,
    calls,
    current: () => current,
    setCurrent: (value) => {
      current = value;
    },
  };
}

describe("official agent adapters", () => {
  it("registers Codex with a stable Node and managed runtime path", async () => {
    const fake = fakeRunner("codex");
    const adapter = codexAdapter(fake.runner);
    const connection = {
      nodePath: "/opt/node/bin/node",
      runtimePath: "/data/personal-context/current/personal-context.mjs",
    };
    const plan = await adapter.plan(connection);
    expect(plan.action).toBe("add");
    expect((await adapter.apply(connection, plan)).exitCode).toBe(0);
    expect(fake.calls.at(-1)?.args).toEqual([
      "mcp",
      "add",
      "personal-context",
      "--",
      path.resolve(connection.nodePath),
      path.resolve(connection.runtimePath),
      "mcp",
    ]);
    expect((await adapter.verify(connection)).exitCode).toBe(0);
  });

  it("requires approval for conflicts and can restore the prior connection", async () => {
    const fake = fakeRunner("claude");
    const previous = {
      command: "/old/node",
      args: ["/old/runtime.mjs", "mcp"],
      raw: "",
      scope: "user",
    };
    fake.setCurrent(previous);
    const adapter = claudeAdapter(fake.runner);
    const connection = {
      nodePath: "/new/node",
      runtimePath: "/new/runtime.mjs",
    };
    const plan = await adapter.plan(connection);
    expect(plan.action).toBe("replace");
    expect((await adapter.apply(connection, plan)).exitCode).toBe(2);
    expect(fake.current()?.command).toBe(previous.command);
    expect(
      (await adapter.apply(connection, plan, { allowReplace: true })).exitCode,
    ).toBe(0);
    expect(fake.current()?.command).toBe(path.resolve(connection.nodePath));
    expect((await adapter.rollback(plan)).exitCode).toBe(0);
    expect(fake.current()).toMatchObject(previous);
    expect(fake.calls.some((call) => call.args.includes("--scope"))).toBe(true);
  });
});

function result(
  command: string,
  args: string[],
  exitCode: number,
  stdout = "",
  stderr = "",
): CommandResult {
  return { command, args, exitCode, stdout, stderr };
}
