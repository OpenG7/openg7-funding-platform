import '@angular/compiler';
import { Injector } from '@angular/core';
import {
  DefaultUrlSerializer,
  Router,
  convertToParamMap
} from '@angular/router';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SERVICE_DEMO_EMBEDDED,
  ServiceDemoNavigation
} from '../dist/apps/funding-web/src/app/features/funding/service-delivery/service-demo-navigation.js';

const serializer = new DefaultUrlSerializer();
const base = '/demo/prestations';

function fixture(t, router, embedded) {
  const injector = Injector.create({
    providers: [
      ServiceDemoNavigation,
      { provide: Router, useValue: router },
      { provide: SERVICE_DEMO_EMBEDDED, useValue: embedded }
    ]
  });
  t.after(() => injector.destroy());
  return injector.get(ServiceDemoNavigation);
}

function hostRouterTrap() {
  const calls = [];
  const router = Object.fromEntries(
    [
      'navigateByUrl',
      'navigate',
      'createUrlTree',
      'parseUrl',
      'currentNavigation'
    ].map((method) => [
      method,
      () => {
        calls.push(method);
        throw new Error(
          'Embedded navigation must leave the host router untouched.'
        );
      }
    ])
  );
  return { router, calls };
}

test('standalone navigation reads the complete snapshot before live child routes are activated', (t) => {
  const url = `${base}/dossier/atelier-boreal/corriger/image?retour=publication`;
  let current = { finalUrl: serializer.parse(url) };
  const relativeRoutes = [];
  const router = {
    url: '/',
    currentNavigation: () => current,
    createUrlTree: (_commands, extras) => {
      relativeRoutes.push(extras.relativeTo);
      return serializer.parse(router.url);
    }
  };
  const navigation = fixture(t, router, false);
  const leafSnapshot = {
    params: { tab: 'image' },
    data: {
      page: 'corriger',
      titleKey: 'serviceDemoEditor.title',
      parent: 'contenu'
    },
    queryParamMap: convertToParamMap({ retour: 'publication' }),
    firstChild: null
  };
  const dossierSnapshot = {
    params: { id: 'atelier-boreal' },
    data: {},
    firstChild: leafSnapshot
  };
  const leafRoute = { snapshot: undefined, firstChild: null };
  const dossierRoute = { snapshot: undefined, firstChild: leafRoute };
  const root = {
    snapshot: { params: {}, data: {}, firstChild: dossierSnapshot },
    firstChild: dossierRoute
  };

  assert.doesNotThrow(() => navigation.syncRoute(root));
  assert.equal(navigation.kind(), 'editor');
  assert.equal(navigation.params().get('id'), 'atelier-boreal');
  assert.equal(navigation.params().get('tab'), 'image');
  assert.equal(navigation.query().get('retour'), 'publication');
  assert.deepEqual(navigation.data(), leafSnapshot.data);
  assert.equal(navigation.url(), url);
  navigation.linkUrl([], undefined, 'preserve');
  assert.equal(relativeRoutes.at(-1), root);

  // Router activation catches the live tree up with the snapshot tree. Future
  // relative links now belong to the deepest active page, with fresh queries.
  dossierRoute.snapshot = dossierSnapshot;
  leafRoute.snapshot = leafSnapshot;
  leafSnapshot.params = { tab: 'texte' };
  leafSnapshot.queryParamMap = convertToParamMap({
    retour: 'contenu',
    version: '2'
  });
  current = null;
  router.url = `${base}/dossier/atelier-boreal/corriger/texte?retour=contenu&version=2`;
  navigation.syncRoute(root);
  navigation.linkUrl([], undefined, 'preserve');
  assert.equal(relativeRoutes.at(-1), leafRoute);
  assert.equal(navigation.params().get('id'), 'atelier-boreal');
  assert.equal(navigation.params().get('tab'), 'texte');
  assert.equal(navigation.query().get('retour'), 'contenu');
  assert.equal(navigation.query().get('version'), '2');
  assert.equal(navigation.url(), router.url);
});

test('embedded navigation keeps its own parameters, merges and preserves queries, and resolves Unicode dossiers', async (t) => {
  const trap = hostRouterTrap();
  const navigation = fixture(t, trap.router, true);
  assert.equal(navigation.kind(), 'list');
  assert.equal(navigation.url(), base);
  assert.doesNotThrow(() =>
    navigation.syncRoute({
      get snapshot() {
        throw new Error('An embedded visit must not read the host route.');
      }
    })
  );

  assert.equal(
    await navigation.navigate(
      ['/demo/prestations/dossier', 'collectif-rivages', 'autorisation'],
      {
        queryParams: {
          q: 'local search',
          filtre: ['first', 'second'],
          version: 'old'
        }
      }
    ),
    true
  );
  assert.equal(navigation.kind(), 'workspace');
  assert.equal(navigation.params().get('id'), 'collectif-rivages');
  assert.equal(navigation.data()['page'], 'autorisation');
  assert.deepEqual(navigation.query().getAll('filtre'), ['first', 'second']);

  await navigation.navigate([], {
    queryParams: { version: null, filtre: null, ordre: 'ancien' },
    queryParamsHandling: 'merge',
    replaceUrl: true
  });
  assert.equal(navigation.query().get('q'), 'local search');
  assert.equal(navigation.query().get('ordre'), 'ancien');
  assert.equal(navigation.query().has('version'), false);
  assert.equal(navigation.query().has('filtre'), false);

  const next = navigation.linkUrl(
    `${base}/dossier/studio-canop%C3%A9e/corriger/image`,
    { q: 'ignored by preserve' },
    'preserve'
  );
  await navigation.navigate(next);
  assert.equal(navigation.kind(), 'editor');
  assert.equal(navigation.data()['page'], 'corriger');
  assert.equal(navigation.params().get('id'), 'studio-canopée');
  assert.equal(navigation.params().get('tab'), 'image');
  assert.equal(navigation.query().get('q'), 'local search');
  assert.equal(navigation.query().get('ordre'), 'ancien');
  assert.match(navigation.url(), /studio-canop%C3%A9e\/corriger\/image/);

  await navigation.navigate(base);
  assert.equal(navigation.kind(), 'list');
  assert.deepEqual(navigation.params().keys, []);
  assert.deepEqual(navigation.query().keys, []);
  assert.deepEqual(trap.calls, []);
});

test('an embedded administrative destination is refused without changing the current local visit', async (t) => {
  const trap = hostRouterTrap();
  const navigation = fixture(t, trap.router, true);
  await navigation.navigate(`${base}/dossier/atelier-boreal/historique`, {
    queryParams: { version: 'synthetic', filtre: 'notes' }
  });
  const retained = {
    url: navigation.url(),
    kind: navigation.kind(),
    data: navigation.data(),
    params: navigation.params(),
    query: navigation.query()
  };
  for (const destination of [
    '/admin/fundraiser',
    ['/admin/fundraiser', 'sponsors'],
    serializer.parse('/admin/fundraiser/publications?draftId=synthetic')
  ]) {
    assert.equal(await navigation.navigate(destination), false);
    assert.equal(navigation.url(), retained.url);
    assert.equal(navigation.kind(), retained.kind);
    assert.equal(navigation.data(), retained.data);
    assert.equal(navigation.params(), retained.params);
    assert.equal(navigation.query(), retained.query);
  }
  assert.deepEqual(trap.calls, []);
});
