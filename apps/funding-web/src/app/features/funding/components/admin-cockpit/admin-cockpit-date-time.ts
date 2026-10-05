/** Cockpit timestamps use the current locale and the observed Toronto time. */
export function formatCockpitDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'America/Toronto',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}
