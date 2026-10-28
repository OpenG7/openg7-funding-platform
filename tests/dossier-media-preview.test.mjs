import { computed, signal } from '@angular/core';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import ts from 'typescript';

const source = readFileSync(
  new URL(
    '../apps/funding-web/src/app/features/funding/service-delivery/dossier-media-preview.component.ts',
    import.meta.url
  ),
  'utf8'
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true
  }
}).outputText;
const exports = {};
// Keep the feature's runtime entry point private. Inputs are writable fixtures;
// computed values and error state use Angular's real reactive implementation.
const input = Object.assign((value) => signal(value), {
  required: () => signal(undefined)
});
new Function('exports', 'require', transpiled)(exports, (specifier) => {
  if (specifier === '@angular/core')
    return {
      ChangeDetectionStrategy: { OnPush: 'OnPush' },
      Component: () => (component) => component,
      computed,
      input,
      signal
    };
  assert.equal(specifier, './service-demo-link.directive.js');
  return { ServiceDemoLinkDirective: 'ServiceDemoLinkDirective' };
});

function preview(media = []) {
  const component = new exports.DossierMediaPreviewComponent();
  component.media.set(media);
  return component;
}

test('empty and blank media leave no preview or artificial image', () => {
  const component = preview();
  assert.deepEqual(component.sources(), []);
  assert.deepEqual(component.previews(), []);
  component.media.set([{ src: '  ', thumbnailSrc: ' ' }]);
  assert.deepEqual(component.sources(), []);
  assert.deepEqual(component.previews(), []);
});

test('a single available image is presented once', () => {
  const component = preview([{ src: '/photos/partner.webp' }]);
  assert.deepEqual(component.sources(), ['/photos/partner.webp']);
  assert.deepEqual(component.previews(), ['/photos/partner.webp']);
});

test('multiple media preserve order while limiting rendered previews to three', () => {
  const component = preview(
    ['one', 'two', 'three', 'four', 'five'].map((name) => ({
      src: `/photos/${name}.webp`
    }))
  );
  assert.equal(component.sources().length, 5);
  assert.deepEqual(component.previews(), [
    '/photos/one.webp',
    '/photos/two.webp',
    '/photos/three.webp'
  ]);
});

test('duplicate display URLs and surrounding spaces do not inflate media counts', () => {
  const component = preview([
    { src: '/photos/one.webp' },
    { src: ' /photos/one.webp ' },
    { src: '/photos/two.webp', thumbnailSrc: '/thumbs/two.webp' },
    { src: '/photos/two-copy.webp', thumbnailSrc: ' /thumbs/two.webp ' }
  ]);
  assert.deepEqual(component.sources(), [
    '/photos/one.webp',
    '/thumbs/two.webp'
  ]);
  assert.equal(component.previews().length, 2);
});

test('available thumbnails take priority and blank thumbnails fall back to the source', () => {
  const component = preview([
    { src: '/photos/large.webp', thumbnailSrc: ' /thumbs/small.webp ' },
    { src: ' /photos/original.webp ', thumbnailSrc: ' ' }
  ]);
  assert.deepEqual(component.sources(), [
    '/thumbs/small.webp',
    '/photos/original.webp'
  ]);
});

test('an image error removes its count and brings the next available image into view', () => {
  const component = preview([
    { src: '/photos/one.webp', thumbnailSrc: '/thumbs/one.webp' },
    { src: '/photos/two.webp' },
    { src: '/photos/three.webp' },
    { src: '/photos/four.webp' }
  ]);
  component.imageFailed('/thumbs/one.webp');
  assert.deepEqual(component.sources(), [
    '/photos/two.webp',
    '/photos/three.webp',
    '/photos/four.webp'
  ]);
  assert.deepEqual(component.previews(), component.sources());
});

test('repeated failures are idempotent and all failed media leave an empty preview', () => {
  const component = preview([
    { src: '/photos/one.webp' },
    { src: '/photos/two.webp' }
  ]);
  component.imageFailed('/photos/one.webp');
  component.imageFailed('/photos/one.webp');
  assert.deepEqual(component.sources(), ['/photos/two.webp']);
  component.imageFailed('/photos/two.webp');
  assert.deepEqual(component.sources(), []);
  assert.deepEqual(component.previews(), []);
});

test('changing supplied media recomputes the preview without retrying a known failed URL', () => {
  const component = preview([{ src: '/photos/old.webp' }]);
  component.imageFailed('/photos/old.webp');
  const next = Object.freeze([
    Object.freeze({ src: '/photos/new.webp' }),
    Object.freeze({ src: '/photos/old.webp' })
  ]);
  component.media.set(next);
  assert.deepEqual(component.sources(), ['/photos/new.webp']);
  assert.deepEqual(component.previews(), ['/photos/new.webp']);
  assert.equal(component.media(), next);
  component.media.set([]);
  assert.deepEqual(component.sources(), []);
});
