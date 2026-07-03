import { AgentRole, ToolContext, ToolName, ToolResult } from '../types/index.js';

type ToolHandler = (
  context: ToolContext,
  params: Record<string, string>
) => Promise<ToolResult>;

interface RegisteredTool {
  readonly minRole: AgentRole;
  readonly run: ToolHandler;
}

const roleLevel: Record<AgentRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2
};

const result = async (
  tool: ToolName,
  action: () => Promise<{
    readonly details?: Record<string, unknown>;
    readonly message: string;
    readonly success: boolean;
  }>
): Promise<ToolResult> => {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  try {
    const output = await action();
    const finished = Date.now();
    return {
      details: output.details ?? {},
      durationMs: finished - started,
      finishedAt: new Date(finished).toISOString(),
      message: output.message,
      startedAt,
      success: output.success,
      tool
    };
  } catch (error) {
    const finished = Date.now();
    return {
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      durationMs: finished - started,
      finishedAt: new Date(finished).toISOString(),
      message: error instanceof Error ? error.message : 'Tool failed',
      startedAt,
      success: false,
      tool
    };
  }
};

const commandTool = (
  tool: ToolName,
  key:
    | 'backup'
    | 'check_containers'
    | 'check_cpu'
    | 'check_disk'
    | 'check_docker'
    | 'check_health'
    | 'check_https'
    | 'check_memory'
    | 'check_ssl'
    | 'fetch_logs'
    | 'restart_service'
): ToolHandler => {
  return (context, params) =>
    result(tool, async () => {
      const command = await context.runCommand({ key, params });
      return {
        details: {
          code: command.code,
          command: command.command,
          stderr: command.stderr,
          stdout: command.stdout
        },
        message:
          command.code === 0
            ? `${tool} terminé`
            : `${tool} a échoué avec le code ${command.code}`,
        success: command.code === 0
      };
    });
};

const analyzeLogs: ToolHandler = (context, params) =>
  result('analyze_logs', async () => {
    const service = params.service ?? 'api';
    const command = await context.runCommand({
      key: 'fetch_logs',
      params: { service }
    });
    const combined = `${command.stdout}\n${command.stderr}`;
    const suspicious = [
      'error',
      'exception',
      'failed',
      'panic',
      'timeout',
      'unauthorized'
    ].filter((token) => combined.toLowerCase().includes(token));

    return {
      details: {
        command: command.command,
        suspicious,
        tail: combined.slice(-4000)
      },
      message:
        suspicious.length > 0
          ? `Signaux à vérifier: ${suspicious.join(', ')}`
          : 'Aucun signal critique détecté dans les logs récents',
      success: command.code === 0
    };
  });

const deploy: ToolHandler = (context) =>
  result('deploy', async () => {
    const before = await context.runCommand({ key: 'git_current_sha' });
    if (before.code === 0 && before.stdout.trim()) {
      context.memory.recordDeployment({
        status: 'previous',
        version: before.stdout.trim()
      });
    }

    const pull = await context.runCommand({ key: 'deploy_pull' });
    if (pull.code !== 0) {
      return {
        details: { pull },
        message: 'git pull a échoué',
        success: false
      };
    }

    const build = await context.runCommand({ key: 'deploy_build' });
    if (build.code !== 0) {
      return {
        details: { build, pull },
        message: 'docker compose build a échoué',
        success: false
      };
    }

    const up = await context.runCommand({ key: 'deploy_up' });
    const after = await context.runCommand({ key: 'git_current_sha' });
    if (up.code === 0 && after.code === 0 && after.stdout.trim()) {
      context.memory.recordDeployment({
        status: 'stable',
        version: after.stdout.trim()
      });
    }

    return {
      details: { after, before, build, pull, up },
      message: up.code === 0 ? 'Déploiement terminé' : 'docker compose up a échoué',
      success: up.code === 0
    };
  });

const rollback: ToolHandler = (context) =>
  result('rollback', async () => {
    const version = context.memory.lastStableDeployment();
    if (!version) {
      return {
        details: {},
        message: 'Aucune version stable enregistrée pour rollback',
        success: false
      };
    }

    const checkout = await context.runCommand({
      key: 'git_checkout',
      params: { sha: version }
    });
    if (checkout.code !== 0) {
      return {
        details: { checkout, version },
        message: 'Checkout de la version stable impossible',
        success: false
      };
    }

    const build = await context.runCommand({ key: 'deploy_build' });
    const up = await context.runCommand({ key: 'deploy_up' });
    return {
      details: { build, checkout, up, version },
      message: up.code === 0 ? `Rollback vers ${version}` : 'Rollback incomplet',
      success: build.code === 0 && up.code === 0
    };
  });

const generateReport: ToolHandler = (context) =>
  result('generate_report', async () => ({
    details: {
      reportDir: context.config.reportDir
    },
    message: 'Le rapport final est généré par le workflow',
    success: true
  }));

export class ToolRegistry {
  private readonly tools: Record<ToolName, RegisteredTool> = {
    analyze_logs: { minRole: 'viewer', run: analyzeLogs },
    backup: { minRole: 'operator', run: commandTool('backup', 'backup') },
    check_containers: {
      minRole: 'viewer',
      run: commandTool('check_containers', 'check_containers')
    },
    check_cpu: { minRole: 'viewer', run: commandTool('check_cpu', 'check_cpu') },
    check_disk: {
      minRole: 'viewer',
      run: commandTool('check_disk', 'check_disk')
    },
    check_docker: {
      minRole: 'viewer',
      run: commandTool('check_docker', 'check_docker')
    },
    check_health: {
      minRole: 'viewer',
      run: commandTool('check_health', 'check_health')
    },
    check_https: {
      minRole: 'viewer',
      run: commandTool('check_https', 'check_https')
    },
    check_memory: {
      minRole: 'viewer',
      run: commandTool('check_memory', 'check_memory')
    },
    check_ssl: {
      minRole: 'viewer',
      run: commandTool('check_ssl', 'check_ssl')
    },
    deploy: { minRole: 'operator', run: deploy },
    fetch_logs: {
      minRole: 'viewer',
      run: commandTool('fetch_logs', 'fetch_logs')
    },
    generate_report: { minRole: 'viewer', run: generateReport },
    restart_service: {
      minRole: 'operator',
      run: commandTool('restart_service', 'restart_service')
    },
    rollback: { minRole: 'admin', run: rollback }
  };

  async run(
    tool: ToolName,
    context: ToolContext,
    params: Record<string, string> = {}
  ): Promise<ToolResult> {
    const registered = this.tools[tool];

    if (roleLevel[context.config.role] < roleLevel[registered.minRole]) {
      return result(tool, async () => ({
        details: {
          requiredRole: registered.minRole,
          role: context.config.role
        },
        message: `RBAC: rôle insuffisant pour ${tool}`,
        success: false
      }));
    }

    const output = await registered.run(context, params);
    context.memory.recordAction({
      action: tool,
      durationMs: output.durationMs,
      result: output.message,
      success: output.success,
      user: context.config.role
    });
    return output;
  }
}
