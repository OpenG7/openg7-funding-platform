import { createHash, randomBytes } from 'node:crypto';

import type {
  AdminAssistantPrepareResponse,
  AdminInformationRequest,
  AdminMediaConsentSnapshotEntry,
  SponsorMediaAsset
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import type { SponsorshipAssistantDataset } from './admin-assistant/context.repository.js';
import { queueSponsorshipInformationRequest } from './email-notification.service.js';
import { buildSponsorshipFollowupUrl } from './sponsorship-followup-links.js';
import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from './sponsorship-admin-presentation.js';
import { canRequestSponsorshipMediaConsent } from './sponsorship-review-policy.js';

export interface SponsorshipMediaConsentAccessOptions {
  readonly baseUrl: string;
  readonly ttlDays: number;
}

/** Only current, fingerprinted photos can receive a new platform terms acceptance. */
export async function readSponsorshipMediaConsentAssets(
  db: Pool | PoolClient,
  source: {
    readonly record: { readonly contributionId: string };
    readonly media: readonly SponsorMediaAsset[];
  }
): Promise<readonly SponsorMediaAsset[]> {
  const candidates = source.media.filter(
    (asset) =>
      asset.kind === 'supporting_image' &&
      asset.reviewStatus !== 'rejected' &&
      asset.usage?.state !== 'confirmed' &&
      asset.usage?.state !== 'withdrawn'
  );
  if (!candidates.length) return [];
  const rows = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM sponsor_media_assets
    WHERE contribution_id=$1::uuid AND id=ANY($2::uuid[]) AND deleted_at IS NULL
      AND original_checksum_sha256 ~ '^[a-f0-9]{64}$'`,
    [source.record.contributionId, candidates.map((asset) => asset.id)]
  );
  const fingerprinted = new Set(rows.rows.map((row) => row.id));
  return candidates
    .filter((asset) => fingerprinted.has(asset.id))
    .sort((first, second) => first.id.localeCompare(second.id));
}

export const sponsorshipMediaConsentSnapshot = (
  assets: readonly Pick<SponsorMediaAsset, 'id' | 'version'>[]
): readonly AdminMediaConsentSnapshotEntry[] =>
  assets
    .map(({ id, version }) => ({ id, version }))
    .sort((first, second) => first.id.localeCompare(second.id));

/** Deterministic private preview: generating it issues no token and queues no email. */
export function prepareSponsorshipMediaConsentRequest(
  source: SponsorshipAssistantDataset,
  assets: readonly SponsorMediaAsset[],
  language: 'fr-CA' | 'en'
): AdminAssistantPrepareResponse {
  const english = language === 'en';
  if (!canRequestSponsorshipMediaConsent(source, assets.length))
    return {
      status: 'not_applicable',
      draft: null,
      message: english
        ? 'No eligible photos or valid payment email are available for a photo consent request.'
        : 'Aucune photo admissible ou adresse de paiement valide ne permet de demander un consentement aux photos.'
    };
  const reference = sponsorshipRef(source.record);
  const subject = english
    ? `Your permission to use the sponsorship photos (${reference})`
    : `Votre accord pour utiliser les photos de commandite (${reference})`;
  const bodyLines = english
    ? [
        'Hello,',
        `Please review the ${assets.length} photos awaiting your permission in sponsorship ${reference}.`,
        'This single private link opens your sponsorship photos. Review the photos and usage terms, then explicitly confirm the uses you authorize. You may leave a photo unconfirmed.',
        'Opening this link or receiving this message does not grant consent. Your choices and acceptance of the terms are recorded only after your explicit confirmation. Do not share this private link.',
        'Thank you,',
        'The OpenG7 team'
      ]
    : [
        'Bonjour,',
        `Veuillez examiner les ${assets.length} photos en attente de votre accord dans la commandite ${reference}.`,
        'Ce lien privé unique ouvre les photos de votre commandite. Consultez les photos et les conditions d’utilisation, puis confirmez explicitement les usages que vous autorisez. Vous pouvez laisser une photo sans confirmation.',
        'L’ouverture du lien et la réception de ce message ne valent pas consentement. Vos choix et votre acceptation des conditions sont enregistrés uniquement après votre confirmation explicite. Ne partagez pas ce lien privé.',
        'Merci,',
        'L’équipe OpenG7'
      ];
  return {
    status: 'ok',
    message: null,
    draft: {
      type: 'sponsorship_media_consent_request',
      generatedAt: source.dataset.now.toISOString(),
      reference,
      title: english
        ? `Photo consent request — ${reference}`
        : `Demande de consentement aux photos — ${reference}`,
      fields: [
        { label: english ? 'Subject' : 'Objet', value: subject },
        {
          label: 'Photos',
          value: assets.map((asset) => asset.originalFilename).join(', ')
        }
      ],
      bodyLines,
      adminUrl: sponsorshipAdminUrl(source.record.contributionId, 'media'),
      notice: english
        ? 'Nothing has been sent. One private link to the sponsorship photos will be added automatically after you confirm delivery to the payment email.'
        : 'Aucun message n’a été envoyé. Un seul lien privé vers les photos de la commandite sera ajouté automatiquement après votre confirmation d’envoi à l’adresse de paiement.',
      limitations: [
        english
          ? 'This request records no photo consent and grants no approval or publication authority.'
          : 'Cette demande n’enregistre aucun consentement aux photos et n’accorde aucune approbation ni autorisation de publication.'
      ],
      sent: false,
      published: false,
      persisted: false
    },
    delivery: {
      purpose: 'media_consent',
      language,
      mediaSnapshot: sponsorshipMediaConsentSnapshot(assets),
      contributionId: source.record.contributionId,
      contextVersion: source.version,
      recipient: source.accessRecipient!,
      subject,
      body: bodyLines.join('\n\n')
    }
  };
}

export function validSponsorshipMediaConsentAccessOptions(
  options: SponsorshipMediaConsentAccessOptions | undefined
): options is SponsorshipMediaConsentAccessOptions {
  if (
    !options ||
    !Number.isSafeInteger(options.ttlDays) ||
    options.ttlDays <= 0
  )
    return false;
  try {
    const url = new URL(options.baseUrl);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** The caller owns the transaction; no SMTP call or token leaves this server-side flow. */
export async function queueSponsorshipMediaConsentRequest(
  db: PoolClient,
  input: AdminInformationRequest,
  idempotencyKey: string,
  options: SponsorshipMediaConsentAccessOptions
) {
  const token = randomBytes(32).toString('base64url');
  const url = new URL(
    buildSponsorshipFollowupUrl(options.baseUrl, token, input.language)
  );
  url.searchParams.set('section', 'media-consent');
  const privateUrl = url.toString();
  const result = await queueSponsorshipInformationRequest(db, {
    ...input,
    idempotencyKey,
    body: input.body + '\n\n' + privateUrl,
    privateLink: {
      url: privateUrl,
      label:
        input.language === 'en'
          ? 'Review my sponsorship photos'
          : 'Examiner les photos de ma commandite'
    }
  });
  if (result.messageId && !result.error && !result.duplicate)
    await db.query(
      `INSERT INTO sponsorship_access_tokens(token_hash,contribution_id,created_at,expires_at,email_message_id)
      VALUES($1,$2::uuid,clock_timestamp(),clock_timestamp()+$3*INTERVAL '1 day',$4::uuid)`,
      [
        createHash('sha256').update(token).digest('hex'),
        input.contributionId,
        options.ttlDays,
        result.messageId
      ]
    );
  return result;
}
