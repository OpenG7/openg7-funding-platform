import type {
  ModerationReason,
  ModerationReasonCode
} from './moderation-contracts.js';

const reason = (
  code: ModerationReasonCode,
  fr: string,
  en: string,
  definitionFr: string,
  definitionEn: string
): ModerationReason => ({
  code,
  label: { fr, en },
  definition: { fr: definitionFr, en: definitionEn },
  allowedLevels: [
    'DISCRIMINATION',
    'TARGETED_HARASSMENT',
    'SEXUAL_CONTENT',
    'MISLEADING_CLAIM',
    'IP_RIGHTS',
    'EXTERNAL_LINK_RISK',
    'EDITORIAL_INCOMPATIBILITY'
  ].includes(code)
    ? ['N1', 'N2', 'N3', 'N4', 'N5']
    : ['N2', 'N3', 'N4', 'N5']
});
export const MODERATION_REASONS: readonly ModerationReason[] = [
  reason(
    'HATE_TARGETED',
    'Haine ciblée',
    'Targeted hate',
    'Attaque haineuse liée à une appartenance réelle ou supposée.',
    'Hateful attack related to actual or perceived group membership.'
  ),
  reason(
    'DEHUMANIZATION',
    'Déshumanisation',
    'Dehumanization',
    'Présentation de personnes comme sous-humaines ou indignes de droits fondamentaux.',
    'Portraying people as subhuman or undeserving of fundamental rights.'
  ),
  reason(
    'DISCRIMINATION',
    'Discrimination',
    'Discrimination',
    'Exclusion ou traitement discriminatoire visant des personnes ou des groupes.',
    'Discriminatory exclusion or treatment of people or groups.'
  ),
  reason(
    'TARGETED_HARASSMENT',
    'Harcèlement ciblé',
    'Targeted harassment',
    'Humiliation, intimidation ou harcèlement visant une personne identifiable.',
    'Humiliation, intimidation or harassment directed at an identifiable person.'
  ),
  reason(
    'THREAT',
    'Menace',
    'Threat',
    'Menace explicite ou crédible contre des personnes.',
    'Explicit or credible threat against people.'
  ),
  reason(
    'VIOLENCE_INCITEMENT',
    'Incitation à la violence',
    'Incitement to violence',
    'Appel, encouragement ou instruction de violence.',
    'Calling for, encouraging or instructing violence.'
  ),
  reason(
    'VIOLENCE_GLORIFICATION',
    'Glorification de la violence',
    'Glorification of violence',
    'Valorisation de violences ou de leurs auteurs dans un contexte promotionnel.',
    'Promotional glorification of violence or its perpetrators.'
  ),
  reason(
    'EXPLOITATION',
    'Exploitation',
    'Exploitation',
    'Promotion ou banalisation de formes d’exploitation humaine.',
    'Promoting or normalizing human exploitation.'
  ),
  reason(
    'SEXUAL_CONTENT',
    'Contenu sexuel inapproprié',
    'Inappropriate sexual content',
    'Contenu sexuel incompatible avec le cadre public de reconnaissance.',
    'Sexual content incompatible with the public recognition programme.'
  ),
  reason(
    'PRIVACY_VIOLATION',
    'Atteinte à la vie privée',
    'Privacy violation',
    'Exposition non autorisée de renseignements ou d’images privés.',
    'Unauthorized disclosure of private information or images.'
  ),
  reason(
    'FRAUD_IMPERSONATION',
    'Fraude ou usurpation',
    'Fraud or impersonation',
    'Fausse identité, usurpation ou représentation frauduleuse.',
    'False identity, impersonation or fraudulent representation.'
  ),
  reason(
    'MISLEADING_CLAIM',
    'Allégation trompeuse',
    'Misleading claim',
    'Allégation matériellement trompeuse ou insuffisamment étayée.',
    'Materially misleading or insufficiently supported claim.'
  ),
  reason(
    'ELECTORAL_ADVERTISING',
    'Publicité électorale ou partisane',
    'Electoral or partisan advertising',
    'Publicité électorale ou partisane commanditée exclue du programme.',
    'Sponsored electoral or partisan advertising excluded from the programme.'
  ),
  reason(
    'ILLEGAL_CONTENT',
    'Contenu illicite',
    'Illegal content',
    'Contenu dont la conformité exige un examen motivé et, si nécessaire, spécialisé.',
    'Content requiring a reasoned compliance review and, where needed, specialist review.'
  ),
  reason(
    'IP_RIGHTS',
    'Droits de propriété intellectuelle',
    'Intellectual property rights',
    'Usage non autorisé ou droits non démontrés sur les éléments proposés.',
    'Unauthorized use or unsubstantiated rights in proposed material.'
  ),
  reason(
    'EXTERNAL_LINK_RISK',
    'Risque lié à un lien externe',
    'External link risk',
    'Destination dangereuse, trompeuse ou incompatible avec la reconnaissance.',
    'Unsafe, deceptive or incompatible external destination.'
  ),
  reason(
    'EDITORIAL_INCOMPATIBILITY',
    'Incompatibilité éditoriale précise',
    'Specific editorial incompatibility',
    'Incompatibilité avec une disposition expresse de la politique, identifiée dans la décision.',
    'Incompatibility with an express policy provision identified in the decision.'
  )
];
export const MODERATION_EDITORIAL_PROVISIONS = [
  {
    id: 'recognition-scope',
    label: {
      fr: 'Reconnaissance de la commandite dans le cadre du programme',
      en: 'Sponsorship recognition within the programme scope'
    }
  },
  {
    id: 'nonpartisan-recognition',
    label: {
      fr: 'Exclusion de la publicité électorale ou partisane commanditée',
      en: 'Exclusion of sponsored electoral or partisan advertising'
    }
  },
  {
    id: 'public-safety-and-rights',
    label: {
      fr: 'Respect de la sécurité, de la dignité et des droits dans les contenus publics',
      en: 'Respect for safety, dignity and rights in public content'
    }
  }
] as const;
