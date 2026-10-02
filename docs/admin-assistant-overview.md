# Assistant — synthèse et parcours de traitement

La route `/admin/fundraiser/assistant` présente les interventions de la même file
que **À traiter**. Elle utilise `GET /api/admin/attention` et sa couverture complète,
avec 15 résultats par page. Le résumé historique limité à 100 éléments ne sert
plus de source à la liste. Une source manquante reste une indisponibilité, jamais
un compteur nul interprété comme une absence de travail.

## Parcours

- La vue sans filtre propose au maximum trois interventions : la première de
  chaque catégorie actionnable, selon le classement existant (priorité, échéance,
  identifiant stable). Les seuils métier restent inchangés. Le motif, l'ancienneté
  depuis le paiement ou la soumission, ou l'échéance accompagne la priorité.
- Les catégories affichent les compteurs globaux, avant pagination. Le filtre de
  priorité se combine avec la catégorie. Les catégories vides ne sont pas affichées,
  sauf la catégorie actuellement sélectionnée.
- Les courriels peuvent être regroupés par modèle et catégorie d'erreur. Le
  compteur d'un groupe porte sur toute la file de courriels correspondant à la
  priorité sélectionnée, avant le filtre de groupe et avant pagination. Une
  catégorie d'erreur commune ne constitue pas un diagnostic de cause commune.
- **Examiner** ouvre le panneau existant, modal et plein écran sur mobile. Il
  recharge l'élément exact. Échap ou **Revenir à la liste** ferme le panneau et
  rend le focus à la ligne lorsque celle-ci est présente. Une alerte disparue
  affiche un état explicite; une erreur de lecture ne signifie pas résolution.
- Catégorie, priorité, groupe, page et sélection figurent dans l'URL (`type`,
  `priority`, `emailTemplate`, `emailError`, `page`, `selected`). Les liens vers
  le dossier exact transportent un `returnTo` interne. Le retour à l'Assistant
  restaure la sélection et les filtres. Les brouillons privés restent en mémoire,
  sans persistance navigateur; ils doivent être préparés de nouveau après sortie.
- La préparation indique que le brouillon n'est ni envoyé, ni publié, ni
  enregistré. Les lecteurs n'ont pas de bouton de préparation. Les actions réelles
  restent dans les parcours métier avec leurs validations et confirmations.
- **Poser une question** et **Résumé financier prudent** sont repliés et chargés
  à l'ouverture. Le premier vérifie le mode conversationnel, indique sa désactivation
  ou sa simulation, et n'envoie pas de question automatiquement. Le second affiche
  les limites financières et la date de son propre relevé.

La détection, la préparation et le contexte utilisent la même
[couverture des canaux de publication](../apps/funding-api/src/sponsorship-publication-coverage.ts).
Les canaux promis proviennent de la politique d'avantages partagée. Un brouillon
du dossier couvre son canal tant qu'il n'est ni refusé ni annulé, y compris après
publication. Cette couverture sert à repérer les canaux encore à préparer;
l'autorisation d'envoi et les preuves de publication restent vérifiées dans leurs
parcours respectifs.

Le compteur des commandites approuvées, la détection des publications à préparer
et la préparation privée utilisent la même
[règle de revue exploitable](../apps/funding-api/src/sponsorship-review-policy.ts) :
paiement `paid`, remboursement `not_requested` et revue `approved`. Le compteur
reste global, même si les éléments affichés sont limités. Consentement, médias et
autorisation d'envoi restent vérifiés dans les parcours de publication.

La file et le contexte utilisent les mêmes règles pour suivre les brouillons
inachevés. Les brouillons publiés couvrent leur canal sans rester à suivre.

Les outils de lecture et les brouillons préparatoires utilisent la même
[recherche de commandite par référence](../apps/funding-api/src/admin-assistant/sponsorship-reference.ts) :
référence publique sans distinction de casse, identifiant complet ou préfixe
d'identifiant, éventuellement précédé de `#`. La recherche conserve le premier
dossier correspondant dans le jeu chargé. Le chargement du contexte et les actions
confirmées conservent leur recherche exacte par identifiant ou référence publique.

Sans référence explicite, le contexte et la progression partagent la
[sélection du premier dossier de la file](../apps/funding-api/src/admin-work-queue.service.ts).
Une file vide retourne `empty`; une source manquante retourne `unavailable`.
Une référence explicite est recherchée directement, sans charger la file.

Le [résumé média partagé](../apps/funding-api/src/sponsorship-media-policy.ts)
alimente le contexte et la progression du dossier. Une photo de présentation
approuvée satisfait le prérequis média de publication; l'étape de revue des médias
reste en attente tant qu'un média, y compris le logo, attend une décision. Un logo
approuvé seul ne remplace pas la photo de présentation.

La progression utilise les mêmes prérequis communs aux reconnaissances
Web et sociales : consentement, revue, photo approuvée, paiement et remboursement.
Le nom de l'entreprise reste requis pour le Web; le masquage du feed bloque les
publications sociales. Ces motifs de lecture n'autorisent aucune publication.

L'[éligibilité des demandes d'informations](../apps/funding-api/src/sponsorship-review-policy.ts)
est commune au contexte, à l'aperçu privé et à l'action d'envoi confirmé : paiement
confirmé, aucun remboursement demandé, dossier non refusé et incomplet,
destinataire utilisable. Les anciennetés de l'Assistant, des rappels de revue et du
journal d'interventions reposent sur le même [calcul des jours écoulés](../apps/funding-api/src/elapsed-days.ts).
Les seuils de chaque parcours et les prolongations explicites restent distincts.

La route contextuelle `?sponsorshipId=<uuid>` conserve son fonctionnement décrit
dans le [guide de l'Assistant contextuel](admin-ux-lot-3.md).

## Extension compatible du contrat de file

Les anciens paramètres et réponses restent valides. Les ajouts sont facultatifs :

| Paramètre       | Valeur                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| `overview`      | `true` ou `false`; absent par défaut                                        |
| `emailTemplate` | Identifiant de modèle de 1 à 100 caractères alphanumériques, `_` ou `-`     |
| `emailError`    | `inconnue`, `authentification`, `destinataire_rejeté`, `connexion`, `autre` |

Avec `overview=true`, la réponse ajoute `overview.recommendations` (éléments
d'attention existants) et `overview.emailGroups` (`template`, `error`, `count`).
Les filtres de courriel excluent les autres types d'intervention. Les groupes ne
contiennent ni destinataire complet ni erreur brute. Les contrôles API, limites de
pagination et réponses privées `no-store` restent ceux de la file.

## Vérifications

Les tests Node de `admin-work-queue.test.mjs` couvrent les regroupements au-delà
de 100 courriels, les filtres et leur validation, les recommandations par catégorie
et l'absence de données privées supplémentaires. La recette UI
`admin-assistant-overview.spec.ts` couvre pagination, retour depuis un courriel,
focus, préparation seule, erreurs, session expirée, source indisponible, alerte
résolue, chargement des volets à la demande, FR/EN et accessibilité mobile.
Elle utilise des données synthétiques, sans API réelle, envoi ni publication.
