import { NodeSSH } from 'node-ssh';

import { CommandResult, SshConfig } from '../types/index.js';

export class SshService {
  constructor(private readonly config: SshConfig) {}

  async run(command: string): Promise<CommandResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const ssh = new NodeSSH();

      try {
        await ssh.connect({
          host: this.config.host,
          username: this.config.username,
          privateKey: this.config.privateKey,
          privateKeyPath: this.config.privateKeyPath,
          port: this.config.port,
          readyTimeout: this.config.readyTimeoutMs
        });

        const result = await ssh.execCommand(command, {
          execOptions: {
            timeout: this.config.readyTimeoutMs
          }
        });

        ssh.dispose();

        return {
          command,
          code: result.code ?? 0,
          stderr: result.stderr,
          stdout: result.stdout
        };
      } catch (error) {
        ssh.dispose();
        lastError = error;
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown SSH error';
    return {
      command,
      code: 255,
      stderr: message,
      stdout: ''
    };
  }
}
