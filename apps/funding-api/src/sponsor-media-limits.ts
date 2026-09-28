// Keep the upload envelope below the 9 MiB limits in Nginx and Traefik.
export const SPONSOR_MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES = 128 * 1024;

export function loadSponsorMediaLimits(env: NodeJS.ProcessEnv) {
  const parse = (name: string, fallback: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
    return value;
  };
  return {
    maxUploadBytes: parse(
      'FUNDING_SPONSOR_MEDIA_MAX_BYTES',
      SPONSOR_MEDIA_MAX_UPLOAD_BYTES,
      SPONSOR_MEDIA_MAX_UPLOAD_BYTES
    ),
    maxSupportingImages: parse(
      'FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES',
      3,
      Number.MAX_SAFE_INTEGER
    )
  };
}
