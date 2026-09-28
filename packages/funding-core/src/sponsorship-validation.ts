/** Shared by the private follow-up form and its API. Drafts may be incomplete. */
export const isSafeSponsorshipText = (
  value: unknown,
  multiline = false
): value is string =>
  typeof value === 'string' &&
  !(
    multiline
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
      : /[\u0000-\u001f\u007f]/
  ).test(value);

export const isSponsorshipEmail = (
  value: unknown,
  maxLength = 200
): value is string => {
  if (!isSafeSponsorshipText(value) || value.length > maxLength) return false;
  const parts = value.trim().split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return (
    local.length <= 64 &&
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(
      local
    ) &&
    domain.includes('.') &&
    domain
      .split('.')
      .every((label) =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)
      )
  );
};

export const isSponsorshipHttpsUrl = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return true;
  if (!isSafeSponsorshipText(value) || value.length > 2048) return false;
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    // Public company links use DNS names, never local hosts or IP literals.
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      host.includes('.') &&
      !host.includes(':') &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
      !/(^|\.)(localhost|local|internal)$/.test(host)
    );
  } catch {
    return false;
  }
};
