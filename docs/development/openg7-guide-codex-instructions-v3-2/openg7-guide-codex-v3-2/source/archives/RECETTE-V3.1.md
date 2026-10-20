# Recette V3.1 — Guide administratif et menu « Autres actions »

**Statut :** scénarios à exécuter **après modifications**, avec données synthétiques et backend intercepté lorsque pertinent. Ce document ne revendique aucun résultat nouveau. Le README source rapporte une recette antérieure de **240 scénarios navigateur, 17 Xbox simulés, 75 Node ciblés**, qui ne vaut pas validation de cette V3.1.

## Couverture et critères

| ID     | État/scénario                                                              | Attendu                                                                                                                                           | Risque couvert                       |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| R31-01 | Contrôle avec CTA principal, ouverture d'« Autres actions »                | Le CTA n'apparaît qu'une seule fois hors menu ; une seule entrée d'approbation versionnée dans le bon                                             | Double commande                      |
| R31-02 | Contrôle sans action principale admissible                                 | Pas de faux CTA ; état explicite et consultations permises                                                                                        | Action trompeuse                     |
| R31-03 | Trois contrôles différents successivement sélectionnés                     | Descripteurs secondaires, versions et textes suivent **le contrôle réellement sélectionné**                                                       | Commande obsolète                    |
| R31-04 | Changement de bon après ouverture du menu                                  | Anciennes actions fermées ou recalculées, aucun dispatch vers ancien `sponsorshipId` / version                                                    | Mauvaise cible, P0 si démontré       |
| R31-05 | Changement de mode/session retirée                                         | Aucun formulaire, contenu privé ou commande active du précédent contexte encore exécutable                                                        | Confidentialité / sécurité           |
| R31-06 | `reader` sur contrôle comportant lecture + mutation réservée               | Lire ce qui est autorisé, pas de mutation présentée comme exécutable, motif d'indisponibilité juste                                               | Permission                           |
| R31-07 | Assistance sans source enregistrée                                         | « Voir la source » et « Relancer » indiquent conditions indisponibles si l'organisme les expose ; aucun contenu inventé                           | Prérequis                            |
| R31-08 | Assistance avec source et proposition valides                              | Accès aux actions existantes, droits et versions conservés ; la relance ne démarre **que sur activation explicite**                               | Job involontaire                     |
| R31-09 | Historique absent puis historique présent                                  | Aucun faux événement ; consultation réelle conservée, état vide ou accès adapté                                                                   | Faux historique                      |
| R31-10 | Clic sur « Pourquoi ? », menu, vue locale puis carrousel                   | Aucun POST de décision, `advance` ou relance induit par la consultation seule                                                                     | Mutations implicites, P0 si démontré |
| R31-11 | CTA « Compléter l'accord »                                                 | Navigation vers le formulaire propriétaire avec bon ID/version ; aucun nouvel éditeur dans le Guide                                               | Double propriété                     |
| R31-12 | Contrôle devient vérifié après relecture                                   | Texte/CTA reflètent l'état et le descripteur, pas « à compléter » fictif                                                                          | Annonce erronée                      |
| R31-13 | Préparation approuvable                                                    | Approbation **unique** avec `canApprove`, demande de confirmation, version, `requestId`, réponse, audit                                           | Double approbation                   |
| R31-14 | Conflit de version / issue incertaine                                      | Relecture/réconciliation avant nouveau geste ; aucune répétition automatique                                                                      | Rejeu, P0 si démontré                |
| R31-15 | A sur contrôle non sélectionné                                             | Sélection, pas activation du CTA                                                                                                                  | Mapping Xbox                         |
| R31-16 | A sur contrôle sélectionné en `peek`                                       | Ouvre `open` / actions secondaires, pas le CTA                                                                                                    | Mapping Xbox                         |
| R31-17 | A sur bouton principal focalisé                                            | Active seulement ce bouton par l'interface native                                                                                                 | Mapping Xbox                         |
| R31-18 | B/Échap/Retour du menu, et X/Y                                             | Ferme `open`, focus au déclencheur, shortcuts X/Y seulement selon contexte/profil                                                                 | Focus / profil                       |
| R31-19 | Maintien d'A au passage à une confirmation                                 | Retour au neutre requis, aucune double confirmation                                                                                               | Double action                        |
| R31-20 | Bon B consulté, prochain dossier lot C, paiement suivi A                   | Trois cibles explicitement distinctes ; aucune synchronisation implicite                                                                          | Cible trompeuse                      |
| R31-21 | Bon consulté 3/6, dossiers contrôlés 4/6, contrôles 4/7                    | Les libellés annoncent des périmètres distincts ; pas d'addition des compteurs du bilan                                                           | Comptage                             |
| R31-22 | Passage pause → reprise vs revérification vs nouveau passage               | Même manifeste pour « Revérifier » ; nouveaux paiements seulement dans un nouveau passage                                                         | Contrat lot                          |
| R31-23 | Consultation d'un rapport puis « Examiner le dossier »                     | Prévenir que cela met le lot en pause et ouvre la préparation ciblée ; effets actuels conservés                                                   | Effet méconnu                        |
| R31-24 | Réduire pendant un POST `advance` en vol                                   | Le retour relit le serveur, résultat incertain réconcilié, pas de nouveau POST aveugle                                                            | Reprise                              |
| R31-25 | Vue Bon / Passage / Autre si implémentée                                   | Changement purement visuel sans perte de brouillon, requestId ou de machine d'état                                                                | Montages destructifs                 |
| R31-26 | Contrôle dans Campagnes ou dossier Publication                             | Aucun changement de rôle/action/approbation du reçu partagé hors Guide                                                                            | Régression transverse                |
| R31-27 | FR-CA / EN + thème clair, nuit, graphite                                   | Textes exacts, contraste, focus visibles, aucune clé i18n brute ou statut représenté par couleur seule                                            | Accessibilité                        |
| R31-28 | 320/390 × 667/844, 1280 × 720, 1536 × 864, 1920 × 1080 à 125 %, zoom 200 % | CTA, menu, navigation et approbation accessibles ; aucun panneau/dock ne les masque ; la page sous le Guide reste utilisable lorsqu'il est réduit | Responsive                           |
| R31-29 | Clavier seul / lecteur d'écran                                             | Ordre DOM cohérent, ouvert/fermé annoncés, `aria-expanded`/état corrects, pas de focus perdu                                                      | Accessibilité                        |
| R31-30 | Thème premium avec intervention ordinaire manquante                        | Plus de boîtes jaunes imbriquées, un seul motif mis en avant, CTA proportionné et texte lisible                                                   | Densité visuelle                     |

