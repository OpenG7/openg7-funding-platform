import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminContributionsController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-controller.js';
import { AdminContributionsExportWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-export-workflow.js';
import { adminContributionsBrowser } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-browser.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const rows = () => [
  {
    id: '10000000-0000-4000-8000-000000000301',
    public_name: 'Selected synthetic contributor',
    updated_at: '2026-10-04T12:00:00.123456Z'
  },
  {
    id: '10000000-0000-4000-8000-000000000302',
    public_name: 'Other synthetic contributor',
    updated_at: '2026-10-04T12:00:00.654321Z'
  }
];
const fixture = async () => {
  const downloads = [];
  const requests = [];
  const confirmations = [];
  let access = true;
  let token = 'synthetic-session';
  let sessionRevision = 0;
  const contributions = rows();
  const readPorts = {
    admin: {
      getContributions: async () => ({ contributions }),
      saveAdminToken: () => {}
    },
    token: () => token,
    canExport: () => access,
    accessRevision: () => sessionRevision,
    unauthorized: () => {}
  };
  const controller = new AdminContributionsController(readPorts);
  await controller.load();
  const ports = {
    admin: {
      getContributionsCsv: async (token, payload) => {
        requests.push({ token, payload });
        return 'synthetic,csv\n';
      }
    },
    confirmation: {
      confirm: async (message) => {
        confirmations.push(message);
        return true;
      }
    },
    token: () => token,
    ready: () => controller.state() === 'ready',
    scopeRevision: () => controller.exportScopeRevision() + sessionRevision,
    canExport: () => access,
    contributions: () => controller.filteredContributions(),
    t: (key, params) => `${key}:${params.count}`,
    saveCsv: (csv) => downloads.push(csv)
  };
  return {
    controller,
    workflow: new AdminContributionsExportWorkflow(ports),
    ports,
    contributions,
    requests,
    confirmations,
    downloads,
    setAccess: (value) => {
      access = value;
      controller.notifyAccessChanged();
    },
    resetSession: () => ++sessionRevision,
    setToken: (value) => {
      token = value;
      controller.invalidateExportScope();
    }
  };
};

test('export freezes the exact filtered ids and microsecond versions before confirmation', async () => {
  const f = await fixture();
  f.controller.setSearch('selected');
  const confirmation = deferred();
  f.ports.confirmation.confirm = (message) => {
    f.confirmations.push(message);
    return confirmation.promise;
  };
  const exporting = f.workflow.exportCsv();
  assert.equal(f.workflow.phase(), 'confirmation');
  assert.equal(f.workflow.exporting(), false);
  assert.deepEqual(f.requests, []);
  f.contributions[0].updated_at = '2026-10-04T12:00:01.000000Z';
  f.contributions.push({ ...rows()[0], id: 'additional-synthetic' });
  confirmation.resolve(true);
  await exporting;
  assert.deepEqual(f.confirmations, ['admin.contributionsExport.confirmOne:1']);
  assert.deepEqual(f.requests, [
    {
      token: 'synthetic-session',
      payload: {
        confirmation: 'export_private_contributions',
        contributions: [
          {
            id: rows()[0].id,
            expectedVersion: rows()[0].updated_at
          }
        ]
      }
    }
  ]);
  assert.deepEqual(f.downloads, ['synthetic,csv\n']);
  assert.equal(f.workflow.phase(), 'idle');
});

test('confirmation and request phases independently block double submission', async () => {
  const f = await fixture();
  const confirmation = deferred();
  const response = deferred();
  f.ports.confirmation.confirm = (message) => {
    f.confirmations.push(message);
    return confirmation.promise;
  };
  f.ports.admin.getContributionsCsv = (token, payload) => {
    f.requests.push({ token, payload });
    return response.promise;
  };
  const exporting = f.workflow.exportCsv();
  await f.workflow.exportCsv();
  assert.equal(f.confirmations.length, 1);
  confirmation.resolve(true);
  await Promise.resolve();
  assert.equal(f.workflow.phase(), 'request');
  assert.equal(f.workflow.exporting(), true);
  assert.deepEqual(f.downloads, []);
  await f.workflow.exportCsv();
  assert.equal(f.requests.length, 1);
  response.resolve('confirmed synthetic CSV');
  await exporting;
  assert.equal(f.workflow.phase(), 'idle');
  assert.deepEqual(f.downloads, ['confirmed synthetic CSV']);
});

test('cancelled confirmations, empty lists, loading and forbidden access never request a CSV', async () => {
  for (const state of ['cancelled', 'empty', 'loading', 'reader', 'operator']) {
    const f = await fixture();
    if (state === 'cancelled') f.ports.confirmation.confirm = async () => false;
    if (state === 'empty') f.controller.setSearch('no-synthetic-match');
    if (state === 'loading') f.controller.state.set('loading');
    if (state === 'reader' || state === 'operator') f.setAccess(false);
    await f.workflow.exportCsv();
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.downloads, []);
    assert.equal(f.workflow.error(), '');
    assert.equal(f.workflow.phase(), 'idle');
  }
});

