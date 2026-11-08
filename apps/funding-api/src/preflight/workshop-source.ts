import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { PreflightMission } from './contracts.js';
import type { EnabledPreflightConfig } from './config.js';

export const workshopDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class PublicationWorkshopError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
export function requireWorkshop(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new PublicationWorkshopError(code, status);
}

export interface WorkshopSourceSnapshot {
  contributionId: string;
  commitmentId: string;
  commitmentVersion: number;
  active: boolean;
  publicConsent: boolean;
  displayName: string | null;
  summary: string | null;
  reviewed: boolean;
  websiteHeld: boolean;
  reference: string;
  amountMinor: number;
  currency: string;
  missingInformation: string[];
  destinations: {
    destination: 'website' | 'facebook';
    obligationId: string;
    obligationVersion: number;
    format: 'individual' | 'collective';
    target: 'openg7' | 'openg20';
  }[];
  mediaVersions: { id: string; version: string }[];
  obligationVersions: { id: string; version: number }[];
  mediaPreparationVersions: { id: string; version: string }[];
  consentRecordId: string | null;
  draftBaseline: {
    id: string;
    title: string;
    body: string;
    disclosureText: string;
    obligationId: string | null;
    status: string;
  }[];
  digest: string;
}

/** The private snapshot retains only presence flags for contacts, never their values. */
export async function loadWorkshopSource(
  db: PoolClient,
  contributionId: string
): Promise<WorkshopSourceSnapshot> {
  const row = (
    await db.query<{
      id: string;
      commitment_id: string;
      commitment_version: number;
      state: string;
      status: string;
      amount_minor: number;
      currency: string;
      public_reference: string | null;
      public_display_consent: boolean;
      display_name: string | null;
      public_summary: string | null;
      has_company: boolean;
      has_email: boolean;
      reviewed: boolean;
      refund: string;
      sponsor_site_visibility_held: boolean;
    }>(
      `SELECT c.id,a.id AS commitment_id,a.version AS commitment_version,a.state,c.status,
      c.amount_cents AS amount_minor,c.currency,c.public_reference,c.public_display_consent,
      CASE WHEN c.public_display_consent THEN c.sponsor_company_name END AS display_name,
      CASE WHEN c.public_display_consent THEN c.sponsor_public_summary END AS public_summary,
      NULLIF(btrim(c.sponsor_company_name),'') IS NOT NULL AS has_company,
      NULLIF(btrim(c.sponsor_contact_email),'') IS NOT NULL AS has_email,
      c.sponsor_review_status='approved' AS reviewed,c.sponsorship_refund_status AS refund,c.sponsor_site_visibility_held
    FROM fund_contributions c JOIN sponsorship_commitments a ON a.contribution_id=c.id
    WHERE c.id=$1::uuid AND c.contribution_type='sponsorship_interest'`,
      [contributionId]
    )
  ).rows[0];
  requireWorkshop(row, 'PUBLICATION_WORKSHOP_NOT_FOUND', 404);
  const obligations = (
    await db.query<{
      id: string;
      version: number;
      channel: 'website' | 'facebook';
      target: 'openg7' | 'openg20';
      publication_format: string | null;
    }>(
      `SELECT id,version,channel,target,publication_format FROM sponsorship_obligations
    WHERE contribution_id=$1::uuid AND state IN ('pending','blocked') AND channel IN ('website','facebook')
    ORDER BY channel,target,ordinal,id`,
      [contributionId]
    )
  ).rows;
  const media = (
    await db.query<{ id: string; version: string }>(
      `SELECT id,updated_at::text AS version
    FROM sponsor_media_assets WHERE contribution_id=$1::uuid ORDER BY id`,
      [contributionId]
    )
  ).rows;
  const drafts = (
    await db.query<{
      id: string;
      title: string;
      body: string;
      disclosureText: string;
      obligationId: string | null;
      status: string;
    }>(
      `SELECT id,title,body,disclosure_text AS "disclosureText",obligation_id AS "obligationId",status FROM sponsor_publication_drafts
      WHERE contribution_id=$1::uuid AND status NOT IN ('published','cancelled','rejected') ORDER BY id`,
      [contributionId]
    )
  ).rows;
  const mediaPreparationVersions = (
    await db.query<{ id: string; version: string }>(
      `SELECT id,updated_at::text AS version
    FROM sponsor_media_preparation_assignments WHERE contribution_id=$1::uuid ORDER BY id`,
      [contributionId]
    )
  ).rows;
  const consentRecordId =
    (
      await db.query<{ id: string }>(
        `SELECT id FROM admin_sponsorship_consent_records
    WHERE contribution_id=$1::uuid ORDER BY recorded_at DESC,id DESC LIMIT 1`,
        [contributionId]
      )
    ).rows[0]?.id ?? null;
  const missingInformation = [
    ...(!row.has_company ? ['organization'] : []),
    ...(!row.has_email ? ['contact_email'] : []),
    ...(!row.public_display_consent ? ['public_name_consent'] : []),
    ...(!row.display_name?.trim() ? ['public_name'] : []),
    ...(!row.public_summary?.trim() ? ['public_presentation'] : [])
  ];
  const nextDestinations = new Map<string, (typeof obligations)[number]>();
  for (const obligation of obligations) {
    const key = obligation.channel + ':' + obligation.target;
    if (!nextDestinations.has(key)) nextDestinations.set(key, obligation);
  }
  const snapshot = {
    contributionId,
    commitmentId: row.commitment_id,
    commitmentVersion: row.commitment_version,
    active:
      row.state === 'active' &&
      row.status === 'paid' &&
      !['requested', 'processing', 'completed'].includes(row.refund),
    publicConsent: row.public_display_consent,
    displayName: row.display_name?.trim() || null,
    summary: row.public_summary?.trim() || null,
    reviewed: row.reviewed === true,
    websiteHeld: row.sponsor_site_visibility_held,
    reference: row.public_reference ?? contributionId,
    amountMinor: row.amount_minor,
    currency: row.currency,
    missingInformation,
    destinations: [...nextDestinations.values()].map((o) => ({
      destination: o.channel,
      obligationId: o.id,
      obligationVersion: o.version,
      format: (o.channel === 'website' ||
      o.publication_format?.startsWith('individual')
        ? 'individual'
        : 'collective') as 'individual' | 'collective',
      target: o.target
    })),
    mediaVersions: media,
    obligationVersions: obligations.map((o) => ({
      id: o.id,
      version: o.version
    })),
    mediaPreparationVersions,
    consentRecordId,
    draftBaseline: drafts
  };
  // Operational review/status changes are not editorial source changes.
  const digest = workshopDigest({
    ...snapshot,
    reviewed: undefined,
    websiteHeld: undefined,
    draftBaseline: drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      body: draft.body,
      disclosureText: draft.disclosureText,
      obligationId: draft.obligationId
    }))
  });
  return { ...snapshot, digest };
}

