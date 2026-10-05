import {
  AgentRole,
  ToolContext,
  ToolName,
  ToolResult
} from '../types/index.js';

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

const isRevision = (value: string): boolean =>
  value.length === 40 && /^[a-f0-9]{40}$/.test(value);

const deploy: ToolHandler = (context) =>
  result('deploy', async () => {
    if (!context.execute) {
      const pull = await context.runCommand({ key: 'deploy_pull' });
      const deployment = await context.runCommand({
        key: 'deploy_run',
        params: { sha: '0'.repeat(40) }
      });
      return {
        details: { deployment, pull, simulated: true },
        message: 'Déploiement simulé, aucune version qualifiée',
        success: pull.code === 0 && deployment.code === 0
      };
    }

    const before = await context.runCommand({ key: 'git_current_sha' });
    if (before.code !== 0 || !isRevision(before.stdout.trim())) {
      return {
        details: { before },
        message: 'Révision initiale inconnue',
        success: false
      };
    }
    const pull = await context.runCommand({ key: 'deploy_pull' });
    if (pull.code !== 0) {
      return {
        details: { before, pull },
        message: 'git pull a échoué',
        success: false
      };
    }
    const selected = await context.runCommand({ key: 'git_current_sha' });
    const version = selected.stdout.trim();
    if (selected.code !== 0 || !isRevision(version)) {
      return {
        details: { before, pull, selected },
        message: 'Révision à déployer inconnue',
        success: false
      };
    }
    const deployment = await context.runCommand({
      key: 'deploy_run',
      params: { sha: version }
    });
    if (deployment.code !== 0) {
      return {
        details: { before, deployment, pull, selected, version },
        message: 'Le runner de déploiement a échoué',
        success: false
      };
    }
    const after = await context.runCommand({ key: 'git_current_sha' });
    if (after.code !== 0 || after.stdout.trim() !== version) {
      return {
        details: { after, before, deployment, pull, selected, version },
        message: 'La révision a changé pendant le déploiement',
        success: false
      };
    }
    context.memory.recordDeployment({ status: 'candidate', version });
    return {
      details: {
        after,
        before,
        deployment,
        pull,
        selected,
        qualified: true,
        version
      },
      message: 'Déploiement vérifié, qualification finale par la checklist',
      success: true
    };
  });

const rollback: ToolHandler = (context) =>
  result('rollback', async () => {
    if (!context.execute) {
      const rollback = await context.runCommand({
        key: 'rollback_run',
        params: { sha: '0'.repeat(40) }
      });
      return {
        details: { rollback, simulated: true },
        message: 'Rollback simulé',
        success: rollback.code === 0
      };
    }
    const current = await context.runCommand({ key: 'git_current_sha' });
    if (current.code !== 0 || !isRevision(current.stdout.trim())) {
      return {
        details: { current },
        message: 'Révision actuelle inconnue',
        success: false
      };
    }
    const version = context.memory.lastStableDeployment(current.stdout.trim());
    if (!version || !isRevision(version)) {
      return {
        details: { current },
        message: 'Aucune version stable enregistrée pour rollback',
        success: false
      };
    }
    const rollback = await context.runCommand({
      key: 'rollback_run',
      params: { sha: version }
    });
    return {
      details: { current, rollback, qualified: rollback.code === 0, version },
      message:
        rollback.code === 0 ? `Rollback vers ${version}` : 'Rollback incomplet',
      success: rollback.code === 0
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
    check_cpu: {
      minRole: 'viewer',
      run: commandTool('check_cpu', 'check_cpu')
    },
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
