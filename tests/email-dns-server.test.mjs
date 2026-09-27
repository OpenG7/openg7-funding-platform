import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { startEmailDnsServer } from './support/email-dns-server.mjs';

for (const transport of ['tcp', 'udp']) {
  test(`DNS fixture retries a port occupied by ${transport} and serves queries`, async (t) => {
    const blocker =
      transport === 'tcp' ? net.createServer() : dgram.createSocket('udp4');
    if (transport === 'tcp') blocker.listen(0, '127.0.0.1');
    else blocker.bind(0, '127.0.0.1');
    await once(blocker, 'listening');
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    const occupied = blocker.address().port;
    let attempts = 0;
    const dns = await startEmailDnsServer(
      t,
      {
        'fixture.example.test': { txt: [['synthetic fixture']] }
      },
      {
        choosePort: () =>
          attempts++ === 0 ? occupied : randomInt(49152, 65536)
      }
    );
    assert.ok(attempts > 1);
    const resolver = new Resolver({ timeout: 1000, tries: 1 });
    t.after(() => resolver.cancel());
    resolver.setServers([dns.server]);
    assert.deepEqual(await resolver.resolveTxt('fixture.example.test'), [
      ['synthetic fixture']
    ]);
  });
}

test('DNS fixture bounds port retries and reports failure instead of hanging', async (t) => {
  const blocker = net.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  let attempts = 0;
  await assert.rejects(
    startEmailDnsServer(
      t,
      {},
      {
        choosePort: () => {
          attempts++;
          return blocker.address().port;
        }
      }
    ),
    { code: 'EADDRINUSE' }
  );
  assert.equal(attempts, 32);
});
