import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", (error: NodeJS.ErrnoException) => resolve({ command, args, exitCode: error.code === "ENOENT" ? 127 : 1, stdout, stderr: error.message }));
    child.once("close", (exitCode) => resolve({ command, args, exitCode: exitCode ?? 1, stdout, stderr }));
  });
}
