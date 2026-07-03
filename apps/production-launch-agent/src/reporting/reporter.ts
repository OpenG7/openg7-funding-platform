import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Reporter, ToolResult, WorkflowReport } from '../types/index.js';

const sanitizeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '');

const formatTool = (result: ToolResult): string =>
  `| ${result.tool} | ${result.success ? 'OK' : 'FAIL'} | ${result.durationMs} ms | ${result.message.replace(/\|/g, '\\|')} |`;

export class FileReporter implements Reporter {
  constructor(private readonly reportDir: string) {}

  async write(report: WorkflowReport): Promise<{
    readonly jsonPath: string;
    readonly markdownPath: string;
  }> {
    mkdirSync(this.reportDir, { recursive: true });
    const stamp = report.finishedAt.replace(/[:.]/g, '-');
    const base = `${stamp}-${sanitizeName(report.checklist)}`;
    const jsonPath = join(this.reportDir, `${base}.json`);
    const markdownPath = join(this.reportDir, `${base}.md`);

    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(markdownPath, this.toMarkdown(report), 'utf8');

    return { jsonPath, markdownPath };
  }

  private toMarkdown(report: WorkflowReport): string {
    const recommendations =
      report.recommendations.length > 0
        ? report.recommendations.map((item) => `- ${item}`).join('\n')
        : '- Aucune recommandation critique.';

    return [
      `# Rapport ${report.checklist}`,
      '',
      `- Succès: ${report.success ? 'oui' : 'non'}`,
      `- Début: ${report.startedAt}`,
      `- Fin: ${report.finishedAt}`,
      '',
      '## Résultats',
      '',
      '| Outil | État | Durée | Message |',
      '| --- | --- | ---: | --- |',
      ...report.results.map(formatTool),
      '',
      '## Recommandations',
      '',
      recommendations,
      ''
    ].join('\n');
  }
}
