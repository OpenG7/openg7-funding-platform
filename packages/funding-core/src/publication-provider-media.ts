/** Legacy single-image cache or ordered collection; unknown historical references remain unqualified. */
export function linkedinPublicationImageIds(
  value: string | null | undefined
): string[] {
  if (!value) return [];
  if (/^urn:li:image:[A-Za-z0-9_-]+$/.test(value)) return [value];
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) &&
      ids.length <= 10 &&
      ids.every(
        (id) =>
          typeof id === 'string' && /^urn:li:image:[A-Za-z0-9_-]+$/.test(id)
      ) &&
      new Set(ids).size === ids.length
      ? ids
      : [];
  } catch {
    return [];
  }
}
