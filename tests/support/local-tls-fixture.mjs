import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Synthetic certificates only; no host CA, trust store or mkcert is used. */
export function createLocalTlsFixture(
  root,
  { hosts = ['localhost', 'auth.openg7.test'] } = {}
) {
  const candidates = [
    'openssl',
    ...(process.platform === 'win32'
      ? ['C:/Program Files/Git/usr/bin/openssl.exe']
      : [])
  ];
  const openssl = candidates.find(
    (command) =>
      spawnSync(command, ['version'], { stdio: 'ignore', windowsHide: true })
        .status === 0
  );
  if (!openssl)
    throw new Error('OpenSSL is required for synthetic local TLS tests.');
  const caRoot = join(root, 'synthetic-ca');
  const certificateDirectory = join(root, 'traefik', 'certs');
  mkdirSync(caRoot, { recursive: true });
  mkdirSync(certificateDirectory, { recursive: true });
  const caPath = join(caRoot, 'rootCA.pem');
  const caKey = join(caRoot, 'synthetic-ca-key.pem');
  const certificatePath = join(certificateDirectory, 'localhost.pem');
  const keyPath = join(certificateDirectory, 'localhost-key.pem');
  const csr = join(caRoot, 'leaf.csr');
  const extensions = join(caRoot, 'leaf.ext');
  const run = (args) => {
    if (
      spawnSync(openssl, args, {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 15000
      }).status !== 0
    )
      throw new Error('Synthetic TLS certificate generation failed.');
  };
  run([
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=OpenG7 synthetic test CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    caKey,
    '-out',
    caPath
  ]);
  run([
    'req',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    keyPath,
    '-out',
    csr
  ]);
  writeFileSync(
    extensions,
    `basicConstraints=CA:FALSE\nsubjectAltName=${hosts.map((host) => 'DNS:' + host).join(',')},IP:127.0.0.1,IP:::1\n`
  );
  run([
    'x509',
    '-req',
    '-days',
    '2',
    '-in',
    csr,
    '-CA',
    caPath,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-extfile',
    extensions,
    '-out',
    certificatePath
  ]);
  copyFileSync(caPath, join(certificateDirectory, 'rootCA.pem'));
  return { caRoot, caPath, certificateDirectory, certificatePath, keyPath };
}
