import { publicationSourceUncertainSql } from '../fund-publication-draft-retirement.persistence.js';

/** Internal SQL aliases only. Payment and consent permit private preparation, never approval. */
export const preparationMaterializationScopeSql = `c.contribution_type='sponsorship_interest' AND c.status='paid'
  AND c.public_display_consent IS TRUE AND c.sponsor_review_status IN ('pending_review','approved')
  AND NULLIF(btrim(c.sponsor_company_name),'') IS NOT NULL AND c.sponsor_feed_status<>'hidden'`;

/**
 * Shared by preparation's INSERT and the read-only dossier forecast. The same next
 * recorded passage, authoritative identity and initial content are used by both.
 * Expressions are internal SQL, never interpolated request values.
 */
export const preparationMaterializationSql = (
  target: string,
  channel: string,
  contributionScope: string
) => `SELECT c.id AS contribution_id,c.sponsor_company_name AS name,
    ${target}::text AS feed_target,${channel}::text AS channel,
    CASE WHEN ${channel}='linkedin' THEN 'Un partenaire engagé : ' ELSE 'Merci à ' END || c.sponsor_company_name AS title,
    COALESCE(NULLIF(btrim(c.sponsor_public_summary),''),'Merci de soutenir le Fonds des Bâtisseurs OpenG7.') AS body,
    'Commandite rémunérée.' AS disclosure_text,passage.id AS obligation_id,
    COALESCE(passage.publication_format,'collective_text') AS publication_format,
    passage.ordinal,GREATEST(c.created_at,COALESCE(c.paid_at,c.created_at),passage.created_at) AS first_created_at,
    c.created_at AS contribution_created_at
  FROM fund_contributions c
  JOIN LATERAL(SELECT o.id,o.ordinal,o.created_at,o.publication_format FROM sponsorship_obligations o
    JOIN sponsorship_commitments a ON a.id=o.commitment_id
    WHERE a.state='active' AND o.contribution_id=c.id AND o.channel=${channel} AND o.target=${target} AND o.state IN ('pending','blocked')
    ORDER BY o.ordinal,o.id LIMIT 1) passage ON TRUE
  WHERE ${preparationMaterializationScopeSql} AND ${contributionScope}
    AND NOT ${publicationSourceUncertainSql('c.id', channel)}
    AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts existing WHERE existing.contribution_id=c.id AND existing.feed_target=${target} AND existing.channel=${channel} AND existing.status NOT IN ('published','cancelled','rejected'))
    AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts refusal WHERE refusal.contribution_id=c.id AND refusal.feed_target=${target} AND refusal.channel=${channel}
      AND refusal.status='rejected' AND (refusal.obligation_id IS NULL OR refusal.obligation_id=passage.id))`;
