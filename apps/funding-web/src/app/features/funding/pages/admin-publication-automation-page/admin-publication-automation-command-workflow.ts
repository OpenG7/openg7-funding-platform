import type { PublicationAutomationCommand } from '@openg7/funding-core';

import type {
  PublicationAutomationCommandContext,
  PublicationAutomationCommandPorts,
  PublicationAutomationCommandResult,
  PublicationAutomationCommandRunner
} from './publication-automation.ports.js';

/** Local mutation/read lifecycle; navigation, panels and configuration drafts belong to their owners. */
export class AdminPublicationAutomationCommandWorkflow implements PublicationAutomationCommandRunner {
  constructor(private readonly ports: PublicationAutomationCommandPorts) {}

  async run(
    command: PublicationAutomationCommand,
    open = false
  ): Promise<void> {
    const { state } = this.ports;
    if (state.busy()) return;
    const context = this.ports.capture();
    if (!this.ports.isCurrent(context)) return;
    state.busy.set(true);
    state.error.set('');
    state.notice.set('');
    try {
      let result: PublicationAutomationCommandResult;
      try {
        result = await this.ports.api.execute(command);
      } catch (error) {
        if (!this.ports.isCurrent(context)) return;
        await this.refreshAfterFailure(context);
        if (this.ports.isCurrent(context)) this.ports.showError(error);
        return;
      }
      if (!this.ports.isCurrent(context)) return;
      const next = await this.ports.api.read(context.filter);
      if (!this.ports.isCurrent(context)) return;
      this.ports.applyState(next);
      this.ports.confirmed(command, result, next, open);
      state.notice.set(
        command.action === 'prepare'
          ? 'admin.publicationAutomation.settingsPanel.prepared'
          : command.action === 'check'
            ? 'admin.publicationAutomation.settingsPanel.checked'
            : 'admin.publicationAutomation.saved'
      );
    } catch (error) {
      if (this.ports.isCurrent(context)) this.ports.showError(error);
    } finally {
      state.busy.set(false);
    }
  }

  private async refreshAfterFailure(
    context: PublicationAutomationCommandContext
  ): Promise<void> {
    try {
      const next = await this.ports.api.read(context.filter);
      if (this.ports.isCurrent(context)) this.ports.applyState(next);
    } catch {
      // A failed read cannot replace the command error or establish its success.
    }
  }
}
