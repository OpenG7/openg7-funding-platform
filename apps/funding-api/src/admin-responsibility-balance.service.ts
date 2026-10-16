import type {
  AdminPaymentJourney,
  ResponsibilityBalance,
  ResponsibilityBalanceEvidence,
  ResponsibilityBalanceObligation,
  SponsorshipCommitmentRecord,
  SponsorshipObligation,
  SponsorshipOfferedBenefit
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { normalizeSponsorshipOfferSnapshot } from '../../../packages/funding-core/src/index.js';

import { isValidUuid } from './business-helpers/request-validation.js';
import { loadPaymentJourneyOnClient } from './admin-payment-journey.service.js';
import { pilotageVersion } from './admin-pilotage-version.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { loadSponsorshipCommitment } from './sponsorship-commitments.repository.js';
import { sponsorshipOfferFingerprint } from './sponsorship-commitments/offers.js';
import { dossierFulfilmentQualificationSql } from './sponsorship-commitments/historical-audit-projection.js';

export class ResponsibilityBalanceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503
  ) {
    super(code);
  }
}

export interface ResponsibilityEvidenceFact extends ResponsibilityBalanceEvidence {
  readonly mode: string;
  /** Same recorded-source qualification as the existing historical audit. */
  readonly qualifiedSnapshot: boolean;
}

export interface ResponsibilityChangeFact {
  readonly id: string;
  readonly obligationId: string;
  readonly commitmentId: string;
  readonly kind: 'destination' | 'format' | 'waiver';
  readonly previousValue: {
    readonly state: string;
    readonly target: string;
    readonly format: string | null;
    readonly version: number;
  };
  readonly resultingValue: ResponsibilityChangeFact['previousValue'];
  readonly audited: boolean;
}

export interface ResponsibilityBalanceFacts {
  readonly journey: AdminPaymentJourney;
  readonly paidAt: string | null;
  readonly contributionVersion: string;
  readonly commitment: SponsorshipCommitmentRecord | null;
  readonly offerFingerprint: string | null;
  readonly evidence: readonly ResponsibilityEvidenceFact[];
  readonly changes: readonly ResponsibilityChangeFact[];
}

const exactEvidence = (
  obligation: SponsorshipObligation,
  evidence: ResponsibilityEvidenceFact
): boolean =>
  evidence.id === obligation.fulfilmentEvidenceId &&
  evidence.obligationId === obligation.id &&
  evidence.contributionId === obligation.contributionId &&
  evidence.channel === obligation.channel &&
  evidence.target === obligation.target &&
  evidence.obligationVersion + 1 === obligation.version &&
  evidence.mode === 'live' &&
  Number.isFinite(Date.parse(evidence.deliveredAt)) &&
  (obligation.channel === 'website'
    ? evidence.provenance === 'website_verified'
    : ['provider_acknowledged', 'provider_verified'].includes(
        evidence.provenance
      ));

/** Immutable amendments must form the same reviewed destination/format history. */
function validAmendments(
  obligation: SponsorshipObligation,
  benefit: SponsorshipOfferedBenefit,
  changes: readonly ResponsibilityChangeFact[]
): boolean {
  let target: string = benefit.target;
  let format: string | null = benefit.format ?? null;
  let version = 1;
  for (const change of changes) {
    if (
      !change.audited ||
      change.commitmentId !== obligation.commitmentId ||
      change.previousValue.target !== target ||
      change.previousValue.format !== format ||
      change.previousValue.version !== version ||
      change.resultingValue.version !== version + 1 ||
      !['pending', 'blocked'].includes(change.previousValue.state)
    )
      return false;
    if (change.kind === 'waiver') {
      if (
        change.resultingValue.state !== 'adjusted' ||
        change.resultingValue.target !== target ||
        change.resultingValue.format !== format
      )
        return false;
    } else if (
      change.resultingValue.state !== change.previousValue.state ||
      (change.kind === 'destination'
        ? !['openg7', 'openg20'].includes(change.resultingValue.target) ||
          change.resultingValue.format !== format
        : change.resultingValue.target !== target ||
          obligation.channel === 'website' ||
          ![
            'collective_text',
            'individual_portrait',
            'collective_composite',
            'image_collection'
          ].includes(change.resultingValue.format ?? ''))
    )
      return false;
    target = change.resultingValue.target;
    format = change.resultingValue.format;
    version = change.resultingValue.version;
  }
  return (
    target === obligation.target &&
    format === (obligation.format ?? null) &&
    version + (obligation.state === 'fulfilled' ? 1 : 0) ===
      obligation.version &&
    (obligation.state === 'adjusted') === (changes.at(-1)?.kind === 'waiver')
  );
}

