import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const directory =
  'apps/funding-web/src/app/features/funding/pages/service-demo/';
const nginx = read('apps/funding-web/nginx.conf');
const location = nginx.match(/location ~ (\^\/demo\/prestations[^\n]+) \{/);

test('the static host serves every declared synthetic service destination', () => {
  assert.ok(location, 'the demo has an explicit client routing location');
  const accepts = new RegExp(location[1]);
  const ids = [
    ...read(directory + 'service-demo-state.ts').matchAll(/id: '([^']+)'/g)
  ].map((match) => match[1]);
  const details = [
    ...read(directory + 'service-demo-detail.component.ts').matchAll(
      /path: '([^']+)'/g
    )
  ].map((match) => match[1]);
  assert.equal(ids.length, 3);
  assert.equal(details.length, 33);
  assert.ok(accepts.test('/demo/prestations'));
  for (const id of ids) {
    const base = '/demo/prestations/dossier/' + id;
    for (const page of [
      '',
      'contenu',
      'autorisation',
      'publication',
      'historique',
      'corriger',
      ...details,
      ...['texte', 'image', 'liens', 'mentions', 'options'].map(
        (tab) => 'corriger/' + tab
      )
    ]) {
      const url = base + (page ? '/' + page : '');
      assert.ok(accepts.test(url), url);
      assert.ok(accepts.test(url + '/'), url + '/');
    }
  }
});

test('unknown files, tabs, descendants and prefix collisions remain HTTP 404s', () => {
  const accepts = new RegExp(location[1]);
  for (const path of [
    '/demo/prestations-extra',
    '/demo/prestations/inconnu',
    '/demo/prestations/dossier/inconnu/contenu',
    '/demo/prestations/dossier/atelier-boreal/inconnu',
    '/demo/prestations/dossier/atelier-boreal/contenu/extra',
    '/demo/prestations/dossier/atelier-boreal/corriger/inconnu',
    '/demo/prestations/dossier/atelier-boreal/corriger/texte/extra'
  ])
    assert.equal(accepts.test(path), false, path);
});
