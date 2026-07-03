import { SshService } from '../ssh/ssh-service.js';
import { CommandRequest, CommandResult } from '../types/index.js';

import { CommandRegistry } from './command-registry.js';

export class CommandExecutor {
  constructor(
    private readonly registry: CommandRegistry,
    private readonly ssh: SshService,
    private readonly execute: boolean
  ) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    const safeCommand = this.registry.create(request);

    if (!this.execute) {
      return {
        command: safeCommand.command,
        code: 0,
        stderr: '',
        stdout: `[dry-run] ${safeCommand.description}`
      };
    }

    return this.ssh.run(safeCommand.command);
  }
}