/** A balance describes recorded responsibilities; it grants no action or financial authority. */
export function buildResponsibilityBalance(
  facts: ResponsibilityBalanceFacts,
  now = new Date()
): ResponsibilityBalance {
  const { journey, commitment } = facts;
  if (
    !Number.isSafeInteger(journey.amountMinor) ||
    journey.amountMinor < 0 ||
    !/^[A-Z]{3}$/.test(journey.currency) ||
    !Number.isFinite(now.getTime())
  )
    throw new ResponsibilityBalanceError('BALANCE_FACTS_INVALID');
  const reasons = new Set<string>();
  const unresolved = new Set<string>();
  const projected: ResponsibilityBalanceObligation[] = [];
  let promisedBenefits: readonly SponsorshipOfferedBenefit[] = [];
  let expected = 0;
  let fulfilled = 0;
  let waived = 0;
  let unknown = 0;
  let waiting = 0;
  let blocked = false;
  const unknownReason = (reason: string) => {
    reasons.add(reason);
    unknown++;
  };
  if (!facts.paidAt || !Number.isFinite(Date.parse(facts.paidAt)))
    unknownReason('payment_confirmation_unknown');
  if (
    !['personal_support', 'sponsorship_interest'].includes(
      journey.contributionType
    )
  )
    unknownReason('contribution_type_unknown');
  if (!['paid', 'refunded', 'disputed'].includes(journey.paymentStatus)) {
    reasons.add('payment_unconfirmed');
    blocked = true;
  }
  if (['refunded', 'disputed'].includes(journey.paymentStatus)) {
    reasons.add(`payment_${journey.paymentStatus}`);
    if (journey.paymentStatus === 'disputed') blocked = true;
  }
  if (journey.contributionType === 'sponsorship_interest') {
    if (
      commitment?.state !== 'active' ||
      !commitment.offer ||
      commitment.contributionId !== journey.contributionId
    ) {
      unknownReason('commitment_needs_confirmation');
    } else {
      let benefits: readonly SponsorshipOfferedBenefit[] = [];
      try {
        benefits = normalizeSponsorshipOfferSnapshot(commitment.offer).benefits;
        const fingerprintMatches =
          sponsorshipOfferFingerprint(commitment.offer) ===
          facts.offerFingerprint;
        if (fingerprintMatches) promisedBenefits = benefits;
        if (
          commitment.offer.amountMinor !== journey.amountMinor ||
          commitment.offer.currency !== journey.currency ||
          !fingerprintMatches
        )
          unknownReason('offer_payment_mismatch');
      } catch {
        unknownReason('offer_invalid');
      }
      expected = benefits.reduce(
        (total, benefit) => total + benefit.quantity,
        0
      );
      const keys = new Set<string>();
      const ids = new Set<string>();
      for (const obligation of commitment.obligations) {
        const benefit = benefits.find((b) => b.id === obligation.benefitId);
        const key = `${obligation.benefitId}:${obligation.ordinal}`;
        let invalid = false;
        if (
          !benefit ||
          obligation.commitmentId !== commitment.id ||
          obligation.contributionId !== journey.contributionId ||
          obligation.channel !== benefit.channel ||
          !Number.isSafeInteger(obligation.ordinal) ||
          obligation.ordinal < 1 ||
          obligation.ordinal > benefit.quantity ||
          keys.has(key) ||
          ids.has(obligation.id)
        ) {
          unknownReason('obligation_offer_mismatch');
          invalid = true;
        }
        ids.add(obligation.id);
        keys.add(key);
        if (
          benefit &&
          !validAmendments(
            obligation,
            benefit,
            facts.changes.filter(
              (change) => change.obligationId === obligation.id
            )
          )
        ) {
          unknownReason('obligation_amendment_unverified');
          invalid = true;
        }
        const timing = obligation.timing;
        if (
          benefit &&
          (!timing ||
            timing.deadlineDays !== benefit.deadlineDays ||
            timing.durationDays !== benefit.durationDays)
        ) {
          unknownReason('obligation_timing_unknown');
          invalid = true;
        }
        let evidence: ResponsibilityBalanceEvidence | undefined;
        if (obligation.state === 'fulfilled') {
          const match = facts.evidence.find((e) =>
            exactEvidence(obligation, e)
          );
          if (!match) {
            unknownReason('fulfilment_evidence_mismatch');
            invalid = true;
          } else if (match.qualifiedSnapshot !== true) {
            unknownReason('fulfilment_snapshot_unqualified');
            invalid = true;
          } else if (
            benefit?.durationDays !== null &&
            timing?.durationState !== 'attested'
          ) {
            unknownReason('duration_attestation_missing');
            invalid = true;
          } else if (!invalid) {
            evidence = {
              id: match.id,
              obligationId: match.obligationId,
              contributionId: match.contributionId,
              obligationVersion: match.obligationVersion,
              channel: match.channel,
              target: match.target,
              provenance: match.provenance,
              deliveredAt: match.deliveredAt,
              externalPostUrl: match.externalPostUrl
            };
            fulfilled++;
            if (
              timing?.dueAt &&
              Date.parse(match.deliveredAt) > Date.parse(timing.dueAt)
            )
              reasons.add('delivery_late');
          }
        } else if (obligation.state === 'adjusted') {
          if (!invalid) waived++;
        } else {
          unresolved.add(obligation.id);
          if (obligation.state === 'blocked') {
            blocked = true;
            reasons.add(obligation.blockedReason ?? 'obligation_blocked');
          }
          if (benefit?.deadlineDays != null && !timing?.originAt) {
            unknownReason('deadline_origin_unknown');
          } else if (
            timing?.durationState === 'awaiting_review' &&
            timing.startObservation &&
            Date.parse(timing.startObservation.earliestCompletionAt) >
              now.getTime()
          ) {
            waiting++;
            reasons.add('duration_in_progress');
          } else if (timing?.durationState === 'restart_required') {
            blocked = true;
            reasons.add('duration_restart_required');
          }
        }
        projected.push({
          id: obligation.id,
          benefitId: obligation.benefitId,
          channel: obligation.channel,
          target: obligation.target,
          ordinal: obligation.ordinal,
          format: obligation.format ?? null,
          state: obligation.state,
          version: obligation.version,
          ...(timing ? { timing } : {}),
          ...(evidence ? { evidence } : {})
        });
      }
      for (const benefit of benefits) {
        for (let ordinal = 1; ordinal <= benefit.quantity; ordinal++) {
          if (!keys.has(`${benefit.id}:${ordinal}`))
            unknownReason('promised_obligation_missing');
        }
      }
      if (
        facts.evidence.some(
          (e) =>
            !commitment.obligations.some(
              (obligation) =>
                obligation.state === 'fulfilled' && exactEvidence(obligation, e)
            )
        )
      )
        unknownReason('orphan_fulfilment_evidence');
    }
  } else if (commitment || facts.evidence.length || facts.changes.length) {
    unknownReason('personal_payment_has_sponsorship_records');
  }
  for (const step of journey.steps) {
    if (!['complete', 'not_required'].includes(step.state))
      reasons.add(step.reason);
  }
  const outstanding = Math.max(0, expected - fulfilled - waived);
  // A confirmed refund never dispenses an undelivered promise by itself.
  if (journey.paymentStatus === 'refunded' && outstanding > 0) blocked = true;
  const operational = journey.steps.filter(
    (step) =>
      step.id !== 'publication' &&
      !['complete', 'not_required'].includes(step.state)
  );
  const status: ResponsibilityBalance['status'] = unknown
    ? 'unknown'
    : blocked || operational.some((step) => step.state === 'blocked')
      ? 'blocked'
      : operational.some((step) => step.state === 'error')
        ? 'action_required'
        : outstanding === 0 && operational.length === 0
          ? 'balanced'
          : journey.state === 'waiting' ||
              (outstanding > 0 &&
                waiting === unresolved.size &&
                !operational.length)
            ? 'waiting'
            : 'action_required';
  const next =
    status === 'balanced'
      ? null
      : (journey.next ?? {
          reason: [...reasons][0] ?? 'publication_pending',
          adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${journey.contributionId}&tab=publication`,
          target: 'dossier-publication-journey'
        });
  return {
    contributionId: journey.contributionId,
    reference: journey.reference,
    contributionType: journey.contributionType,
    amountMinor: journey.amountMinor,
    currency: journey.currency,
    paymentStatus: journey.paymentStatus,
    version: pilotageVersion({ facts, status, reasons: [...reasons] }),
    status,
    expected,
    fulfilled,
    waived,
    outstanding,
    unknown,
    reasons: [...reasons],
    promisedBenefits,
    obligations: projected,
    next
  };
}

/** All payment, offer, evidence, timing and operational reads share one immutable snapshot. */
export async function loadResponsibilityBalance(
  pool: Pool | null,
  contributionId: string,
  now = new Date()
): Promise<ResponsibilityBalance> {
  if (!isValidUuid(contributionId))
    throw new ResponsibilityBalanceError('INVALID_CONTRIBUTION_ID', 400);
  if (!pool) throw new ResponsibilityBalanceError('BALANCE_UNAVAILABLE');
  return withPostgresTransaction(
    pool,
    (client) => loadResponsibilityBalanceOnClient(client, contributionId, now),
    { readOnlySnapshot: true }
  );
}

export async function loadResponsibilityBalanceOnClient(
  client: PoolClient,
  contributionId: string,
  now = new Date()
): Promise<ResponsibilityBalance> {
  const payment = await client.query<{
    paidAt: string | null;
    contributionVersion: string;
    offerFingerprint: string | null;
    evaluatedAt: string;
  }>(
    `SELECT c.paid_at::text AS "paidAt",c.updated_at::text AS "contributionVersion",
      offer.fingerprint AS "offerFingerprint",transaction_timestamp()::text AS "evaluatedAt" FROM fund_contributions c
    LEFT JOIN sponsorship_commitments commitment ON commitment.contribution_id=c.id
    LEFT JOIN sponsorship_offers offer ON offer.id=commitment.offer_id WHERE c.id=$1::uuid`,
    [contributionId]
  );
  const paymentFacts = payment.rows[0];
  if (!paymentFacts)
    throw new ResponsibilityBalanceError('CONTRIBUTION_NOT_FOUND', 404);
  const { evaluatedAt, ...facts } = paymentFacts;
  const { journey } = await loadPaymentJourneyOnClient(
    client,
    contributionId,
    now
  );
  if (!journey) throw new ResponsibilityBalanceError('BALANCE_UNAVAILABLE');
  const commitment = await loadSponsorshipCommitment(client, contributionId);
  const evidence = await client.query<ResponsibilityEvidenceFact>(
    `${dossierFulfilmentQualificationSql}
    SELECT proof.id,proof.obligation_id AS "obligationId",proof.contribution_id AS "contributionId",
      proof.obligation_version AS "obligationVersion",proof.channel,proof.target,proof.mode,proof.provenance,
      proof.delivered_at::text AS "deliveredAt",proof.external_post_url AS "externalPostUrl",
      COALESCE(cardinality(classified.findings)=0,FALSE) AS "qualifiedSnapshot"
    FROM sponsorship_fulfilment_evidence proof LEFT JOIN classified ON classified.id=proof.id
    WHERE proof.contribution_id=$2::uuid ORDER BY proof.obligation_id,proof.id`,
    [evaluatedAt, contributionId]
  );
  const changes = await client.query<ResponsibilityChangeFact>(
    `SELECT change.id,change.obligation_id AS "obligationId",change.commitment_id AS "commitmentId",
      change.kind,change.previous_value AS "previousValue",change.resulting_value AS "resultingValue",
      EXISTS(SELECT 1 FROM admin_audit_log audit WHERE audit.action='sponsorship_commitment.'||change.kind
        AND audit.entity_type='sponsorship' AND audit.entity_id=$1 AND audit.actor=change.actor
        AND audit.metadata->>'requestId'=change.request_id::text) AS audited
    FROM sponsorship_commitment_changes change JOIN sponsorship_commitments commitment ON commitment.id=change.commitment_id
    WHERE commitment.contribution_id=$1::uuid AND change.kind IN ('destination','format','waiver')
    ORDER BY (change.resulting_value->>'version')::integer,change.id`,
    [contributionId]
  );
  return buildResponsibilityBalance(
    {
      ...facts,
      journey,
      commitment,
      evidence: evidence.rows,
      changes: changes.rows
    },
    now
  );
}
