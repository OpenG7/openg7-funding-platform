/** Candidate for editorial review. This does not activate a public charter or change an accepted offer. */
export const SPONSORSHIP_RECOGNITION_TERMS_VERSION = 'recognition-terms-v1';
export const SPONSORSHIP_RECOGNITION_TERMS_TEXT = {
  fr: `Conditions de reconnaissance proposées — à valider
L’offre présentée et acceptée avant le paiement fixe les avantages, leurs quantités, leurs destinations et les éléments requis. Un changement ultérieur de barème ne modifie pas cet accord. Aucun délai ou durée de visibilité n’est promis lorsque l’offre n’en indique pas.
La confirmation du paiement crée les engagements enregistrés. Le consentement public, les droits sur les médias, la revue éditoriale et l’autorisation administrative de chaque publication restent des étapes distinctes.
Le commanditaire conserve la maîtrise des usages autorisés de ses photos, des crédits et de sa préférence. Une préférence ou un aperçu ne constitue pas une autorisation de publication. Un changement de contenu ou de droits exige une nouvelle vérification.
Les dates proposées dépendent des capacités du compte et ne constituent pas une preuve de diffusion. Le suivi privé distingue préparation, autorisation, simulation, résultat incertain et livraison attestée. Une lecture distante inaccessible reste inconnue.
Un refus, un retrait de consentement ou une demande de remboursement ne supprime pas automatiquement un engagement. Toute adaptation de destination, de format ou de prestation doit être explicite et tracée. Les conséquences financières sont examinées séparément.
Pour les anciens dossiers sans accord enregistré, les conditions restent à confirmer sur pièce. Le montant actuel ou une ancienne mention « publié » ne suffit pas à reconstruire une offre acceptée ou une preuve de livraison.`,
  en: `Proposed recognition terms — subject to review
The offer presented and accepted before payment records benefits, quantities, destinations and required elements. Later pricing changes do not alter that agreement. No delivery deadline or visibility duration is promised when the offer specifies none.
Payment confirmation creates recorded commitments. Public consent, media rights, editorial review and administrative authorization for each publication remain separate steps.
Sponsors control authorized photo uses, credits and preferences. A preference or preview does not authorize publication. Content or rights changes require fresh review.
Proposed dates depend on account capacity and are not delivery evidence. Private tracking distinguishes preparation, authorization, simulation, uncertain outcomes and evidenced delivery. An inaccessible remote read remains unknown.
Rejection, withdrawal of consent or a refund request does not automatically remove a commitment. Any change to destination, format or service must be explicit and recorded. Financial consequences are assessed separately.
Older dossiers without a recorded agreement need documentary qualification. Current amounts or an old “published” declaration cannot reconstruct an accepted offer or delivery evidence.`
} as const;

export interface SponsorshipCharterReviewPreview {
  readonly active: boolean;
  readonly validatedAt: string | null;
  readonly effectiveAt: string | null;
  readonly charter: {
    readonly policyVersion: string;
    readonly fingerprint: string;
    readonly text: { readonly fr: string; readonly en: string };
  };
  readonly recognitionTerms: {
    readonly status: 'proposed';
    readonly version: string;
    readonly fingerprint: string;
    readonly text: { readonly fr: string; readonly en: string };
  };
}
