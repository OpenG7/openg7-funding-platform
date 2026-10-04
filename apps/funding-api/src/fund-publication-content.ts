import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

export interface SponsorDraftSourceRow {
  readonly id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly sponsor_message: string | null;
}

const defaultDisclosureText =
  'Publication commanditee - Fonds des batisseurs OpenG7';

export const createDefaultDraftText = (
  sponsor: SponsorDraftSourceRow,
  feedTarget: SponsorFeedTarget,
  channel: SponsorFeedChannel
): {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
} => {
  const publicSummary =
    sponsor.sponsor_public_summary?.trim() ||
    sponsor.sponsor_message?.trim() ||
    'Cette commandite soutient le developpement independant et open source du projet.';
  const feedName = feedTarget === 'openg20' ? 'OpenG20' : 'OpenG7';
  const channelName = channel === 'linkedin' ? 'LinkedIn' : 'Facebook';

  return {
    title: `Commandite de visibilite - ${sponsor.sponsor_company_name}`,
    body: [
      `${feedName} remercie ${sponsor.sponsor_company_name} pour son soutien au Fonds des batisseurs.`,
      publicSummary,
      `Texte prepare pour ${channelName}.`,
      'Transparence: cette publication fait partie d une contrepartie de visibilite associee au Fonds des batisseurs OpenG7.'
    ].join('\n\n'),
    disclosureText: defaultDisclosureText
  };
};

export const truncatePublicationText = (
  value: string,
  maxLength: number
): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const buildSocialPublicationText = (
  batch: AdminPublicationBatchRecord,
  drafts: readonly AdminPublicationDraftRecord[]
): {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly draftIds: readonly string[];
} => {
  const targetNames = new Set(
    drafts.map((draft) =>
      draft.feed_target === 'openg20' ? 'OpenG20' : 'OpenG7'
    )
  );
  const audience = Array.from(targetNames).join(' et ') || 'OpenG7';
  const sponsorLines = drafts.map((draft) => {
    const summary = draft.sponsor_public_summary
      ? truncatePublicationText(draft.sponsor_public_summary, 220)
      : truncatePublicationText(draft.body, 220);
    const website = draft.sponsor_website_url
      ? ` (${draft.sponsor_website_url})`
      : '';

    return `- ${draft.sponsor_company_name}${website}: ${summary}`;
  });

  return {
    title: truncatePublicationText(
      `Merci aux commanditaires du Fonds des batisseurs ${audience}`,
      160
    ),
    body: truncatePublicationText(
      [
        `${audience} remercie ces organisations pour leur soutien au Fonds des batisseurs.`,
        sponsorLines.join('\n'),
        `Publication collective ${batch.channel === 'linkedin' ? 'LinkedIn' : 'Facebook'} preparee depuis le cockpit admin.`
      ].join('\n\n'),
      2500
    ),
    disclosureText: defaultDisclosureText,
    draftIds: drafts.map((draft) => draft.id)
  };
};
