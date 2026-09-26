import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// Only fixed fixture images; never reads .env, mounts a host path or names a persistent volume.
export async function startDisposableProvider(kind) {
  const configurations = {
    mail: {
      image: 'axllent/mailpit:v1.27.4',
      ports: [8025, 1025],
      env: [
        'MP_SMTP_AUTH_ACCEPT_ANY=1',
        'MP_SMTP_AUTH_ALLOW_INSECURE=1',
        // A synthetic sender needs no reverse DNS; Docker PTR lookups can delay the greeting.
        'MP_SMTP_DISABLE_RDNS=1'
      ]
    },
    s3: { image: 'adobe/s3mock:5.1.0', ports: [9090], env: [] }
  };
  const config = configurations[kind];
  if (!config) throw new Error('Unknown fixture provider');
  const run = async (args) =>
    (
      await exec('docker', args, {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      })
    ).stdout.trim();
  const context = await run(['context', 'show']);
  const endpoint = await run([
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!/^(npipe|unix):\/\//.test(endpoint))
    throw new Error('Provider rehearsal requires a local Docker socket.');
  const docker = (args) => run(['--context', context, ...args]);
  await docker(['image', 'inspect', config.image, '--format', '{{.Id}}']);
  const id = await docker([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    `og7-provider-test-${randomUUID()}`,
    '--label',
    'org.openg7.disposable-test=true',
    '--memory',
    '512m',
    ...config.ports.flatMap((port) => ['--publish', `127.0.0.1::${port}`]),
    ...config.env.flatMap((value) => ['--env', value]),
    config.image
  ]);
  const stop = () => docker(['rm', '--force', id]);
  try {
    const ports = {};
    for (const port of config.ports) {
      const match = /^127\.0\.0\.1:(\d+)$/.exec(
        await docker(['port', id, `${port}/tcp`])
      );
      if (!match) throw new Error('Fixture port must bind to loopback.');
      ports[port] = Number(match[1]);
    }
    return { ports, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
