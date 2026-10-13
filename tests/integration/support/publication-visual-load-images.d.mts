import type { Buffer } from 'node:buffer';

export function syntheticHighResolutionPhoto(
  index: number
): Promise<{ bytes: Buffer; quality: number }>;
