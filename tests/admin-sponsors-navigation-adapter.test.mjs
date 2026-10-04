import assert from 'node:assert/strict';
import test from 'node:test';

import '@angular/compiler';
import {
  DefaultUrlSerializer,
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  NavigationStart,
  Scroll,
  convertToParamMap
} from '@angular/router';

import { AdminSponsorsNavigationAdapter } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-navigation.adapter.js';
import { AdminSponsorListController } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-list-controller.js';

const sponsorshipId = 'synthetic-sponsor';
const path = (tab = 'overview', id = sponsorshipId) =>
  `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=${tab}`;
const serializer = new DefaultUrlSerializer();
const scrollEvent = (id, url, anchor = null, position = null) =>
  new Scroll(new NavigationEnd(id, url, url), position, anchor);

function fixture(controller) {
  const calls = [];
  const state = {
    selectedId: sponsorshipId,
    url: path(),
    navigation: null
  };
  const ports = {
    controller: controller ?? {
      navigationStarted: (...args) => calls.push(['started', ...args]),
      navigationCancelled: (...args) => calls.push(['cancelled', ...args]),
      navigationScrolled: (...args) => calls.push(['scrolled', ...args]),
      applyRouteSelection: (...args) => calls.push(['selection', ...args])
    },
    selectedSponsorshipId: () => state.selectedId,
    currentUrl: () => state.url,
    currentNavigation: () => state.navigation,
    parseUrl: (url) => serializer.parse(url)
  };
  return {
    adapter: new AdminSponsorsNavigationAdapter(ports),
    calls,
    state,
    ports
  };
}

test('imperative tab navigation preserves only the selected dossier with unchanged route and other query parameters', () => {
  const cases = [
    { name: 'new tab', target: path('media'), preserve: true },
    { name: 'same tab', target: path(), preserve: true },
    {
      name: 'tab removed',
      target: `/admin/fundraiser/sponsors?sponsorshipId=${sponsorshipId}`,
      preserve: true
    },
    {
      name: 'other dossier',
      target: path('media', 'synthetic-second'),
      preserve: false
    },
    {
      name: 'other route',
      target: path('media').replace('/sponsors', '/attention'),
      preserve: false
    },
    {
      name: 'matrix parameter',
      target: path('media').replace('/sponsors?', '/sponsors;view=compact?'),
      preserve: false
    },
    {
      name: 'new query',
      target: path('media') + '&returnTo=%2Fadmin%2Ffundraiser',
      preserve: false
    },
    {
      name: 'same query reordered',
      current: path() + '&returnTo=%2Fadmin%2Ffundraiser',
      target: `/admin/fundraiser/sponsors?returnTo=%2Fadmin%2Ffundraiser&tab=media&sponsorshipId=${sponsorshipId}`,
      preserve: true
    },
    {
      name: 'query changed',
      current: path() + '&returnTo=queue',
      target: path('media') + '&returnTo=cockpit',
      preserve: false
    },
    {
      name: 'query removed',
      current: path() + '&returnTo=queue',
      target: path('media'),
      preserve: false
    },
    {
      name: 'same repeated query',
      current: path() + '&filter=a&filter=b',
      target: path('media') + '&filter=a&filter=b',
      preserve: true
    },
    {
      name: 'repeated query reordered',
      current: path() + '&filter=a&filter=b',
      target: path('media') + '&filter=b&filter=a',
      preserve: false
    },
    {
      name: 'current dossier differs from selection',
      current: path('overview', 'synthetic-second'),
      target: path('media'),
      preserve: false
    },
    {
      name: 'no selection',
      selectedId: null,
      target: path('media'),
      preserve: false
    }
  ];
  for (const entry of cases) {
    const f = fixture();
    f.state.url = entry.current ?? path();
    if (Object.hasOwn(entry, 'selectedId'))
      f.state.selectedId = entry.selectedId;
    f.adapter.handleRouterEvent(
      new NavigationStart(7, entry.target, 'imperative')
    );
    assert.deepEqual(f.calls, [['started', 7, entry.preserve]], entry.name);
  }
});

test('fragment navigation keeps the current distinction between leaving a known section and entering a new section', () => {
  for (const [current, target, preserve] of [
    [path() + '#dossier-review', path('identity'), true],
    [path() + '#dossier-review', path('media') + '#dossier-review', true],
    [path() + '#other-section', path('media') + '#other-section', true],
    [path() + '#other-section', path('media'), false],
    [path(), path('media') + '#dossier-media', false],
    [path() + '#dossier-review', path('media') + '#dossier-media', false]
  ]) {
    const f = fixture();
    f.state.url = current;
    f.adapter.handleRouterEvent(new NavigationStart(8, target, 'imperative'));
    assert.deepEqual(
      f.calls,
      [['started', 8, preserve]],
      `${current} -> ${target}`
    );
  }
});

