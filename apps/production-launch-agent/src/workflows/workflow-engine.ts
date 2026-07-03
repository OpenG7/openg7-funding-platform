import { Checklist, ToolContext, WorkflowReport } from '../types/index.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export class WorkflowEngine {
  constructor(private readonly tools: ToolRegistry) {}

  async run(checklist: Checklist, context: ToolContext): Promise<WorkflowReport> {
    const startedAt = new Date().toISOString();
    const results = [];

    for (const step of checklist.steps) {
      const output = await this.tools.run(
        step.tool,
        context,
        step.params ?? {}
      );
      results.push(output);

      if (!output.success && step.tool !== 'generate_report') {
        context.memory.recordIncident({
          severity: 'warning',
          summary: `${step.tool}: ${output.message}`
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const success = results.every((item) => item.success);
    const report: WorkflowReport = {
      checklist: checklist.name,
      finishedAt,
      recommendations: this.recommend(results),
      results,
      startedAt,
      success
    };

    const paths = await context.reporter.write(report);
    context.memory.recordReport({
      path: paths.markdownPath,
      success,
      summary: success
        ? 'Checklist complétée sans erreur'
        : 'Checklist complétée avec problèmes'
    });

    return report;
  }

  private recommend(
    results: readonly { readonly message: string; readonly success: boolean; readonly tool: string }[]
  ): readonly string[] {
    const failed = results.filter((item) => !item.success);

    if (failed.length === 0) {
      return [
        'Conserver la surveillance des logs Traefik et API après le déploiement.',
        'Vérifier Stripe Dashboard après les premiers paiements réels.'
      ];
    }

    return failed.map(
      (item) => `Analyser ${item.tool}: ${item.message}`
    );
  }
}
