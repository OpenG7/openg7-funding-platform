import type {
  ModerationSubject,
  PublicModerationDecision
} from './moderation.js';
import type { SponsorshipDraftValues } from './sponsorship-followup.js';

export interface SponsorshipModerationItem {
  readonly decision: PublicModerationDecision;
  readonly canCorrect: boolean;
  readonly canRequestReconsideration: boolean;
}
export interface ModerationAssignmentRequest {
  readonly subject: ModerationSubject;
  readonly assignedTo: string | null;
  readonly expectedAssignedTo: string | null;
  readonly confirmation: string;
}
export interface SponsorshipModerationResponse {
  readonly items: readonly SponsorshipModerationItem[];
  readonly reconsiderations: readonly {
    id: string;
    decisionId: string;
    state: 'open' | 'resolved';
    createdAt: string;
  }[];
}
export interface SponsorshipReconsiderationRequest {
  readonly token: string;
  readonly decisionId: string;
  readonly requestId: string;
  readonly explanation: string;
  readonly locale?: 'fr-CA' | 'en';
}
export interface SponsorshipCorrectionRequest {
  readonly token: string;
  readonly decisionId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly data: SponsorshipDraftValues;
  readonly locale?: 'fr-CA' | 'en';
}
export interface SponsorshipCharterAcceptance {
  readonly accepted: true;
  readonly policyVersion: string;
  readonly fingerprint: string;
  readonly locale: 'fr-CA' | 'en';
}
export interface PublicSponsorshipCharter {
  readonly active: boolean;
  readonly policyVersion: string;
  readonly fingerprint: string | null;
  readonly text: { readonly fr: string; readonly en: string } | null;
}
/** Proposed V1 text. The API may expose it as active only after validated activation. */
export const SPONSORSHIP_CHARTER_TEXT = {
  fr: `Charte d’intégrité éditoriale et des commandites — OpenG7 et OpenG20
Une commandite ne constitue ni une approbation des positions du commanditaire par OpenG7 ni un droit automatique à la publication.
Cette charte s’applique aux textes, noms commerciaux affichés, logos, images, slogans, liens et publications proposés dans le cadre des commandites et de leur reconnaissance publique.
Nous n’autorisons pas la promotion de la haine, de la déshumanisation, de la discrimination, du harcèlement ou de l’exploitation, les menaces, les appels à la violence ou sa glorification destinée à l’encourager, les contenus sexuels inappropriés, la divulgation abusive de renseignements personnels, la fraude, les affirmations trompeuses ou non justifiées, l’atteinte aux droits d’autrui, les activités illégales, les liens dangereux ou la publicité électorale ou partisane commanditée exclue du programme.
Une opinion controversée ou une critique politique, philosophique ou religieuse ne constitue pas à elle seule un motif de refus. Les citations et les contenus éducatifs, journalistiques, historiques, artistiques ou satiriques sont examinés dans leur contexte. Une dénonciation de la haine n’est pas assimilée à sa promotion.
Chaque dossier fait l’objet d’une revue éditoriale humaine. OpenG7 peut demander une correction, suspendre l’examen, refuser un élément ou le dossier, ou retirer un contenu déjà publié. La mesure retenue doit être proportionnée au contenu et au risque; une correction est privilégiée lorsqu’elle suffit. Une décision défavorable est accompagnée d’une explication compréhensible, sous réserve de la protection des personnes et de la confidentialité.
Un commanditaire peut soumettre une correction ou demander un réexamen humain. Les décisions graves contestées sont réexaminées par une personne distincte de l’auteur initial. Le réexamen ne rétablit pas automatiquement une autorisation de publication.
Paiement, acceptation du dossier, approbation des médias, visibilité et publication sociale restent distincts. Les conséquences financières d’un refus sont examinées séparément selon les conditions applicables; un refus ne confirme ni un remboursement ni son exclusion.
Les éléments nécessaires à la justification et à la vérification des décisions sont conservés selon les règles de confidentialité applicables. Les notes administratives internes ne sont pas automatiquement communiquées au commanditaire.`,
  en: `Editorial Integrity and Sponsorship Charter — OpenG7 and OpenG20
Sponsorship does not imply OpenG7’s endorsement of a sponsor’s views or guarantee automatic publication.
This charter applies to submitted texts, displayed business names, logos, images, slogans, links and publications associated with sponsorships and their public recognition.
We do not allow the promotion of hatred, dehumanization, discrimination, harassment or exploitation, threats, incitement to violence or its glorification intended to encourage it, inappropriate sexual content, abusive disclosure of personal information, fraud, misleading or unsubstantiated claims, infringement of others’ rights, unlawful activities, dangerous links or sponsored electoral or partisan advertising excluded from the programme.
Controversial opinions and political, philosophical or religious criticism are not by themselves grounds for rejection. Quotations and educational, journalistic, historical, artistic or satirical content are reviewed in context. Condemning hatred is not treated as endorsing it.
Every sponsorship undergoes human editorial review. OpenG7 may request corrections, pause a review, reject an item or sponsorship, or remove published content. Measures must be proportionate to the content and risk; correction is preferred when sufficient. Adverse decisions include a meaningful explanation, subject to necessary safety and confidentiality safeguards.
Sponsors may submit corrections or request human reconsideration. Serious contested decisions are reviewed by someone other than the original decision-maker. Reconsideration does not automatically reinstate publication approval.
Payment, sponsorship eligibility, media approval, public visibility and social publication authorization remain separate. Financial consequences are assessed separately under applicable terms; rejection does not establish whether a refund is approved or unavailable.
Information needed to explain and verify decisions is retained under applicable privacy rules. Internal administrative notes are not automatically disclosed to sponsors.`
} as const;