test('history and hash changes clear preservation even when they target another tab of the same dossier', () => {
  for (const trigger of ['popstate', 'hashchange']) {
    const f = fixture();
    f.adapter.handleRouterEvent(new NavigationStart(9, path('media'), trigger));
    assert.deepEqual(f.calls, [['started', 9, false]], trigger);
  }
});

test('same URL skips preserve the viewport only for a current imperative navigation and the same dossier', () => {
  for (const [code, trigger, target, preserve] of [
    [
      NavigationSkippedCode.IgnoredSameUrlNavigation,
      'imperative',
      path(),
      true
    ],
    [NavigationSkippedCode.IgnoredSameUrlNavigation, 'popstate', path(), false],
    [
      NavigationSkippedCode.IgnoredSameUrlNavigation,
      'hashchange',
      path(),
      false
    ],
    [NavigationSkippedCode.IgnoredSameUrlNavigation, null, path(), false],
    [
      NavigationSkippedCode.IgnoredByUrlHandlingStrategy,
      'imperative',
      path(),
      false
    ],
    [
      NavigationSkippedCode.IgnoredSameUrlNavigation,
      'imperative',
      path('media', 'synthetic-second'),
      false
    ]
  ]) {
    const f = fixture();
    f.state.navigation = trigger ? { trigger } : null;
    f.adapter.handleRouterEvent(
      new NavigationSkipped(10, target, 'Synthetic skipped navigation', code)
    );
    assert.deepEqual(f.calls, [['started', 10, preserve]]);
  }
});

test('unrelated router events have no controller effect and do not parse a URL', () => {
  const f = fixture();
  f.ports.parseUrl = () => assert.fail('Unrelated events must not parse a URL');
  f.adapter.handleRouterEvent(new NavigationEnd(11, path(), path()));
  assert.deepEqual(f.calls, []);
});

test('cancelled and failed navigations forward their exact identifier', () => {
  const f = fixture();
  f.adapter.handleRouterEvent(
    new NavigationCancel(
      12,
      path('media'),
      'Synthetic cancelled navigation',
      NavigationCancellationCode.GuardRejected
    )
  );
  f.adapter.handleRouterEvent(
    new NavigationError(
      13,
      path('media'),
      new Error('Synthetic navigation failure')
    )
  );
  assert.deepEqual(f.calls, [
    ['cancelled', 12],
    ['cancelled', 13]
  ]);
});

test('route query values are decoded by Angular and passed unchanged to the selection owner', () => {
  const f = fixture();
  const url = serializer.parse(
    '/admin/fundraiser/sponsors?sponsorshipId=synthetic%20sponsor&tab=unsupported'
  );
  f.adapter.applyRouteSelection(convertToParamMap(url.queryParams));
  f.adapter.applyRouteSelection(convertToParamMap({}));
  assert.deepEqual(f.calls, [
    ['selection', 'synthetic sponsor', 'unsupported'],
    ['selection', null, null]
  ]);
});

test('recognized section anchors select their exact dossier and tab after scrolling', () => {
  const cases = [
    ['payment', 'overview'],
    ['review', 'overview'],
    ['stripe', 'overview'],
    ['identity', 'identity'],
    ['media', 'media'],
    ['billing', 'billing'],
    ['publication', 'publication'],
    ['refund', 'refund'],
    ['audit', 'audit']
  ];
  for (const [section, tab] of cases) {
    const f = fixture();
    f.adapter.handleRouterEvent(
      scrollEvent(14, path(tab, 'synthetic-target'), `dossier-${section}`)
    );
    assert.deepEqual(f.calls, [
      [
        'scrolled',
        14,
        {
          fragment: `dossier-${section}`,
          sponsorshipId: 'synthetic-target',
          tab
        }
      ]
    ]);
  }
  const f = fixture();
  f.adapter.handleRouterEvent(
    scrollEvent(
      15,
      `/admin/fundraiser/sponsors?sponsorshipId=${sponsorshipId}`,
      'dossier-review'
    )
  );
  assert.deepEqual(f.calls, [
    [
      'scrolled',
      15,
      {
        fragment: 'dossier-review',
        sponsorshipId,
        tab: 'overview'
      }
    ]
  ]);
});

