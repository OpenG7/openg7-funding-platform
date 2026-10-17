/** Shared actor labels for administrative history surfaces. */
export function adminHistoryActor(
  rawActor: string,
  t: (key: string) => string
): { actorLabel: string; actorDetail?: string } {
  const actor = rawActor.trim();
  let key: string | undefined;
  if (
    actor === 'sponsor' ||
    actor === 'sponsor-followup' ||
    actor.startsWith('sponsor:')
  ) {
    key = 'sponsor';
  } else if (actor === 'funding-admin-session') {
    key = 'adminSession';
  } else if (actor.startsWith('admin:')) {
    key = 'admin';
  } else if (actor === 'public-recovery') {
    key = 'publicRecovery';
  } else if (actor.startsWith('system:')) {
    key = 'system';
  } else if (!actor) {
    key = 'unavailable';
  }
  return {
    actorLabel: key ? t('admin.history.actors.' + key) : actor,
    actorDetail: key && actor ? rawActor : undefined
  };
}
