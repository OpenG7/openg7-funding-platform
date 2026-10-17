import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminAutomaticPreparationService } from '../dist/apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-preparation.service.js';

const payment = '10000000-0000-4000-8000-000000000801';
const otherPayment = '10000000-0000-4000-8000-000000000802';

/** Only layout and browser DOM are substituted; registrations and callbacks are real. */
function fixture() {
  const nodes = [];
  const document = {
    defaultView: {
      getComputedStyle: (node) => ({ visibility: node.visibility })
    },
    getElementById: (id) => (id === 'admin-main' ? main : null)
  };
  const node = (parentElement = null, attributes = {}) => {
    const element = {
      ownerDocument: document,
      parentElement,
      tagName: 'DIV',
      type: undefined,
      isConnected: true,
      disabled: false,
      visibility: 'visible',
      rendered: true,
      attributes: new Map(Object.entries(attributes)),
      textContent: '',
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      getClientRects() {
        return this.rendered ? [{}] : [];
      },
      closest(selector) {
        assert.equal(selector, '[data-og7="admin-layout"]');
        for (let ancestor = this; ancestor; ancestor = ancestor.parentElement)
          if (ancestor.getAttribute('data-og7') === 'admin-layout')
            return ancestor;
        return null;
      },
      querySelectorAll(selector) {
        assert.equal(
          selector,
          '#admin-main, [data-og7="controller-radial-slot"][data-og7-controller-owner], [data-og7="controller-deck-slot"][data-og7-controller-owner]'
        );
        return nodes.filter(
          (candidate) =>
            candidate !== this &&
            this.contains(candidate) &&
            (candidate.getAttribute('id') === 'admin-main' ||
              (['controller-radial-slot', 'controller-deck-slot'].includes(
                candidate.getAttribute('data-og7')
              ) &&
                candidate.attributes.has('data-og7-controller-owner')))
        );
      },
      matches(selector) {
        if (selector === ':disabled,[aria-disabled="true"]')
          return this.disabled || this.getAttribute('aria-disabled') === 'true';
        assert.equal(
          selector,
          '[inert],[hidden],[aria-hidden="true"],[aria-disabled="true"]',
          'The registry must never construct a selector from an ID or region.'
        );
        return (
          this.attributes.has('inert') ||
          this.attributes.has('hidden') ||
          this.getAttribute('aria-hidden') === 'true' ||
          this.getAttribute('aria-disabled') === 'true'
        );
      },
      contains(other) {
        for (let ancestor = other; ancestor; ancestor = ancestor.parentElement)
          if (ancestor === this) return true;
        return false;
      }
    };
    nodes.push(element);
    return element;
  };
  const body = node();
  const layout = node(body, { 'data-og7': 'admin-layout' });
  const main = node(layout, { id: 'admin-main' });
  const region = node(main, { 'data-og7': 'sponsorship-dossier' });
  const button = node(region);
  Object.assign(button, {
    tagName: 'BUTTON',
    type: 'button',
    textContent: '  Examiner\n les médias  '
  });
  let preparations = 0;
  let clicks = 0;
  button.click = () => ++clicks;
  const entry = {
    id: 'sponsor.media.preview:synthetic-asset',
    element: button,
    target: payment,
    executionMode: 'prepare',
    prepare: () => ++preparations
  };
  const service = new AdminAutomaticPreparationService();
  return {
    service,
    entry,
    button,
    region,
    main,
    layout,
    body,
    node,
    document,
    preparations: () => preparations,
    clicks: () => clicks
  };
}

test('an explicit preparation invokes only its owner callback and becomes unusable after removal', () => {
  const f = fixture();
  assert.deepEqual(f.service.entries(), []);
  const unregister = f.service.register(f.entry);
  assert.deepEqual(f.service.available(payment), [f.entry]);
  assert.equal(f.service.prepare(f.entry, payment), true);
  assert.equal(f.preparations(), 1);
  assert.equal(f.clicks(), 0);
  unregister();
  unregister();
  assert.deepEqual(f.service.entries(), []);
  assert.equal(f.service.prepare(f.entry, payment), false);
  assert.equal(f.preparations(), 1);
  assert.equal(f.clicks(), 0);
});

test('a payment excludes both another dossier and every unscoped preparation', () => {
  const f = fixture();
  const unscoped = { ...f.entry, target: null };
  const other = { ...f.entry, target: otherPayment };
  for (const entry of [f.entry, unscoped, other]) f.service.register(entry);
  assert.deepEqual(f.service.available(payment), [f.entry]);
  assert.equal(f.service.prepare(unscoped, payment), false);
  assert.equal(f.service.prepare(other, payment), false);
  assert.equal(f.preparations(), 0);
  assert.deepEqual(f.service.available(), [f.entry, unscoped, other]);
});

test('a stale registration cannot replace or remove the new preparation for a changed dossier', () => {
  const f = fixture();
  const removeOld = f.service.register(f.entry);
  const current = { ...f.entry, target: otherPayment };
  f.service.register(current);
  removeOld();
  assert.equal(f.service.prepare(f.entry, payment), false);
  assert.deepEqual(f.service.available(otherPayment), [current]);
  assert.equal(f.service.prepare(current, otherPayment), true);
  assert.equal(f.preparations(), 1);
});