test('sections require an exact tab and a nonempty dossier and history positions take priority over anchors', () => {
  for (const [url, anchor, position] of [
    [path('identity'), 'dossier-review', null],
    ['/admin/fundraiser/sponsors?tab=media', 'dossier-media', null],
    [
      '/admin/fundraiser/sponsors?sponsorshipId=&tab=media',
      'dossier-media',
      null
    ],
    [path('media'), 'dossier-unknown', null],
    [path('media'), 'media', null],
    [path('media'), 'dossier-MEDIA', null],
    [path(), null, null],
    [path(), 'dossier-review', [0, 920]],
    [path(), 'dossier-review', [0, 0]]
  ]) {
    const f = fixture();
    f.adapter.handleRouterEvent(scrollEvent(16, url, anchor, position));
    assert.deepEqual(f.calls, [['scrolled', 16, null]]);
  }
});

test('Scroll is ignored while a new navigation is in progress, including a same URL skip', () => {
  const f = fixture();
  f.state.navigation = { trigger: 'imperative' };
  f.adapter.handleRouterEvent(scrollEvent(17, path(), 'dossier-review'));
  assert.deepEqual(f.calls, []);
  f.state.navigation = null;
  const skipped = new NavigationSkipped(
    18,
    path(),
    'Synthetic same URL',
    NavigationSkippedCode.IgnoredSameUrlNavigation
  );
  f.adapter.handleRouterEvent(new Scroll(skipped, null, 'dossier-review'));
  assert.deepEqual(f.calls, [
    [
      'scrolled',
      18,
      {
        fragment: 'dossier-review',
        sponsorshipId,
        tab: 'overview'
      }
    ]
  ]);
});

function controllerFixture(t) {
  const scroll = [],
    focus = [],
    renders = [];
  const controller = new AdminSponsorListController({
    admin: {
      getSavedAdminToken: () => 'synthetic-token',
      saveAdminToken() {},
      selectSponsorship() {},
      async refreshWorkQueue() {},
      async getSponsorships() {
        return {
          items: [],
          sponsorships: [],
          pagination: {
            page: 1,
            pageSize: 6,
            totalItems: 0,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false
          }
        };
      }
    },
    t: (key) => key,
    reconcile() {},
    async loadLogoPreviews() {},
    async loadSponsorMedia() {},
    closeDecisionPanels() {},
    messageFromError: (_error, fallback) => fallback,
    navigation: {
      getScrollPosition: () => [0, 480],
      scrollToPosition: (value) => scroll.push(value),
      hasPendingNavigation: () => false,
      navigateDossier() {},
      afterRender: (callback) => renders.push(callback),
      focusDossier: () => focus.push('dossier'),
      focusListRow: (id) => focus.push(id)
    }
  });
  t.after(() => controller.dispose());
  controller.selectedSponsorshipId.set(sponsorshipId);
  return { ...fixture(controller), controller, scroll, focus, renders };
}

for (const kind of ['cancelled', 'failed', 'new navigation', 'destroyed']) {
  test(`adapter events leave the controller in charge of cancelling deferred scroll when ${kind}`, async (t) => {
    const f = controllerFixture(t);
    f.adapter.handleRouterEvent(
      new NavigationStart(20, path('media'), 'imperative')
    );
    f.adapter.handleRouterEvent(scrollEvent(20, path('media')));
    assert.deepEqual(f.scroll, []);
    if (kind === 'cancelled')
      f.adapter.handleRouterEvent(
        new NavigationCancel(
          20,
          path('media'),
          'Synthetic cancel',
          NavigationCancellationCode.GuardRejected
        )
      );
    else if (kind === 'failed')
      f.adapter.handleRouterEvent(
        new NavigationError(20, path('media'), new Error('Synthetic error'))
      );
    else if (kind === 'new navigation')
      f.adapter.handleRouterEvent(
        new NavigationStart(21, path('media', 'synthetic-second'), 'imperative')
      );
    else f.controller.dispose();
    await Promise.resolve();
    assert.deepEqual(f.scroll, []);
  });
}

test('a newer route clears a pending section while destruction invalidates previously scheduled dossier focus', (t) => {
  const f = controllerFixture(t);
  f.adapter.handleRouterEvent(scrollEvent(22, path(), 'dossier-review'));
  assert.equal(f.controller.pendingSection()?.fragment, 'dossier-review');
  f.adapter.handleRouterEvent(
    new NavigationStart(23, path('identity'), 'imperative')
  );
  assert.equal(f.controller.pendingSection(), null);
  f.controller.selectSponsorshipById(sponsorshipId);
  assert.equal(f.renders.length, 1);
  f.adapter.handleRouterEvent(scrollEvent(24, path(), 'dossier-review'));
  f.controller.dispose();
  f.renders.forEach((callback) => callback());
  f.adapter.handleRouterEvent(scrollEvent(25, path(), 'dossier-review'));
  assert.equal(f.controller.pendingSection(), null);
  assert.deepEqual(f.focus, []);
  assert.deepEqual(f.scroll, []);
});
