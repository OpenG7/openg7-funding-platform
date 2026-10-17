import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { probeHttpWithContinue } from '../support/http-continue-probe.mjs';

const exec = promisify(execFile);
const root = new URL('../../', import.meta.url);
const images = [
  'node:22-bookworm-slim',
  'nginxinc/nginx-unprivileged:1.27-alpine',
  'traefik:v3.7.13'
];

test(
  'admin logo proxies pass 512 KiB multipart, reject oversized envelopes and retain other route limits',
  { timeout: 90000 },
  async (t) => {
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
    assert.match(
      endpoint,
      /^(?:npipe|unix):\/\//,
      'Local Docker socket required'
    );
    const docker = (args) => run(['--context', context, ...args]);
    assert.equal(await docker(['info', '--format', '{{.OSType}}']), 'linux');
    for (const image of images)
      await docker(['image', 'inspect', image, '--format', '{{.Id}}']);

    const fixture = await mkdtemp(join(tmpdir(), 'og7-logo-proxies-'));
    const network = 'og7-logo-proxies-' + randomUUID();
    const containers = [];
    let networkAttempted = false;
    const removeOwned = async (kind, name) => {
      assert.ok(name === network || name.startsWith(network + '-'));
      const missing = (error) =>
        /No such (?:object|container|network)/i.test(error.stderr ?? '');
      const label = kind === 'container' ? '.Config.Labels' : '.Labels';
      let owner;
      try {
        owner = await docker([
          kind,
          'inspect',
          name,
          '--format',
          `{{index ${label} "org.openg7.disposable-test"}}`
        ]);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      assert.equal(
        owner,
        'true',
        'Only this disposable fixture may be removed'
      );
      try {
        await docker([
          kind,
          'rm',
          ...(kind === 'container' ? ['--force'] : []),
          name
        ]);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    };
    t.after(async () => {
      const removed = await Promise.allSettled(
        containers.map((name) => removeOwned('container', name))
      );
      const failures = removed
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      if (networkAttempted) {
        try {
          await removeOwned('network', network);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          'Disposable proxy cleanup failed; retain fixture files for recovery'
        );
      assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
      await rm(fixture, { recursive: true, force: true });
    });
    // Only proxies publish loopback ports. No .env or provider is consumed.
    networkAttempted = true;
    await docker([
      'network',
      'create',
      '--label',
      'org.openg7.disposable-test=true',
      network
    ]);
    await mkdir(join(fixture, 'api'));
    await writeFile(
      join(fixture, 'api', 'server.mjs'),
      `
import {createServer} from 'node:http';
createServer(async (req,res)=>{
  if(req.url==='/health'){res.end('ok');return;}
  // Drain the fixture body before closing an upstream connection on rejection.
  // Otherwise an early 401 can race Nginx's buffered upload and become a 502.
  let bytes=0;for await(const chunk of req)bytes+=chunk.length;
  if(req.headers.authorization!=='Bearer synthetic-proxy-test'){
    res.writeHead(401);res.end('Synthetic API authorization required');return;
  }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({bytes,path:req.url,authorizationChecked:true}));
}).listen(3333,'0.0.0.0');
`
    );
    const canonical = await readFile(
      new URL('traefik/dynamic.yml', root),
      'utf8'
    );
    // Exercise canonical routing/middleware via isolated HTTP; production TLS stays intact.
    const dynamic = canonical
      .replace(/\r\n/g, '\n')
      .replace(
        /^ {6}tls:(?: \{\})?\n(?: {8}certResolver: letsencrypt\n)?/gm,
        ''
      );
    await writeFile(join(fixture, 'dynamic.yml'), dynamic);
    const start = async (alias, image, args, mounts = [], publish = false) => {
      // Record the unique target before starting, including an uncertain Docker reply.
      const name = network + '-' + alias;
      containers.push(name);
      await docker([
        'run',
        '--detach',
        '--pull',
        'never',
        '--name',
        name,
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--network',
        network,
        '--network-alias',
        alias,
        '--label',
        'org.openg7.disposable-test=true',
        ...mounts.flatMap(([source, target]) => [
          '--mount',
          `type=bind,source=${source},target=${target},readonly`
        ]),
        ...(publish ? ['--publish', '127.0.0.1::8080'] : []),
        '--entrypoint',
        alias === 'api' ? 'node' : alias === 'web' ? 'nginx' : 'traefik',
        image,
        ...args
      ]);
      if (!publish) return null;
      let binding;
      try {
        binding = await docker(['port', name, '8080/tcp']);
      } catch {
        const logs = await docker(['logs', name]);
        throw new Error(
          `Disposable ${alias} did not publish its port: ${logs}`
        );
      }
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      return 'http://' + binding;
    };
    await start(
      'api',
      images[0],
      ['/fixture/server.mjs'],
      [[join(fixture, 'api'), '/fixture']]
    );
    const nginx = await start(
      'web',
      images[1],
      ['-g', 'daemon off;'],
      [
        [
          resolve('apps/funding-web/nginx.conf'),
          '/etc/nginx/conf.d/default.conf'
        ]
      ],
      true
    );
    const traefik = await start(
      'proxy',
      images[2],
      [
        '--entrypoints.websecure.address=:8080',
        '--providers.file.filename=/fixture/dynamic.yml',
        '--providers.file.watch=false',
        '--log.level=ERROR',
        '--accesslog=false'
      ],
      [[join(fixture, 'dynamic.yml'), '/fixture/dynamic.yml']],
      true
    );
    const probe = (
      base,
      path,
      body = 'small',
      authenticated = true,
      host = 'localhost'
    ) =>
      probeHttpWithContinue(base + path, {
        body,
        headers: {
          Host: host,
          ...(authenticated
            ? { Authorization: 'Bearer synthetic-proxy-test' }
            : {}),
          'Content-Type':
            typeof body === 'string'
              ? 'application/json'
              : 'multipart/form-data; boundary=synthetic-boundary'
        }
      });
    for (const base of [nginx, traefik]) {
      const readyBy = Date.now() + 25000;
      while (true) {
        try {
          const response = await probe(base, '/api/fixture');
          if (response.status === 200) break;
        } catch {}
        assert.ok(Date.now() < readyBy, 'Disposable proxy must become ready');
        await setTimeout(200);
      }
      await t.test(base === nginx ? 'Nginx' : 'Traefik', async () => {
        const header = Buffer.from(
          '--synthetic-boundary\r\nContent-Disposition: form-data; name="logo"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n'
        );
        const trailer = Buffer.from('\r\n--synthetic-boundary--\r\n');
        const body = Buffer.concat([header, Buffer.alloc(512 * 1024), trailer]);
        const accepted = await probe(
          base,
          '/api/admin/sponsorships/logo',
          body
        );
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), {
          bytes: body.length,
          path: '/api/admin/sponsorships/logo',
          authorizationChecked: true
        });
        assert.equal(
          (await probe(base, '/api/admin/sponsorships/logo', body, false))
            .status,
          401
        );
        assert.equal(
          (
            await probe(
              base,
              '/api/admin/sponsorships/logo',
              Buffer.alloc(589824 + 1)
            )
          ).status,
          413
        );
        if (base === traefik) {
          // Production host rules use the same bounded policy; DNS remains local.
          for (const host of ['openg7.org', 'www.openg7.org']) {
            assert.equal(
              (
                await probe(
                  base,
                  '/api/admin/sponsorships/logo',
                  body,
                  true,
                  host
                )
              ).status,
              200
            );
            assert.equal(
              (
                await probe(
                  base,
                  '/api/admin/sponsorships/logo',
                  Buffer.alloc(589824 + 1),
                  true,
                  host
                )
              ).status,
              413
            );
          }
        }
        for (const path of [
          '/api/checkout-sessions',
          '/api/admin/sponsorships/logo/delete',
          '/api/admin/sponsorships/logo/extra'
        ]) {
          assert.equal(
            (await probe(base, path, Buffer.alloc(300 * 1024))).status,
            413
          );
        }
      });
    }
  }
);
