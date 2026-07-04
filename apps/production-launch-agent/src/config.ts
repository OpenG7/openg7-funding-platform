import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AgentConfig, AgentRole } from './types/index.js';

const readOptionalFile = (path: string | undefined): string | undefined => {
  if (!path) {
    return undefined;
  }

  return readFileSync(resolve(path), 'utf8');
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toRole = (value: string | undefined): AgentRole => {
  if (value === 'admin' || value === 'operator' || value === 'viewer') {
    return value;
  }

  return 'viewer';
};

const runsFromWorkspace = (): boolean =>
  process.cwd().replace(/\\/g, '/').endsWith('/apps/production-launch-agent');

const defaultPath = (workspacePath: string, repositoryPath: string): string =>
  runsFromWorkspace() ? workspacePath : repositoryPath;

export const loadConfig = (): AgentConfig => {
  const privateKeyPath = process.env.PLA_PRIVATE_KEY_PATH;

  return {
    appDir: process.env.PLA_APP_DIR ?? '/opt/openg7-funding-platform',
    databasePath:
      process.env.PLA_DATABASE_PATH ??
      defaultPath(
        'database/production-launch-agent.sqlite',
        'apps/production-launch-agent/database/production-launch-agent.sqlite'
      ),
    defaultChecklistPath:
      process.env.PLA_CHECKLIST ??
      defaultPath(
        'checklists/production-launch-checklist.yaml',
        'apps/production-launch-agent/checklists/production-launch-checklist.yaml'
      ),
    domain: process.env.PLA_DOMAIN ?? 'openg7.org',
    healthPath: process.env.PLA_HEALTH_PATH ?? '/health',
    openAiApiKey: process.env.OPENAI_API_KEY,
    reportDir:
      process.env.PLA_REPORT_DIR ??
      defaultPath(
        'logs/reports',
        'apps/production-launch-agent/logs/reports'
      ),
    role: toRole(process.env.PLA_ROLE),
    ssh: {
      host: process.env.PLA_SSH_HOST ?? 'vps-8db0cb49.vps.ovh.ca',
      username: process.env.PLA_SSH_USER ?? 'ubuntu',
      privateKey:
        process.env.PLA_PRIVATE_KEY ?? readOptionalFile(privateKeyPath),
      privateKeyPath,
      port: toNumber(process.env.PLA_SSH_PORT, 22),
      readyTimeoutMs: toNumber(process.env.PLA_SSH_TIMEOUT_MS, 20000),
      retries: toNumber(process.env.PLA_SSH_RETRIES, 2)
    }
  };
};
