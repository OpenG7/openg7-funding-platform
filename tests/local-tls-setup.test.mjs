import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('local TLS setup is exposed as a safe package shortcut', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const script = fs.readFileSync('scripts/setup-local-tls.mjs', 'utf8');

  assert.equal(
    packageJson.scripts['tls:local:setup'],
    'node scripts/setup-local-tls.mjs'
  );
  assert.equal(
    packageJson.scripts['tls:local:renew'],
    'node scripts/setup-local-tls.mjs --renew'
  );
  assert.ok(script.includes("'FiloSottile.mkcert'"));
  assert.ok(script.includes("entry.name.startsWith('FiloSottile.mkcert_')"));
  assert.ok(script.includes("run(mkcert, ['-install'])"));
  assert.ok(script.includes("'docker-compose.local-tls.yml'"));

  const help = spawnSync(
    process.execPath,
    ['scripts/setup-local-tls.mjs', '--help'],
    { encoding: 'utf8' }
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /yarn tls:local:setup/);
  assert.match(help.stdout, /--no-restart/);
});

test('local certificates are mounted only by the local TLS compose override', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const localCompose = fs.readFileSync('docker-compose.local-tls.yml', 'utf8');
  const staticConfig = fs.readFileSync('traefik/traefik.yml', 'utf8');
  const localTls = fs.readFileSync('traefik/local-tls.yml', 'utf8');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');

  assert.ok(
    compose.includes('./traefik/dynamic.yml:/etc/traefik/dynamic/routes.yml:ro')
  );
  assert.equal(compose.includes('local-tls.yml'), false);
  assert.ok(staticConfig.includes('directory: /etc/traefik/dynamic'));
  assert.ok(
    localCompose.includes(
      './traefik/local-tls.yml:/etc/traefik/dynamic/local-tls.yml:ro'
    )
  );
  assert.ok(localCompose.includes('./traefik/certs:/certs:ro'));
  assert.ok(localTls.includes('certFile: /certs/localhost.pem'));
  assert.ok(localTls.includes('keyFile: /certs/localhost-key.pem'));
  assert.ok(gitignore.includes('traefik/certs/*'));
});
