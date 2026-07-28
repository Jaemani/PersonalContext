// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizard, setupPreviewDetection } from "./SetupWizard.js";
import type { SetupApiClient, SetupDetection, SetupResult } from "./types.js";

afterEach(cleanup);

const baseClient = (detection: SetupDetection, result: SetupResult = { connected: ["codex", "claude-code"], failed: [] }): SetupApiClient => ({
  detect: vi.fn().mockResolvedValue(detection),
  connect: vi.fn().mockResolvedValue(result),
});

describe("SetupWizard", () => {
  it("automatically detects a single knowledge source", async () => {
    render(<SetupWizard client={baseClient(setupPreviewDetection)} />);
    expect(await screen.findByRole("heading", { name: /found what it needs/i })).toBeTruthy();
    expect(screen.getByText("Jaeman’s Page / Wiki")).toBeTruthy();
  });

  it("asks the user to choose when multiple sources are detected", async () => {
    const sources = [...setupPreviewDetection.sources, { id: "team", name: "Team wiki", path: "~/Team", noteCount: 22, validation: "valid" as const }];
    const user = userEvent.setup();
    render(<SetupWizard client={baseClient({ ...setupPreviewDetection, sources })} />);
    expect(await screen.findByRole("heading", { name: /choose a knowledge source/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /team wiki/i }));
    expect(screen.getByRole("heading", { name: /found what it needs/i })).toBeTruthy();
  });

  it("shows the success state after connecting", async () => {
    const user = userEvent.setup();
    render(<SetupWizard initialDetection={setupPreviewDetection} client={baseClient(setupPreviewDetection)} />);
    await user.click(screen.getByRole("button", { name: /connect codex & claude/i }));
    expect(await screen.findByRole("heading", { name: /you’re all set/i })).toBeTruthy();
  });

  it("shows a partial result when one tool fails", async () => {
    const user = userEvent.setup();
    const client = baseClient(setupPreviewDetection, { connected: ["codex"], failed: [{ toolId: "claude-code", message: "Claude Code needs permission." }] });
    render(<SetupWizard initialDetection={setupPreviewDetection} client={client} />);
    await user.click(screen.getByRole("button", { name: /connect codex & claude/i }));
    expect(await screen.findByText("Claude Code needs permission.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry connection/i })).toBeTruthy();
  });

  it("supports keyboard source selection", async () => {
    const sources = [...setupPreviewDetection.sources, { id: "team", name: "Team wiki", path: "~/Team", noteCount: 22, validation: "valid" as const }];
    const user = userEvent.setup();
    render(<SetupWizard client={baseClient({ ...setupPreviewDetection, sources })} />);
    const team = await screen.findByRole("button", { name: /team wiki/i });
    team.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: /found what it needs/i })).toBeTruthy();
  });

  it("keeps a connection difference in Advanced until replacement is explicitly selected", async () => {
    const user = userEvent.setup();
    const detection: SetupDetection = {
      ...setupPreviewDetection,
      tools: [{
        id: "codex",
        name: "Codex",
        status: "conflict",
        detail: "A different Personal Context setup is connected",
        connectionDifference: {
          current: "Current connection: old-node (2 arguments)",
          proposed: "Proposed connection: node → managed Personal Context runtime",
          changes: ["MCP executable differs."],
        },
      }],
    };
    render(<SetupWizard initialDetection={detection} client={baseClient(detection)} />);
    expect((screen.getByRole("button", { name: /connect/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Codex connection difference").textContent).toContain("Current connection: old-node");
    await user.click(screen.getByRole("checkbox", { name: "Replace Codex connection" }));
    expect((screen.getByRole("button", { name: "Connect Codex" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
