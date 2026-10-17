import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  signal,
  untracked,
  type Signal
} from '@angular/core';
import { Router } from '@angular/router';
import type {
  AdminCockpitMetrics,
  AdminCockpitActivity,
  AdminCockpitSystems,
  AdminPlatformJourneys
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';

import { createJourneyClock } from './platform-journey-state.js';

export type CockpitBlockState =
  'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable';
type Blocks = {
  metrics: AdminCockpitMetrics;
  activity: AdminCockpitActivity;
  systems: AdminCockpitSystems;
  journeys: AdminPlatformJourneys;
};

/** Local state per block. A failed source does not hide the other cockpit blocks. */
export const createCockpitBlock = <K extends keyof Blocks>(
  kind: K,
  refresh: Signal<number>,
  enabled: () => boolean = () => true,
  options: { autoRefreshMs?: number } = {}
) => {
  const admin = inject(FundingAdminService);
  const router = inject(Router);
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const document = inject(DOCUMENT);
  const destroy = inject(DestroyRef);
  const data = signal<Blocks[K] | null>(null);
  const state = signal<CockpitBlockState>('loading');
  // Loading a retry must not validate the snapshot kept after a failed read.
  const failed = signal(false);
  const journeyClock = kind === 'journeys' ? createJourneyClock() : null;
  const clock = signal(journeyClock ? Number.NaN : Date.now());
  const now = () =>
    journeyClock ? journeyClock.now(performance.now()) : Date.now();
  const updateClock = () => clock.set(now());
  let generation = 0;
  let destroyed = false;
  let pending = false;
  const load = async (): Promise<void> => {
    if (
      !browser ||
      destroyed ||
      !enabled() ||
      (options.autoRefreshMs && pending)
    )
      return;
    const request = ++generation;
    pending = true;
    state.set('loading');
    const token = admin.getSavedAdminToken();
    try {
      if (!token) throw new AdminDashboardRequestError(401);
      const requestStarted = journeyClock ? performance.now() : 0;
      const result = await admin.getCockpit(kind, token);
      if (destroyed || request !== generation) return;
      if (!admin.getSavedAdminToken())
        throw new AdminDashboardRequestError(401);
      clock.set(
        journeyClock
          ? journeyClock.observe(
              result.generatedAt,
              requestStarted,
              performance.now()
            )
          : Date.now()
      );
      failed.set(false);
      if ('available' in result && !result.available) {
        data.set(null);
        state.set('unavailable');
      } else {
        data.set(result);
        state.set('ready');
      }
    } catch (error) {
      if (destroyed || request !== generation) return;
      if (error instanceof AdminDashboardRequestError && error.status === 401) {
        data.set(null);
        failed.set(false);
        admin.clearAdminSession();
        await router.navigate(['/admin/login'], {
          queryParams: { returnUrl: router.url }
        });
      } else if (
        error instanceof AdminDashboardRequestError &&
        error.status === 403
      ) {
        data.set(null);
        failed.set(false);
        state.set('forbidden');
      } else {
        failed.set(true);
        state.set('error');
      }
    } finally {
      pending = false;
    }
  };
  effect(() => {
    refresh();
    if (!enabled()) {
      generation++;
      data.set(null);
      failed.set(false);
      state.set('loading');
      return;
    }
    untracked(() => {
      void load();
    });
  });
  const timer = browser ? setInterval(updateClock, 30_000) : undefined;
  const autoLoad = () => {
    if (document.visibilityState !== 'hidden') void load();
  };
  const autoTimer =
    browser && options.autoRefreshMs
      ? setInterval(autoLoad, options.autoRefreshMs)
      : undefined;
  if (autoTimer) document.addEventListener('visibilitychange', autoLoad);
  destroy.onDestroy(() => {
    destroyed = true;
    generation++;
    if (timer) clearInterval(timer);
    if (autoTimer) {
      clearInterval(autoTimer);
      document.removeEventListener('visibilitychange', autoLoad);
    }
  });
  const stale = () =>
    failed() ||
    Boolean(
      data() &&
      ((journeyClock && !Number.isFinite(clock())) ||
        clock() - Date.parse(data()!.generatedAt) > 300_000)
    );
  return {
    data,
    state,
    clock,
    now,
    updateClock,
    failed: failed.asReadonly(),
    stale,
    load
  };
};
