export type ToolId = "codex" | "claude-code";

export interface KnowledgeSource {
  id: string;
  name: string;
  path: string;
  noteCount: number;
  validation: "valid" | "warning" | "invalid";
}

export interface DetectedTool {
  id: ToolId;
  name: string;
  status: "ready" | "connected" | "conflict" | "unavailable";
  detail?: string;
  connectionDifference?: {
    current: string;
    proposed: string;
    changes: string[];
  };
}

export interface SetupDetection {
  sources: KnowledgeSource[];
  tools: DetectedTool[];
}

export interface SetupOptions {
  sourceId: string;
  toolIds: ToolId[];
  includeHiddenFiles: boolean;
}

export interface SetupResult {
  connected: ToolId[];
  failed: Array<{ toolId: ToolId; message: string }>;
}

/**
 * Same-origin browser client contract. The host application owns authorization,
 * filesystem access, and route implementation; this package never accesses disk.
 */
export interface SetupApiClient {
  detect(signal?: AbortSignal): Promise<SetupDetection>;
  connect(options: SetupOptions, signal?: AbortSignal): Promise<SetupResult>;
  chooseFolder?(signal?: AbortSignal): Promise<SetupDetection>;
  finish?(signal?: AbortSignal): Promise<void>;
}

export type WizardPhase = "detecting" | "review" | "choosing-source" | "missing" | "connecting" | "partial" | "error" | "success";
