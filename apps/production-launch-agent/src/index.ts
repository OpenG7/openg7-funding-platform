import { CommandExecutor } from './commands/command-executor.js';
import { CommandRegistry } from './commands/command-registry.js';
import { loadConfig } from './config.js';
import { ProductionLaunchAgent } from './agent/production-launch-agent.js';
import { FileReporter } from './reporting/reporter.js';
import { SqliteMemoryStore } from './memory/sqlite-memory.js';
import { SshService } from './ssh/ssh-service.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { ToolContext } from './types/index.js';
import { loadChecklist } from './workflows/checklist-loader.js';
import { WorkflowEngine } from './workflows/workflow-engine.js';

interface CliArgs {
  readonly checklistPath?: string;
  readonly execute: boolean;
  readonly request?: string;
}

const parseArgs = (argv: readonly string[]): CliArgs => {
  let checklistPath: string | undefined;
  let execute = false;
  let request: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--execute') {
      execute = true;
      continue;
    }

    if (arg === '--checklist') {
      checklistPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--request') {
      request = argv[index + 1];
      index += 1;
    }
  }

  return { checklistPath, execute, request };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const checklist = loadChecklist(args.checklistPath ?? config.defaultChecklistPath);
  const agent = new ProductionLaunchAgent(config.openAiApiKey);
  const plannedChecklist = args.request
    ? await agent.plan(args.request, checklist)
    : checklist;

  const memory = new SqliteMemoryStore(config.databasePath);
  const reporter = new FileReporter(config.reportDir);
  const registry = new CommandRegistry(
    config.appDir,
    config.domain,
    config.healthPath
  );
  const ssh = new SshService(config.ssh);
  const executor = new CommandExecutor(registry, ssh, args.execute);
  const tools = new ToolRegistry();
  const workflow = new WorkflowEngine(tools);

  const context: ToolContext = {
    config,
    execute: args.execute,
    memory,
    reporter,
    runCommand: (request) => executor.run(request)
  };

  try {
    const report = await workflow.run(plannedChecklist, context);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.success ? 0 : 1;
  } finally {
    memory.close();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exitCode = 1;
});
