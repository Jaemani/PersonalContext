import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const outputDirectory = path.resolve("dist/runtime");
const outputPath = path.join(outputDirectory, "personal-context.mjs");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.resolve("dist/packages/cli/src/index.js")],
  outfile: outputPath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await chmod(outputPath, 0o755);
await rm(path.join(outputDirectory, "setup-ui"), {
  recursive: true,
  force: true,
});
await cp(path.resolve("dist/setup-ui"), path.join(outputDirectory, "setup-ui"), {
  recursive: true,
});
await rm(path.join(outputDirectory, "playbook"), {
  recursive: true,
  force: true,
});
await cp(path.resolve("playbook"), path.join(outputDirectory, "playbook"), {
  recursive: true,
});