### Conditions de blocage

Un test prouvant qu'une mauvaise cible est modifiée, qu'une décision métier est émise en lisant un contrôle, qu'une opération incertaine est rejouée ou que l'approbation est dupliquée constitue un **P0 bloquant de la livraison**. Ce classement ne suppose pas qu'un défaut existe actuellement.

### Tests existants à mobiliser

- `tests/playwright/admin-guidance.spec.ts`
- `tests/playwright/admin-workflow-guide.spec.ts`
- `tests/playwright/admin-automatic-portfolio.spec.ts`
- `tests/playwright/admin-preparation-receipts.spec.ts`
- `tests/playwright/admin-preparation-assistance.spec.ts`
- `tests/playwright/admin-sponsorship-preparation.spec.ts`
- `tests/playwright/admin-campaigns.spec.ts`
- `tests/playwright/admin-controller-journeys.spec.ts`

Ajouter des scénarios ciblés pour `Autres actions` et la composition graphique si les tests existants ne les couvrent pas. Exécuter tests unitaires ciblés, typecheck, lint et build pertinents après les modifications. Ne pas modifier des snapshots sans vérifier le comportement.

## Rapport de recette exigé

Pour chaque lot, Codex doit rendre :

- liste précise des fichiers modifiés ;
- commandes de tests réellement exécutées et résultats (OK, échec, ignoré) ;
- couverture des IDs R31-xx avec « testé » ou « non testé » ;
- captures avant/après du contrôle et du menu sur bureau/mobile ;
- zones ouvertes qui restent à tester sur une manette Xbox physique ou avec les fournisseurs réels ;
- éléments dont le propriétaire métier a été préservé et toute limite connue.
