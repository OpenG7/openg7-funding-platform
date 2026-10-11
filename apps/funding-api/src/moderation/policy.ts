export class ModerationError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
    this.name = 'ModerationError';
  }
}

/** Expressions come from API-owned SQL, never request values. */
export function moderationApprovedSql(
  subjectType: string,
  subjectIdExpression: string
): string {
  if (
    ![
      'sponsorship',
      'media',
      'publication_draft',
      'publication_delivery'
    ].includes(subjectType)
  )
    throw new Error('Unknown moderation subject.');
  return `EXISTS (SELECT 1 FROM moderation_cases mc JOIN moderation_decisions md ON md.id=mc.current_decision_id JOIN moderation_policies mp ON mp.version=md.policy_version WHERE mc.subject_type='${subjectType}' AND mc.subject_id=${subjectIdExpression} AND mc.state='approved' AND md.level='N0' AND md.content_version=mc.current_content_version AND md.content_fingerprint=mc.current_fingerprint AND mp.editorial_status='approved' AND NOT EXISTS(SELECT 1 FROM moderation_appeals ma JOIN moderation_decisions mad ON mad.id=ma.decision_id WHERE mad.case_id=mc.id AND ma.state='open'))`;
}

/** Existing public facts survive adoption; this expression grants no new approval. */
export function moderationVisibleSql(
  subjectType: string,
  subjectIdExpression: string
): string {
  const approved = moderationApprovedSql(subjectType, subjectIdExpression);
  return `(${approved} OR EXISTS(SELECT 1 FROM moderation_legacy_visibility mlv WHERE mlv.subject_type='${subjectType}' AND mlv.subject_id=${subjectIdExpression} AND mlv.invalidated_at IS NULL AND mlv.content_fingerprint=encode(digest(moderation_snapshot('${subjectType}',${subjectIdExpression})::text,'sha256'),'hex') AND NOT EXISTS(SELECT 1 FROM moderation_cases legacy_case WHERE legacy_case.subject_type=mlv.subject_type AND legacy_case.subject_id=mlv.subject_id AND legacy_case.current_decision_id IS NOT NULL)))`;
}
