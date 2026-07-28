import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startSetupServer } from "../packages/setup/src/server.js";
import type { SetupService } from "../packages/setup/src/service.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("loopback setup server", () => {
  it("serves the wizard, rejects unauthenticated mutations, and closes on Done", async () => {
    const assets = await fs.mkdtemp(path.join(os.tmpdir(), "pc-assets-"));
    temporary.push(assets);
    await fs.writeFile(
      path.join(assets, "index.html"),
      "<html><head></head><body>Setup</body></html>",
    );
    const service = {
      detect: async () => ({ sources: [], tools: [] }),
    } as unknown as SetupService;
    const server = await startSetupServer({
      service,
      assetsPath: assets,
      openBrowser: false,
    });
    const page = await (await fetch(server.url)).text();
    const token = page.match(
      /name="personal-context-token" content="([^"]+)"/,
    )?.[1];
    expect(token).toBeTruthy();
    expect(
      (await fetch(new URL("/api/setup/detect", server.url))).status,
    ).toBe(403);
    const headers = { "x-personal-context-token": token! };
    const detection = await fetch(
      new URL("/api/setup/detect", server.url),
      { headers },
    );
    expect(detection.status).toBe(200);
    const finished = fetch(new URL("/api/setup/finish", server.url), {
      method: "POST",
      headers,
    });
    expect((await finished).status).toBe(204);
    await server.closed;
  });
});
