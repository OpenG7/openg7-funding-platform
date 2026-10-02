export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('fr-CA', {
    currency: currency.toUpperCase(),
    style: 'currency'
  }).format(amount);

export const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

export const formatDate = (iso: string | null): string => {
  if (!iso) {
    return 'Date non disponible';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Toronto'
  }).format(date);
};
