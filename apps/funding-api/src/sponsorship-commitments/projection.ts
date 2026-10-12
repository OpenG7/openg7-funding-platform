import { sponsorshipObligationTimingProjectionSql } from '../sponsorship-obligation-timing.read.js';

/** The expression is an API-owned contribution column, never browser input. */
export const sponsorshipCommitmentProjectionSql = (
  contributionIdExpression: string
): string => {
  if (!/^[a-z_][a-z0-9_]*\.id$/.test(contributionIdExpression))
    throw new Error('Invalid commercial projection scope.');
  return `(SELECT jsonb_build_object('id',m.id,'contributionId',m.contribution_id,'offerId',m.offer_id,'provenance',m.provenance,'state',m.state,
    'qualificationReason',m.qualification_reason,'version',m.version,'offer',o.snapshot,'obligations',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ob.id,'commitmentId',ob.commitment_id,'contributionId',ob.contribution_id,
      'benefitId',ob.benefit_id,'channel',ob.channel,'target',ob.target,'format',ob.publication_format,'ordinal',ob.ordinal,'state',ob.state,'blockedReason',ob.blocked_reason,
      'version',ob.version,'fulfilmentEvidenceId',ob.fulfilment_evidence_id,'timing',${sponsorshipObligationTimingProjectionSql('ob')}) ORDER BY ob.channel,ob.target,ob.ordinal,ob.id)
      FROM sponsorship_obligations ob WHERE ob.commitment_id=m.id),'[]'::jsonb))
    FROM sponsorship_commitments m LEFT JOIN sponsorship_offers o ON o.id=m.offer_id WHERE m.contribution_id=${contributionIdExpression})`;
};
