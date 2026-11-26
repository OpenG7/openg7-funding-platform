import { randomUUID } from 'node:crypto';

export const ASSURANCE_CHECKS = Object.freeze([
  'alert_episodes',
  'admin_reads',
  'private_preparation',
  'preflight_reconciliation',
  'publication_uncertainty',
  'cleanup'
]);

/** Fixed synthetic checks only: never accepts a target, recipient or live mode. */
export function parseAssuranceOptions(args) {
  const options = {
    run: false,
    cycles: 1,
    intervalMs: 60000,
    exercise: 'standard'
  };
  const seen = new Set();
  for (const arg of args) {
    const [name, value, extra] = arg.split('=');
    if (seen.has(name) || extra !== undefined)
      throw new Error('Invalid or repeated assurance option.');
    seen.add(name);
    if (name === '--run' && value === undefined) {
      options.run = true;
      continue;
    }
    if (name === '--plan' && value === undefined) continue;
    if (
      name === '--exercise' &&
      ['standard', 'failure-recovery'].includes(value)
    ) {
      options.exercise = value;
      continue;
    }
    if (name === '--cycles' && /^(?:[1-9]|1[0-2])$/.test(value ?? '')) {
      options.cycles = Number(value);
      continue;
    }
    if (
      name === '--interval-ms' &&
      /^\d+$/.test(value ?? '') &&
      Number(value) >= 1000 &&
      Number(value) <= 60000
    ) {
      options.intervalMs = Number(value);
      continue;
    }
    throw new Error(
      'Use a bounded cycle count (1–12) and interval (1000–60000 ms).'
    );
  }
  if (seen.has('--run') && seen.has('--plan'))
    throw new Error('Choose run or plan.');
  if (options.exercise === 'failure-recovery' && options.cycles < 3)
    throw new Error('Failure/recovery exercise needs at least three cycles.');
  return Object.freeze(options);
}

export const emptyAssuranceEpisodes = () => ({
  definition: 'synthetic-assurance-episodes/v1',
  lastObservedAt: null,
  episodes: []
});

/** Unknown is never recovery. A recurrence creates a new ID; repeated failures retain the episode. */
export function observeAssuranceEpisodes(
  state,
  checks,
  at,
  makeId = randomUUID
) {
  if (
    !Number.isFinite(Date.parse(at)) ||
    (state.lastObservedAt && Date.parse(at) < Date.parse(state.lastObservedAt))
  )
    throw new Error('Assurance observations must be current.');
  const byId = new Map();
  for (const check of checks) {
    if (
      !ASSURANCE_CHECKS.includes(check.id) ||
      byId.has(check.id) ||
      !['passed', 'failed', 'unavailable'].includes(check.status)
    )
      throw new Error('Invalid assurance observation.');
    byId.set(check.id, check);
  }
  const episodes = state.episodes.map((episode) => ({ ...episode }));
  const events = [];
  for (const id of ASSURANCE_CHECKS) {
    const check = byId.get(id);
    const status = check?.status ?? 'unavailable';
    const current = episodes.find(
      (episode) => episode.check === id && episode.resolvedAt === null
    );
    if (status === 'passed') {
      if (current) {
        current.resolvedAt = at;
        events.push({ type: 'resolved', id: current.id, check: id, at });
      }
      continue;
    }
    if (current) {
      current.lastSeenAt = at;
      current.observations++;
      current.status = status;
    } else {
      const episode = {
        id: makeId(),
        check: id,
        status,
        openedAt: at,
        lastSeenAt: at,
        resolvedAt: null,
        observations: 1
      };
      episodes.push(episode);
      events.push({ type: 'opened', id: episode.id, check: id, at });
    }
  }
  return { state: { ...state, lastObservedAt: at, episodes }, events };
}
