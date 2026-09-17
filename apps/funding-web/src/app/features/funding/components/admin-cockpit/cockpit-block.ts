import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  signal,
  untracked,
  type InputSignal
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
  refresh: InputSignal<number>
) => {
  const admin = inject(FundingAdminService);
  const router = inject(Router);
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const destroy = inject(DestroyRef);
  const data = signal<Blocks[K] | null>(null);
  const state = signal<CockpitBlockState>('loading');
  const clock = signal(Date.now());
  let generation = 0;
  let destroyed = false;
  const load = async (): Promise<void> => {
    if (!browser || destroyed) return;
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
        admin.clearAdminSession();
        await router.navigate(['/admin/login'], {
          queryParams: { returnUrl: '/admin/fundraiser' }
        });
      } else if (
        error instanceof AdminDashboardRequestError &&
        error.status === 403
      ) {
        data.set(null);
        state.set('forbidden');
      } else state.set('error');
    }
  };
  effect(() => {
    refresh();
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
    state() === 'error' ||
    Boolean(data() && clock() - Date.parse(data()!.generatedAt) > 300_000);
  return { data, state, clock, stale, load };
};
