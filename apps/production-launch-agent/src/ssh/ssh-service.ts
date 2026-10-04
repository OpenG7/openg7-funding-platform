import { NodeSSH } from 'node-ssh';

import { CommandResult, SshConfig } from '../types/index.js';

interface SshClient {
  connect(config: Parameters<NodeSSH['connect']>[0]): Promise<unknown>;
  execCommand: NodeSSH['execCommand'];
  dispose(): void;
}

export class SshService {
  constructor(
    private readonly config: SshConfig,
    private readonly createClient: () => SshClient = () => new NodeSSH()
  ) {}

  async run(command: string): Promise<CommandResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const ssh = this.createClient();
      let executionStarted = false;

      try {
        await ssh.connect({
          host: this.config.host,
          username: this.config.username,
          privateKey: this.config.privateKey,
          privateKeyPath: this.config.privateKeyPath,
          port: this.config.port,
          readyTimeout: this.config.readyTimeoutMs
        });

        executionStarted = true;
        const result = await ssh.execCommand(command, {
          execOptions: {
            timeout: this.config.readyTimeoutMs
          }
        });

        return {
          command,
          code: result.signal ? 255 : (result.code ?? 255),
          stderr: result.stderr,
          stdout: result.stdout
        };
      } catch (error) {
        if (executionStarted) {
          return {
            command,
            code: 255,
            stderr:
              'SSH command result is uncertain; reconcile the remote result before retrying.',
            stdout: ''
          };
        }
        lastError = error;
      } finally {
        ssh.dispose();
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
