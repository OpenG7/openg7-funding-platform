/** Only explicit validation refusals or a rolled-back version conflict release a captured command. */
export function sponsorMediaMutationRejection(
  status: number,
  code: string | undefined
): 'versionConflict' | 'mutationRejected' | null {
  if (status === 409 && code === 'VERSION_CONFLICT') return 'versionConflict';
  if (
    status === 400 &&
    code &&
    [
      'INVALID_MEDIA_USAGE_REQUEST',
      'INVALID_MEDIA_PREFERENCE',
      'INVALID_MEDIA_PREFERENCE_DECISION',
      'MEDIA_USAGE_CONFIRMATION_REQUIRED',
      'MEDIA_USAGE_EVIDENCE_REQUIRED',
      'CONFIRMATION_REQUIRED'
    ].includes(code)
  )
    return 'mutationRejected';
  return null;
}
