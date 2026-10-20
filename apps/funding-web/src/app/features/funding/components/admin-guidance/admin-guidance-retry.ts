import type { Type } from '@angular/core';

export const ADMIN_GUIDANCE_LOAD_RETRIES = 3;

function localChunk(source: string, baseURI: string): URL | null {
  try {
    const base = new URL('.', baseURI);
    const target = new URL(source);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !target.pathname.startsWith(base.pathname) ||
      !/^chunk-[A-Z0-9]+\.js$/.test(target.pathname.slice(base.pathname.length))
    )
      return null;
    return target;
  } catch {
    return null;
  }
}

/** Only native fetch failures can identify a same-origin application chunk to retry. */
export function guidanceChunkRetrySource(
  error: unknown,
  baseURI: string
): string | null {
  if (!(error instanceof TypeError)) return null;
  const source =
    /^(?:Failed to fetch dynamically imported module|error loading dynamically imported module):\s*(https?:\/\/\S+)$/i.exec(
      error.message.trim()
    )?.[1];
  if (!source) return null;
  try {
    const target = new URL(source);
    // Subsequent network failures may name only the retry URL we constructed.
    if (/^\?og7GuideRetry=[1-3]$/.test(target.search)) target.search = '';
    return localChunk(target.href, baseURI)?.href ?? null;
  } catch {
    return null;
  }
}

export function guidanceChunkRetryUrl(
  source: string,
  baseURI: string,
  attempt: number
): string | null {
  const target = localChunk(source, baseURI);
  if (
    !target ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > ADMIN_GUIDANCE_LOAD_RETRIES
  )
    return null;
  target.searchParams.set('og7GuideRetry', String(attempt));
  return target.href;
}

/** An explicit bounded retry bypasses the browser's cached failed module URL. */
export async function loadGuidanceChunkRetry<T>(
  source: string,
  baseURI: string,
  attempt: number,
  exportedName: 'AdminWorkflowGuideComponent' | 'AdminAutomaticComponent'
): Promise<Type<T>> {
  const target = guidanceChunkRetryUrl(source, baseURI, attempt);
  if (!target) throw new TypeError('Guidance module retry unavailable');
  const module: Record<string, unknown> = await import(target);
  if (
    !Object.prototype.hasOwnProperty.call(module, exportedName) ||
    typeof module[exportedName] !== 'function'
  )
    throw new TypeError('Guidance component unavailable');
  return module[exportedName] as Type<T>;
}
