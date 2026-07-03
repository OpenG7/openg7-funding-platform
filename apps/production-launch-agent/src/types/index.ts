export type ToolName =
  | 'analyze_logs'
  | 'backup'
  | 'check_containers'
  | 'check_cpu'
  | 'check_disk'
  | 'check_docker'
  | 'check_health'
  | 'check_https'
  | 'check_memory'
  | 'check_ssl'
  | 'deploy'
  | 'fetch_logs'
  | 'generate_report'
  | 'restart_service'
  | 'rollback';

export type AgentRole = 'admin' | 'operator' | 'viewer';

export interface AgentConfig {
  readonly appDir: string;
  readonly databasePath: string;
  readonly defaultChecklistPath: string;
  readonly domain: string;
  readonly healthPath: string;
  readonly openAiApiKey?: string;
  readonly reportDir: string;
  readonly role: AgentRole;
  readonly ssh: SshConfig;
}

export interface SshConfig {
  readonly host: string;
  readonly username: string;
  readonly privateKey?: string;
  readonly privateKeyPath?: string;
  readonly port: number;
  readonly readyTimeoutMs: number;
  readonly retries: number;
}

export interface ToolContext {
  readonly config: AgentConfig;
  readonly execute: boolean;
  readonly memory: MemoryStore;
  readonly reporter: Reporter;
  readonly runCommand: (request: CommandRequest) => Promise<CommandResult>;
}

export interface CommandRequest {
  readonly key: CommandKey;
  readonly params?: Record<string, string>;
}

export type CommandKey =
  | 'backup'
  | 'check_containers'
  | 'check_cpu'
  | 'check_disk'
  | 'check_docker'
  | 'check_health'
  | 'check_https'
  | 'check_memory'
  | 'check_ssl'
  | 'deploy_build'
  | 'deploy_pull'
  | 'deploy_up'
  | 'fetch_logs'
  | 'git_checkout'
  | 'git_current_sha'
  | 'restart_service';

export interface CommandResult {
  readonly command: string;
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ToolResult {
  readonly details: Record<string, unknown>;
  readonly durationMs: number;
  readonly finishedAt: string;
  readonly message: string;
  readonly startedAt: string;
  readonly success: boolean;
  readonly tool: ToolName;
}

export interface WorkflowStep {
  readonly id?: string;
  readonly tool: ToolName;
  readonly params?: Record<string, string>;
}

export interface Checklist {
  readonly description?: string;
  readonly name: string;
  readonly steps: readonly WorkflowStep[];
}

export interface WorkflowReport {
  readonly checklist: string;
  readonly finishedAt: string;
  readonly recommendations: readonly string[];
  readonly startedAt: string;
  readonly success: boolean;
  readonly results: readonly ToolResult[];
}

export interface MemoryStore {
  recordAction(input: {
    readonly action: string;
    readonly durationMs: number;
    readonly result: string;
    readonly success: boolean;
    readonly user: string;
  }): void;
  recordDeployment(input: {
    readonly status: string;
    readonly version: string;
  }): void;
  recordIncident(input: {
    readonly severity: string;
    readonly summary: string;
  }): void;
  recordReport(input: {
    readonly path: string;
    readonly success: boolean;
    readonly summary: string;
  }): void;
  lastStableDeployment(): string | null;
  close(): void;
}

export interface Reporter {
  write(report: WorkflowReport): Promise<{
    readonly jsonPath: string;
    readonly markdownPath: string;
  }>;
}
