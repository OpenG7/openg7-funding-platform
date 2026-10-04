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
    const fingerprint = this.config.hostFingerprint;
    if (!fingerprint || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
      return {
        command,
        code: 255,
        stderr:
          'A verified SHA256 SSH host fingerprint is required before connecting.',
        stdout: ''
      };
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const ssh = this.createClient();
      let executionStarted = false;

      try {
        await ssh.connect({
          host: this.config.host,
          hostHash: 'sha256',
          hostVerifier: (hash: string) =>
            /^[a-f0-9]{64}$/i.test(hash) &&
            `SHA256:${Buffer.from(hash, 'hex').toString('base64').replace(/=+$/, '')}` ===
              fingerprint,
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
