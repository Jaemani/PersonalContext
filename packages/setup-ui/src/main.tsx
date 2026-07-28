import { createRoot } from "react-dom/client";
import { SetupWizard, setupPreviewDetection } from "./SetupWizard.js";
import type { SetupApiClient, SetupDetection, SetupResult } from "./types.js";
import "./setup-wizard.css";

const single: SetupDetection = setupPreviewDetection;
const multiple: SetupDetection = { ...single, sources: [single.sources[0]!, { id: "work-notes", name: "Work notes", path: "~/Documents/Work notes", noteCount: 38, validation: "valid" }] };
const missing: SetupDetection = { ...single, sources: [] };
const success: SetupResult = { connected: ["codex", "claude-code"], failed: [] };
const partial: SetupResult = { connected: ["codex"], failed: [{ toolId: "claude-code", message: "Claude Code needs permission before it can connect." }] };
const mode = new URLSearchParams(window.location.search).get("preview");

function previewClient(result = success): SetupApiClient {
  return { detect: async () => single, connect: async () => result };
}

const props = mode === "single" || mode === "review"
  ? { initialDetection: single }
  : mode === "multiple"
    ? { initialDetection: multiple }
    : mode === "missing"
      ? { initialDetection: missing }
      : mode === "partial"
        ? { initialDetection: single, initialPhase: "partial" as const, initialMessage: partial.failed[0]!.message, client: previewClient(partial) }
        : mode === "success"
          ? { initialDetection: single, initialPhase: "success" as const, client: previewClient(success) }
          : {};

createRoot(document.getElementById("root")!).render(<SetupWizard {...props} />);
