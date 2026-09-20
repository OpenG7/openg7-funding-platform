# Politique d’utilisation et de remboursement

Les routes `/politique-utilisation-remboursement` et
`/en/politique-utilisation-remboursement` présentent les conditions publiques du
Fonds des Bâtisseurs. La page reste une page Angular standalone OnPush, sans
chargement financier ni mutation API. Son rôle est de présenter les conditions,
guider la demande et orienter vers les outils du support.

## Révision du 19 septembre 2026

Décision confirmée pour cette révision : **conserver la revue des demandes au cas
par cas et OpenG7 comme responsable affiché**. La révision est éditoriale et ne
crée aucun délai maximal d’admissibilité, délai de réponse garanti, remboursement
automatique ou retenue forfaitaire de frais. Aucun nom d’entité légale plus précis
n’a été fourni. Une future formalisation de ces règles devra faire l’objet d’une
décision métier et d’une validation juridique adaptées aux contributions et
commandites concernées, sans modifier rétroactivement les engagements existants.

La procédure indique la référence publique, la date et le montant si la référence
est introuvable, le motif et le montant demandé pour un remboursement partiel.
Le bouton de courriel ouvre `contact@openg7.org` avec un objet traduit, sans
transmettre de paiement ou de lien privé et sans envoyer de message. L’adresse
reste visible pour les personnes sans application de courriel configurée.

Une demande, une décision favorable, l’émission du remboursement et sa réception
bancaire sont distinctes. Le refus d’une commandite ne confirme pas un remboursement.
Les informations de délai bancaire et de destination reprennent la
[documentation Stripe](https://docs.stripe.com/refunds#trace-a-refund), consultée
le 19 septembre 2026 : délai généralement estimé à 5–10 jours ouvrables après
émission, vers le moyen de paiement d’origine. L’analyse préalable n’entre pas
dans ce délai. Un retard, échec ou débit annulé peut nécessiter un suivi.

## Présentation et accessibilité

La page propose un résumé, une procédure en trois étapes, un sommaire avec ancres
stables, sept sections et un contact. Les liens internes conservent la langue.
La navigation au clavier place le focus sur le titre ciblé ; les liens avec
touches modificatrices conservent le comportement normal du navigateur.

Le bandeau utilise les WebP 960 et 1920 px existants de la page support, sans
dupliquer les images. Ces fichiers pèsent environ 68 et 195 Ko, contre 2,27 Mo
pour le PNG. Régénération avec `yarn images:support`. L’image décorative a un
texte alternatif vide et ses dimensions sont définies.

La date de révision est fixe, identique en SSR et dans le navigateur. Lors d’une
nouvelle révision, modifier `revision` dans le composant et les deux libellés de
date traduits. L’impression conserve tous les textes, la date, l’adresse de
contact et le lien Stripe, sur fond blanc. Elle masque les actions, le sommaire,
la navigation du site et le lecteur musical. Le navigateur permet d’enregistrer
le document en PDF ; aucun PDF externe n’est généré à la volée.

## Vérification

Après construction Angular, exécuter :

```bash
yarn exec playwright test --config tests/playwright-public-journeys.config.mjs --grep "refund policy"
```

`refund-policy.spec.ts` couvre FR/EN, les ancres au clavier, les liens vers le
support et la récupération de référence, le changement de langue, le courriel
prérempli, les contrastes axe, 320 px, les polices à 200 %, l’impression et le
prérendu sans JavaScript. Les APIs sont interceptées : aucun courriel, paiement
ou remboursement réel. Les moteurs ciblés sont Chromium, Firefox, WebKit et
WebKit sur iPhone émulé. Les contrôles axe et l’agrandissement CSS ne remplacent
pas un lecteur d’écran humain, le zoom natif ou un appareil physique.

Aucun changement API, schéma, règle de paiement ou migration.
