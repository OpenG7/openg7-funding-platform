import { readFileSync } from 'node:fs';

import YAML from 'yaml';

import { Checklist, ToolName, WorkflowStep } from '../types/index.js';

const toolNames: readonly ToolName[] = [
  'analyze_logs',
  'backup',
  'check_containers',
  'check_cpu',
  'check_disk',
  'check_docker',
  'check_health',
  'check_https',
  'check_memory',
  'check_ssl',
  'deploy',
  'fetch_logs',
  'generate_report',
  'restart_service',
  'rollback'
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isToolName = (value: unknown): value is ToolName =>
  typeof value === 'string' && toolNames.includes(value as ToolName);

const toStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, String(entry)])
  );
};

const parseStep = (value: unknown, index: number): WorkflowStep => {
  if (isToolName(value)) {
    return {
      id: `${index + 1}-${value}`,
      tool: value
    };
  }

  if (!isRecord(value) || !isToolName(value.tool)) {
    throw new Error(`Invalid checklist step at index ${index}`);
  }

  return {
    id: typeof value.id === 'string' ? value.id : `${index + 1}-${value.tool}`,
    params: toStringRecord(value.params),
    tool: value.tool
  };
};

export const loadChecklist = (path: string): Checklist => {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = YAML.parse(raw);

  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    throw new Error(`Invalid checklist file: ${path}`);
  }

  return {
    description:
      typeof parsed.description === 'string' ? parsed.description : undefined,
    name: typeof parsed.name === 'string' ? parsed.name : 'production-launch',
    steps: parsed.steps.map(parseStep)
  };
};
