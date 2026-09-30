import { isPlatformBrowser } from '@angular/common';
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
  AdminCockpitSystems
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';

export type CockpitBlockState =
  'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable';
type Blocks = {
  metrics: AdminCockpitMetrics;
  activity: AdminCockpitActivity;
  systems: AdminCockpitSystems;
};

/** Local state per block. A failed source does not hide the other cockpit blocks. */
export const createCockpitBlock = <K extends keyof Blocks>(
  kind: K,
  refresh: Signal<number>,
  enabled: () => boolean = () => true
) => {
  const admin = inject(FundingAdminService);
  const router = inject(Router);
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const destroy = inject(DestroyRef);
  const data = signal<Blocks[K] | null>(null);
  const state = signal<CockpitBlockState>('loading');
  // Loading a retry must not validate the snapshot kept after a failed read.
  const failed = signal(false);
  const clock = signal(Date.now());
  let generation = 0;
  let destroyed = false;
  const load = async (): Promise<void> => {
    if (!browser || destroyed || !enabled()) return;
    const request = ++generation;
    state.set('loading');
    const token = admin.getSavedAdminToken();
    try {
      if (!token) throw new AdminDashboardRequestError(401);
      const result = await admin.getCockpit(kind, token);
      if (destroyed || request !== generation) return;
      if (!admin.getSavedAdminToken())
        throw new AdminDashboardRequestError(401);
      clock.set(Date.now());
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
  const timer = browser
    ? setInterval(() => clock.set(Date.now()), 30_000)
    : undefined;
  destroy.onDestroy(() => {
    destroyed = true;
    generation++;
    if (timer) clearInterval(timer);
  });
  const stale = () =>
    failed() ||
    Boolean(data() && clock() - Date.parse(data()!.generatedAt) > 300_000);
  return { data, state, clock, failed: failed.asReadonly(), stale, load };
};
