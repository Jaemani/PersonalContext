import { access, readFile, stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CodexEvaluationModelAdapter,
  type CommandRunner,
  type CommandRunnerOptions,
} from "../packages/evaluation/src/model-adapter.js";

interface CapturedCall {
  command: string;
  args: string[];
  options: CommandRunnerOptions;
}

describe("Codex private evaluation model adapter", () => {
  it("runs Codex with a private ephemeral read-only profile over stdin", async () => {
    let call: CapturedCall | undefined;
    let capturedSchema: unknown;
    let capturedSchemaMode: number | undefined;
    const runner: CommandRunner = async (command, args, options) => {
      call = { command, args, options };
      const outputPath = argumentValue(args, "--output-last-message");
      const outputSchemaPath = argumentValue(args, "--output-schema");
      capturedSchema = JSON.parse(await readFile(outputSchemaPath, "utf8"));
      capturedSchemaMode = (await stat(outputSchemaPath)).mode & 0o777;
      await writeFile(outputPath, '{"primary_method":"experiment"}', {
        mode: 0o600,
      });
      if (process.platform !== "win32") {
        expect((await stat(options.cwd)).mode & 0o777).toBe(0o700);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const adapter = new CodexEvaluationModelAdapter({
      runner,
      model: "gpt-test",
      reasoningEffort: "high",
    });
    const prompt = "Return one JSON object.";
    const outputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["primary_method"],
      properties: {
        primary_method: { type: "string", enum: ["experiment"] },
      },
    };

    await expect(adapter.completeJson(prompt, outputSchema)).resolves.toEqual({
      primary_method: "experiment",
    });

    expect(call?.command).toBe("codex");
    expect(call?.options.stdin).toBe(prompt);
    expect(call?.options.timeoutMs).toBe(300_000);
    expect(call?.options.maxOutputBytes).toBe(65_536);
    expect(call?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        'approval_policy="never"',
        'web_search="disabled"',
        'shell_environment_policy.inherit="none"',
        "--output-last-message",
        "--output-schema",
        "--model",
        "gpt-test",
        'model_reasoning_effort="high"',
      ]),
    );
    expect(capturedSchema).toEqual(outputSchema);
    if (process.platform !== "win32") {
      expect(capturedSchemaMode).toBe(0o600);
    }
    expect(call?.args).not.toContain(prompt);
    expect(call?.options.environment).not.toHaveProperty("GITHUB_TOKEN");
    await expect(access(call!.options.cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts exactly one JSON object from the last-message file", async () => {
    const runner = runnerWriting('  {"ok":true,"items":[]} \n');
    const adapter = new CodexEvaluationModelAdapter({ runner });

    await expect(adapter.completeJson("Evaluate.")).resolves.toEqual({
      ok: true,
      items: [],
    });
  });

  it.each([
    ["trailing text", '{"ok":true}\nextra'],
    ["an array", '[{"ok":true}]'],
    ["a primitive", '"ok"'],
  ])("rejects %s without exposing model output", async (_label, output) => {
    const adapter = new CodexEvaluationModelAdapter({
      runner: runnerWriting(output),
    });

    await expect(adapter.completeJson("Evaluate.")).rejects.toThrow(
      /^The Codex evaluation returned invalid JSON\.$/,
    );
  });

  it("removes the private temporary directory after command failure", async () => {
    let cwd = "";
    const runner: CommandRunner = async (_command, _args, options) => {
      cwd = options.cwd;
      await writeFile(`${cwd}/sensitive-output.txt`, "do not retain");
      throw new Error(`failure involving ${cwd}`);
    };
    const adapter = new CodexEvaluationModelAdapter({ runner });

    await expect(adapter.completeJson("Evaluate.")).rejects.toThrow(
      /^The Codex evaluation command failed\.$/,
    );
    expect(cwd).not.toBe("");
    await expect(access(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function runnerWriting(output: string): CommandRunner {
  return async (_command, args) => {
    const outputPath = argumentValue(args, "--output-last-message");
    await writeFile(outputPath, output, { mode: 0o600 });
    expect(await readFile(outputPath, "utf8")).toBe(output);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

function argumentValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = args[index + 1];
  if (index < 0 || !value) throw new Error(`Missing ${flag}`);
  return value;
}
