import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createRecoveryFixture, eventually } from './fixture.mjs';

test('operations overlay delivers signed incidents without HTTP API, survives receiver failure and restart, detects database failure', async ({}, info) => {
  const fixture = await createRecoveryFixture();
  const { source } = fixture;
  try {
    const base = JSON.parse(
      await readFile(join(source.directory, 'docker-compose.yml'), 'utf8')
    );
    const original = await readFile('docker-compose.operations.yml', 'utf8');
    await writeFile(join(source.directory, 'operations.yml'), original);
    // The synthetic loopback receiver runs in the same isolated container; no external webhook.
    const program = `import { createServer } from 'node:http';
      import { createHmac } from 'node:crypto';
      const received = new Map(); let refuse = true; let valid = true;
      const secret = 'synthetic-operations-container-secret';
      const server = createServer(async (req, res) => {
        if (req.url === '/state') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ valid, events: [...received.values()] })); return; }
        if (req.url === '/accept') { refuse = false; res.end(); return; }
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        valid &&= req.headers['x-openg7-signature'] === createHmac('sha256',secret).update(req.headers['x-openg7-timestamp']+'.'+raw).digest('hex');
        if (refuse) { res.writeHead(503).end(); return; }
        received.set(body.eventId,{ eventId: body.eventId, type: body.type }); res.writeHead(204).end();
      });
      await new Promise(resolve => server.listen(9011,'0.0.0.0',resolve));
      process.env.FUNDING_OPERATIONS_WEBHOOK_URL = 'http://127.0.0.1:9011/hook';
      process.env.FUNDING_OPERATIONS_WEBHOOK_SECRET = secret;
      process.on('SIGTERM', () => server.close());
      await import('./scripts/operations-watch.mjs');`;
    await writeFile(
      join(source.directory, 'fixture-operations.json'),
      JSON.stringify({
        services: {
          operations: {
            image: base.services.api.image,
            command: ['node', '--input-type=module', '-e', program],
            environment: {
              NODE_ENV: 'test',
              DATABASE_URL: base.services.api.environment.DATABASE_URL,
              FUNDING_PUBLIC_BASE_URL: source.origin
            },
            ports: ['127.0.0.1::9011'],
            labels: { 'org.openg7.disposable-test': 'true' }
          }
        }
      })
    );
    const compose = (args) =>
      source.compose([
        '-f',
        join(source.directory, 'operations.yml'),
        '-f',
        join(source.directory, 'fixture-operations.json'),
        ...args
      ]);
    await source.compose(['stop', 'api']);
    await source.pool.query(
      "INSERT INTO stripe_events(stripe_event_id,event_type,payload,processing_status) VALUES('evt_worker_fixture','test.operations','{}','failed')"
    );
    await compose(['up', '-d', '--no-deps', 'operations']);
    let address = await compose(['port', 'operations', '9011']);
    expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
    const get = async (path) => {
      const response = await fetch(`http://${address}${path}`, {
        signal: AbortSignal.timeout(3000)
      });
      return response;
    };
    await eventually(() =>
      compose([
        'exec',
        '-T',
        'operations',
        'node',
        'scripts/operations-health.mjs'
      ])
    );
    await eventually(async () =>
      expect(
        (
          await source.pool.query(
            "SELECT attempts FROM operations_alerts WHERE incident_key='stripe:evt_worker_fixture'"
          )
        ).rows[0]?.attempts
      ).toBe(1)
    );
    expect((await (await get('/state')).json()).events).toEqual([]);
    await get('/accept');
    await source.pool.query(
      'UPDATE operations_alerts SET next_attempt_at=now()'
    );
    await eventually(async () =>
      expect((await (await get('/state')).json()).events).toHaveLength(1)
    );
    const alert = (
      await source.pool.query('SELECT id,delivered_at FROM operations_alerts')
    ).rows[0];
    expect(alert.delivered_at).toBeTruthy();
    expect((await (await get('/state')).json()).valid).toBe(true);
    await compose(['restart', 'operations']);
    address = await compose(['port', 'operations', '9011']);
    await eventually(() =>
      compose([
        'exec',
        '-T',
        'operations',
        'node',
        'scripts/operations-health.mjs'
      ])
    );
    await eventually(() => get('/accept'));
    expect((await (await get('/state')).json()).events).toEqual([]);
    expect(
      (
        await source.pool.query(
          'SELECT attempts FROM operations_alerts WHERE id=$1',
          [alert.id]
        )
      ).rows[0].attempts
    ).toBe(2);
    await source.pool.end();
    source.pool = null;
    await source.compose(['stop', 'postgres']);
    await expect(
      compose([
        'exec',
        '-T',
        'operations',
        'node',
        'scripts/operations-health.mjs'
      ])
    ).rejects.toThrow();
    await eventually(async () =>
      expect(
        (await (await get('/state')).json()).events.some(
          (event) => event.type === 'operations_database_unavailable'
        )
      ).toBe(true)
    );
    await source.compose(['up', '-d', '--no-deps', 'postgres']);
    await source.connect();
    await eventually(() =>
      compose([
        'exec',
        '-T',
        'operations',
        'node',
        'scripts/operations-health.mjs'
      ])
    );
    const container = await compose(['ps', '-q', 'operations']);
    await eventually(async () =>
      expect(
        await fixture.docker([
          'inspect',
          '--format',
          '{{.State.Health.Status}}',
          container
        ])
      ).toBe('healthy')
    );
    expect(
      (
        await source.compose(['ps', '--services', '--filter', 'status=running'])
      ).split('\n')
    ).not.toContain('api');
    await info.attach('operations-recovery', {
      body: JSON.stringify({
        signed: true,
        apiStopped: true,
        receiverRetry: true,
        databaseRecovery: true,
        deliveredEventId: alert.id
      }),
      contentType: 'application/json'
    });
  } finally {
    await fixture.stop();
  }
});