test('only exact ancestor region attributes match, without interpreting arbitrary selectors', () => {
  const f = fixture();
  f.service.register(f.entry);
  assert.deepEqual(f.service.available(payment, 'sponsorship-dossier'), [
    f.entry
  ]);
  for (const region of [
    'invoice-selection',
    'sponsor',
    '',
    'sponsorship-dossier"] button, [data-og7="other'
  ]) {
    assert.deepEqual(f.service.available(payment, region), []);
    assert.equal(f.service.prepare(f.entry, payment, region), false);
  }
  assert.equal(f.preparations(), 0);
});

const unavailable = {
  disabled: (f) => {
    f.button.disabled = true;
  },
  'aria-disabled button': (f) => {
    f.button.attributes.set('aria-disabled', 'true');
  },
  'aria-disabled region': (f) => {
    f.region.attributes.set('aria-disabled', 'true');
  },
  'hidden ancestor': (f) => {
    f.region.attributes.set('hidden', '');
  },
  'inert ancestor': (f) => {
    f.main.attributes.set('inert', '');
  },
  'aria-hidden ancestor': (f) => {
    f.region.attributes.set('aria-hidden', 'true');
  },
  'CSS hidden ancestor': (f) => {
    f.region.visibility = 'hidden';
  },
  'collapsed button': (f) => {
    f.button.visibility = 'collapse';
  },
  'not rendered': (f) => {
    f.button.rendered = false;
  },
  disconnected: (f) => {
    f.button.isConnected = false;
  },
  'outside admin content': (f) => {
    f.button.parentElement = f.body;
  },
  'missing admin content': (f) => {
    f.document.getElementById = () => null;
  },
  'no browser window': (f) => {
    f.document.defaultView = null;
  },
  'submit button': (f) => {
    f.button.type = 'submit';
  },
  'non-button control': (f) => {
    f.button.tagName = 'A';
  },
  'no understandable label': (f) => {
    f.button.textContent = ' ';
  }
};

for (const [state, change] of Object.entries(unavailable)) {
  test(`a preparation that becomes ${state} cannot execute a previously available selection`, () => {
    const f = fixture();
    f.service.register(f.entry);
    const [selected] = f.service.available(payment, 'sponsorship-dossier');
    assert.equal(selected, f.entry);
    change(f);
    assert.deepEqual(f.service.available(payment), []);
    assert.equal(f.service.prepare(selected, payment), false);
    assert.equal(f.preparations(), 0);
    assert.equal(f.clicks(), 0);
  });
}

test('an unregistered copy and an unsupported execution mode never gain authority', () => {
  const f = fixture();
  f.service.register(f.entry);
  assert.equal(f.service.prepare({ ...f.entry }, payment), false);
  const unsupported = { ...f.entry, executionMode: 'navigate' };
  f.service.register(unsupported);
  assert.deepEqual(f.service.available(payment), [f.entry]);
  assert.equal(f.service.prepare(unsupported, payment), false);
  assert.equal(f.preparations(), 0);
});

test('confirmation_required only calls the registered opening and reads its current accessible label', () => {
  const f = fixture();
  const entry = { ...f.entry, executionMode: 'confirmation_required' };
  f.service.register(entry);
  assert.equal(f.service.label(entry), 'Examiner les médias');
  f.button.attributes.set('aria-label', ' Ouvrir la confirmation ');
  assert.equal(f.service.label(entry), 'Ouvrir la confirmation');
  assert.equal(f.service.prepare(entry, payment), true);
  assert.equal(f.preparations(), 1);
  assert.equal(f.clicks(), 0);
});

for (const slotName of ['controller-radial-slot', 'controller-deck-slot']) {
  test(`a confirmation opening projected into the current owned ${slotName} keeps its explicit preparation`, () => {
    const f = fixture();
    const slot = f.node(f.layout, {
      'data-og7': slotName,
      'data-og7-controller-owner': 'pilotage'
    });
    f.region.parentElement = slot;
    const entry = { ...f.entry, executionMode: 'confirmation_required' };
    f.service.register(entry);
    assert.equal(f.main.contains(f.button), false);
    assert.deepEqual(f.service.available(payment, 'sponsorship-dossier'), [
      entry
    ]);
    assert.equal(
      f.service.prepare(entry, payment, 'sponsorship-dossier'),
      true
    );
    assert.equal(f.preparations(), 1);
    assert.equal(f.clicks(), 0);
    slot.attributes.set('hidden', '');
    assert.deepEqual(f.service.available(payment), []);
    assert.equal(f.service.prepare(entry, payment), false);
    assert.equal(f.preparations(), 1);
  });
}

for (const location of [
  'unowned slot',
  'navigation shell',
  'other layout',
  'nested layout',
  'nested layout inside main'
]) {
  test(`a registered preparation in ${location} never enters the current page content scope`, () => {
    const f = fixture();
    const owner =
      location === 'other layout'
        ? f.node(f.body, { 'data-og7': 'admin-layout' })
        : location.startsWith('nested layout')
          ? f.node(
              location === 'nested layout inside main' ? f.main : f.layout,
              { 'data-og7': 'admin-layout' }
            )
          : f.layout;
    const slot = f.node(owner, {
      'data-og7':
        location === 'navigation shell'
          ? 'admin-navigation'
          : 'controller-radial-slot',
      ...(location === 'unowned slot'
        ? {}
        : { 'data-og7-controller-owner': 'pilotage' })
    });
    f.region.parentElement = slot;
    f.service.register(f.entry);
    assert.deepEqual(f.service.available(payment), []);
    assert.equal(f.service.prepare(f.entry, payment), false);
    assert.equal(f.preparations(), 0);
    assert.equal(f.clicks(), 0);
  });
}