for (const phase of ['confirmation', 'request']) {
  for (const transition of [
    'filters restored',
    'reload',
    'route',
    'access restored',
    'session restored',
    'token restored',
    'dispose'
  ]) {
    for (const outcome of ['resolve', 'reject']) {
      test(`${phase} ${outcome} after ${transition} cannot request or download a private result`, async () => {
        const f = await fixture();
        const pending = deferred();
        if (phase === 'confirmation')
          f.ports.confirmation.confirm = () => pending.promise;
        else
          f.ports.admin.getContributionsCsv = (token, payload) => {
            f.requests.push({ token, payload });
            return pending.promise;
          };
        const exporting = f.workflow.exportCsv();
        if (phase === 'request') await Promise.resolve();
        assert.equal(f.workflow.phase(), phase);
        if (transition === 'filters restored') {
          f.controller.setSearch('selected');
          f.controller.setSearch('');
        } else if (transition === 'reload') await f.controller.load();
        else if (transition === 'route') {
          f.controller.setRouteContribution('another-synthetic-target');
          await f.controller.load();
        } else if (transition === 'access restored') {
          f.setAccess(false);
          f.setAccess(true);
        } else if (transition === 'session restored') f.resetSession();
        else if (transition === 'token restored') {
          f.setToken('other-synthetic-session');
          f.setToken('synthetic-session');
        } else {
          f.controller.dispose();
          f.workflow.dispose();
        }
        if (outcome === 'resolve')
          pending.resolve(phase === 'confirmation' ? true : 'late private CSV');
        else pending.reject(new AdminDashboardRequestError(403));
        await exporting;
        assert.equal(f.requests.length, phase === 'request' ? 1 : 0);
        assert.deepEqual(f.downloads, []);
        assert.equal(f.workflow.error(), '');
        if (transition === 'dispose') {
          await f.workflow.exportCsv();
          assert.equal(f.requests.length, phase === 'request' ? 1 : 0);
        }
      });
    }
  }
}

for (const [error, suffix] of [
  [new AdminDashboardRequestError(401), 'sessionExpired'],
  [new AdminDashboardRequestError(403), 'forbidden'],
  [new AdminDashboardRequestError(409), 'changed'],
  [new AdminDashboardRequestError(503), 'failed'],
  [new Error('Synthetic network unavailable'), 'failed']
]) {
  test(`export retains ${suffix} without optimistic download or automatic retry`, async () => {
    const f = await fixture();
    let requests = 0;
    f.ports.admin.getContributionsCsv = async () => {
      ++requests;
      throw error;
    };
    await f.workflow.exportCsv();
    assert.equal(f.workflow.error(), `admin.contributionsExport.${suffix}`);
    assert.equal(f.workflow.phase(), 'idle');
    assert.deepEqual(f.downloads, []);
    assert.equal(requests, 1);
  });
}

test('contributions browser adapter is safe when browser globals are absent', () => {
  assert.equal(adminContributionsBrowser(), null);
});

for (const failure of ['none', 'create anchor', 'click']) {
  test(`CSV MIME, filename and object URL lifecycle survive ${failure}`, async () => {
    const created = [];
    const revoked = [];
    const history = [];
    const anchor = {
      click: () => {
        if (failure === 'click') throw new Error('Synthetic click failure');
      }
    };
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window'
    );
    const previousDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document'
    );
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'https://example.test/admin/contributions?kept=yes#details'
        },
        history: { replaceState: (...args) => history.push(args) },
        URL: {
          createObjectURL: (blob) => {
            created.push(blob);
            return 'blob:synthetic-contributions';
          },
          revokeObjectURL: (url) => revoked.push(url)
        }
      }
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tag) => {
          assert.equal(tag, 'a');
          if (failure === 'create anchor')
            throw new Error('Synthetic anchor failure');
          return anchor;
        }
      }
    });
    try {
      const browser = adminContributionsBrowser();
      browser.selectContribution('synthetic contribution');
      assert.equal(history[0][2].searchParams.get('kept'), 'yes');
      assert.equal(
        history[0][2].searchParams.get('contributionId'),
        'synthetic contribution'
      );
      assert.equal(history[0][2].hash, '#details');
      if (failure === 'none') browser.saveCsv('synthetic,csv\n');
      else assert.throws(() => browser.saveCsv('synthetic,csv\n'), /Synthetic/);
      assert.equal(created[0].type, 'text/csv;charset=utf-8');
      assert.equal(await created[0].text(), 'synthetic,csv\n');
      assert.deepEqual(revoked, ['blob:synthetic-contributions']);
      if (failure !== 'create anchor') {
        assert.equal(anchor.href, 'blob:synthetic-contributions');
        assert.equal(anchor.download, 'openg7-admin-contributions.csv');
      }
    } finally {
      if (previousWindow)
        Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
      if (previousDocument)
        Object.defineProperty(globalThis, 'document', previousDocument);
      else delete globalThis.document;
    }
  });
}