/** This wire snapshot never includes contact details, unconsented identity, source media URLs or manual drafts. */
export function buildWorkshopMission(
  config: EnabledPreflightConfig,
  snapshot: WorkshopSourceSnapshot,
  sourceVersion: number,
  missionId: string,
  eventId: string
): PreflightMission {
  const sourceFacts =
    snapshot.publicConsent && snapshot.displayName
      ? [
          { key: 'publicName', value: snapshot.displayName },
          ...(snapshot.summary
            ? [{ key: 'publicPresentation', value: snapshot.summary }]
            : [])
        ]
      : [];
  return {
    schemaVersion: '1.0',
    missionId,
    eventId,
    tenantId: config.tenantId,
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship-commitment',
      subjectId: snapshot.commitmentId,
      version: sourceVersion
    },
    workflow: { type: 'sponsorship-preparation-v1', version: '1.0' },
    priority: 'normal',
    constraints: {
      humanApprovalRequired: true,
      maxCostUsd: config.maxCostUsd,
      timeoutMs: 30000,
      maxAttempts: 3
    },
    input: {
      title: 'Préparation éditoriale de commandite',
      description:
        snapshot.summary ||
        'Préparation privée et partielle des prestations enregistrées. Les informations manquantes doivent rester signalées.',
      benefits: snapshot.destinations.map(
        (d) => `${d.destination}: ${d.format}`
      ),
      sourceSnapshotDigest: snapshot.digest,
      sourceCommitmentVersion: snapshot.commitmentVersion,
      preparationOnly: true,
      editorialContext: {
        schemaVersion: '1.0',
        sourceCommitmentId: snapshot.commitmentId,
        sourceSnapshotDigest: snapshot.digest,
        commitmentVersion: snapshot.commitmentVersion,
        publicIdentity: {
          consent: snapshot.publicConsent,
          ...(snapshot.displayName ? { displayName: snapshot.displayName } : {})
        },
        sourceFacts,
        missingInformation: snapshot.missingInformation,
        destinations: snapshot.destinations.map((destination) => ({
          destination: destination.destination,
          obligationId: destination.obligationId,
          obligationVersion: destination.obligationVersion,
          format: destination.format
        })),
        mediaReferences: []
      }
    }
  };
}
