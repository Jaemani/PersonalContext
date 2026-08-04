export type AgentName = "codex" | "claude";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentConnection {
  nodePath: string;
  runtimePath: string;
}

export interface ExistingAgentConnection {
  command: string;
  args: string[];
  raw: string;
  scope?: string;
  /** False when a CLI's human output cannot be parsed safely enough to restore. */
  rollbackSafe?: boolean;
}

export type AdapterPlanAction = "noop" | "add" | "replace";

export interface AdapterPlan {
  action: AdapterPlanAction;
  desired: ExistingAgentConnection;
  previous: ExistingAgentConnection | null;
  canRollback: boolean;
  inspection: CommandResult;
}

export interface ApplyOptions {
  allowReplace?: boolean;
}

export interface AgentAdapter {
  readonly name: AgentName;
  detect(): Promise<boolean>;
  inspect(): Promise<CommandResult>;
  plan(connection: AgentConnection): Promise<AdapterPlan>;
  apply(
    connection: AgentConnection,
    plan?: AdapterPlan,
    options?: ApplyOptions,
  ): Promise<CommandResult>;
  verify(connection: AgentConnection): Promise<CommandResult>;
  rollback(plan: AdapterPlan): Promise<CommandResult>;
  disconnect(): Promise<CommandResult>;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;
