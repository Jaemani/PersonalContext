import os from "node:os";
import path from "node:path";

export function defaultApplicationDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = environment.HOME ?? environment.USERPROFILE ?? os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "personal-context");
  }
  if (platform === "win32") {
    return path.join(
      environment.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
      "personal-context",
    );
  }
  return path.join(
    environment.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
    "personal-context",
  );
}

export function managedRuntimeRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(defaultApplicationDataRoot(environment, platform), "runtime");
}

export function managedRuntimeEntry(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(
    managedRuntimeRoot(environment, platform),
    "current",
    "personal-context.mjs",
  );
}
