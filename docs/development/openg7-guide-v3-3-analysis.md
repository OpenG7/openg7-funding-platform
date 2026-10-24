# Analyse locale du dossier V3.3

Analyse du 23 octobre 2026, sur `codex/admin-guide-fiches-first`, à partir du
[message fourni](openg7-guide-codex-v3-3/OpenG7_Message_Pour_Codex.md) et du
[dossier illustré autonome](openg7-guide-codex-v3-3/OpenG7_Dossier_Codex_Illustre.html).
Ce document distingue le diagnostic initial, la tranche d’adaptation retenue et
les validations réellement exécutées. Il ne remplace pas les contrats propriétaires.

## Avis et autonomie

Le dossier est exploitable pour adapter les capacités existantes sans nouvelle
décision de conception indispensable. Il précise les objets, les invariants,
les propriétaires et les conditions d’arrêt. L’utilisateur a autorisé l’analyse,
les adaptations locales et les tests, sans déploiement ni action réelle.

La V3.3 porte principalement sur **Prestations de services**, le détail d’une
prestation, l’édition et le suivi des décisions. La section « Écarts », §6, exclut
explicitement une réécriture du Guide. Celui-ci conserve son rôle d’orientation.
Le nouveau vocabulaire ne transforme pas le soutien personnel en achat de services.

Le dossier contient deux fichiers physiques. Les 16 sections, les neuf PNG et les
informations du registre sont consolidés dans le HTML. Les noms `01_BLUEPRINT.md`,
`images/`, `donnees/` ou `valider_dossier.py` désignent l’archive source ; leur absence
comme fichiers séparés ne bloque pas la lecture. Les images originales sont des
références, sans édition ni nouvelle génération.

Le registre comporte 211 entrées : 80 issues des images, 56 reprises du blueprint
source et 75 propositions à qualifier. Les 56 recettes sont des critères de
vérification, pas des résultats de tests. L’ensemble ne constitue donc ni 211
fonctions à construire ni une attestation de disponibilité.

## Diagnostic avant adaptation

Au départ, 19 fichiers suivis étaient déjà modifiés : vues **Fiches / Suivi du lot /
Autre préparation**, conservation de contexte, mise en page et tests du Guide.
Ils constituent la base à préserver. Les références historiques Bon/Passage/Autre
du pack ne justifient pas de réintroduire ces anciens libellés.

Les fichiers de composants ci-dessous sont sous
`apps/funding-web/src/app/features/funding/` ; les tests cités sont sous `tests/`.
Les identifiants Sxx et commandes restent ceux du dossier de conception, jamais des
identifiants métier à transmettre à l’API.

| Décision                              | Écrans et commandes                                                                | Propriétaire vérifié / effet utilisateur                                                                                                                                                              | Vérification pertinente                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Adapter                               | S00/S36, `LIST-*`, `FILTRE-*`                                                      | `pages/admin-campaigns-page/`, `AdminCampaignsStore` : conserver route, filtres, tri et pagination ; afficher « Prestations de services ». Chaque ligne reste une obligation, pas un dossier complet. | `playwright/admin-campaigns.spec.ts`, entrée exacte avant pagination, FR/EN, clavier et responsive.         |
| Conserver                             | S01/S27, `SYN-PROCHAINE`, `CTRL-AGIR`, `CTRL-POURQUOI`                             | `AdminSponsorshipNextStep`, `preparation-pilot.projection.ts` : prochaine intervention issue des faits serveur, sans score local ajouté.                                                              | `admin-sponsorship-workspace.test.mjs`, `preparation-pilot.test.mjs`.                                       |
| Conserver et corriger le résumé       | S28, `PREP-CONFIRMER`, `PREP-HISTO`                                                | `AdminPreparationReceipt` : approbation unique, version exacte et portée préparation. L’absence d’accord ou de destination ne prouve pas que la préparation est non requise.                          | `playwright/admin-sponsorship-preparation.spec.ts`, `playwright/admin-preparation-receipts.spec.ts`.        |
| Conserver                             | S26, `ACC-RELIRE`, `ACC-QUALIFIER`, `ACC-AJUSTER`                                  | `admin-sponsorship-commitments-controller.ts` : accord figé, qualification historique avec source, raison et version ; ajustements explicites.                                                        | `admin-sponsorship-commitments-controller.test.mjs`, `sponsorship-commitments.test.mjs`.                    |
| Manquant                              | S03/S04, `AUT-CONFIRMER`, `AUT-ACQUITTER`                                          | Aucun enregistrement trouvé d’un accord client reçu pour une version sociale précise. Les consentements du parcours client et l’autorisation administrative d’envoi ne le remplacent pas.             | Ne pas rendre de bouton d’accord reçu exécutable ; travail métier séparé nécessaire.                        |
| Manquant pour une boîte entrante      | S14/S15, `AUT-PREUVE`, `PREUVE-FICHIER`                                            | La file de courriels et `AdminInspectionService.email()` exposent des métadonnées sortantes, pas une boîte de réception avec corps et pièces d’accord.                                                | Ne pas détourner les preuves de réalisation ou le stockage médias.                                          |
| Adapter dans sa portée réelle         | S12/S13/S39, `CORREQ-*`, `DEMANDE-ENVOI`                                           | La demande d’information existante possède destinataire source, version, confirmation, identifiant de requête et reçu. Elle ne collecte pas un accord versionné sur un texte social.                  | `admin-sponsorship-records-http.test.mjs`, recettes de demande d’information et reprise courriel.           |
| Manquant pour la rédaction générative | S07, `IA-ANALYSER`, `IA-UTILISER`                                                  | L’assistance actuelle extrait localement les clauses d’un accord historique et prépare des propositions déterministes. Aucun service réel de réécriture libre Facebook trouvé.                        | Conserver la revue assistée existante sous son vrai nom ; aucune intégration IA créée pour la maquette.     |
| Adapter                               | S02/S06/S18, `EDIT-*`, `PUB-CORRIGER`                                              | `PublicationDeliveryController` : éditeur unique message, horaire, média, format et photos, avec sauvegarde versionnée. Pas de payload autonome pour cinq onglets complets de mise en forme.          | `admin-publication-delivery-controller.test.mjs`, `playwright/admin-publication-automation.spec.ts`.        |
| Corriger un écart existant            | S30, `SORTIE-*`, R37/R56                                                           | Le tiroir fermait directement par `close()` → `clear()` ; `dirty()` ne couvrait pas la nouvelle composition. Protéger la fermeture utilisateur sans empêcher la purge de sécurité.                    | Confirmation annulée/acceptée, composition, requête en cours, changement de contexte et sauvegarde échouée. |
| Conserver                             | S05/S19/S38, `PUB-PUBLIER`, `ENVOI-CONFIRMER`, `PUB-RETIRER`                       | Tiroir de livraison et commandes `approve/reject/cancel` : version exacte, modération et confirmation. Autoriser/programmer ne devient pas une commande universelle « Publier maintenant ».           | Tests du contrôleur et `publication-automation-commands.test.mjs`.                                          |
| Conserver                             | S20/S21/S22, résultat, réconciliation, absence attestée                            | Le moteur conserve mode, état, références et audit fournisseur. Un résultat incertain se réconcilie ; fermeture ou sauvegarde ne relance aucun envoi.                                                 | Tests de reprise incertaine et du worker ; aucune opération fournisseur réelle pendant cette adaptation.    |
| Conserver séparément                  | S24/S25, `WEB-SAUV`, `WEB-PUBLIER`, `WEB-MASQUER`                                  | Fiche Web et commande de visibilité distinctes de l’envoi social ; enregistrer n’affiche pas la fiche.                                                                                                | `sponsorship-website.test.mjs`, `playwright/admin-sponsorship-publication.spec.ts`.                         |
| Conserver avec portée explicite       | S23, `LIV-PREUVE`, `LIV-OBSERVER`, `LIV-ATTESTER`                                  | Preuve qualifiée et suivi temporel existants. `complete` peut inclure `adjusted` : ne pas compter une dispense, une simulation ou une durée en cours comme service réalisé.                           | `playwright/admin-campaigns.spec.ts`, tests de temporalité des obligations.                                 |
| Partiel / manquant                    | S08/S09/S10/S37, `HIST-*`, `COMP-*`, `RESTORE-*`                                   | Historiques spécialisés et interventions privées présents ; pas de catalogue complet des anciens textes sociaux pour comparaison, restauration ou export universels.                                  | Identifier les sources et leur pagination ; aucune chronologie fictivement exhaustive.                      |
| Conserver                             | S33/S34/S35, médias, propriétaires et retour Guide                                 | `MediaReviewWorkspace`, `PreparationReturnService`, alias `tab=media/refund` : droits et portées existants, repères en mémoire et identifiants sûrs.                                                  | Tests médias, `preparation-return.test.mjs` et navigation Guide ; aucun contenu privé dans les URLs.        |
| Retirer de la transposition           | Faux compteurs, réactions sociales, accord présumé valide, commandes sans capacité | Les images illustrent des données fictives. Elles ne prouvent ni les décisions ni les résultats ; aucune statistique de démonstration dans l’interface réelle.                                        | Inspection du rendu et assertions sur les données synthétiques identifiables.                               |

## Tranche locale retenue

1. **Lots 1–2 ciblés :** adapter le vocabulaire et la composition de la page
   Prestations existante, l’intervention contextuelle et son aperçu textuel réel.
   Conserver les canaux Website/Facebook/LinkedIn, les cibles OpenG7/OpenG20, la
   navigation et les états ; ne pas annoncer un bilan complet de dossier sur une page
   partielle de prestations. Décliner le bleu dans le thème local.
2. **Lot 3 ciblé :** protéger la sortie utilisateur du tiroir d’édition par la
   confirmation existante, pour l’édition comme la composition. Maintenir les
   invalidations existantes de session et les verrous pendant une opération. Ne pas
   fermer sur une sauvegarde échouée ni fusionner sauvegarde et autorisation.
3. **Correction sémantique :** ne montrer « Non requis » sans destination que
   lorsque le contrôle serveur `content_prepared` l’établit explicitement ; sinon
   indiquer que les prestations restent à déterminer. Mettre à jour les accès à
   l’espace renommé, en préservant les vues et états du Guide.
4. **Lot 6 ciblé :** build Angular/SSR, vérifications TypeScript, tests unitaires
   concernés et recettes navigateur synthétiques, format, lint et contrôles
   documentaires. Les résultats sont consignés après exécution.

Correspondance des adaptations avec le registre fourni :

| Commande de conception                              | Raccord local                                                               | Effet vérifié                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `LIST-OUVRIR`                                       | `AdminCampaignsPageComponent.select`, hook `campaign-row`                   | Sélectionner l’obligation exacte et rejoindre le titre du détail.                                                               |
| `G-RETOUR`                                          | `returnToList`, hook `campaign-return-list`                                 | Retrouver la ligne sélectionnée sans réinitialiser filtres ni relancer une lecture Campagnes.                                   |
| `SYN-PROCHAINE`, `PUB-SUIVRE`                       | Hooks `campaign-next-step`, `campaign-open-delivery`, `campaign-open-owner` | Afficher la responsabilité actuelle et rejoindre la livraison ou le dossier existant ; aucune décision au clic de consultation. |
| `G-FERMER`, `SORTIE-CONTINUER`, `SORTIE-ABANDONNER` | `PublicationDeliveryController.requestClose`                                | Confirmation commune X/Échap/B ; annuler garde la saisie, confirmer abandonne seulement le brouillon local.                     |
| `EDIT-SAUV`                                         | `PublicationDeliveryController.save`, inchangé                              | Sauvegarde explicite versionnée ; un échec conserve les champs et n’autorise aucun envoi.                                       |

`SORTIE-SAUV` n’ajoute pas une sauvegarde automatique dans la confirmation :
rester dans le tiroir permet d’utiliser son action d’enregistrement existante.
Les onglets d’édition sans payload, `EDIT-SAUV-VALIDER`, l’accord client simulé
et l’assistance générative sans fournisseur ne sont pas transposés en commandes.

L’approbation disponible de la fiche courante garde l’accent principal. Les liens
vers le dossier et la livraison restent accessibles comme actions secondaires
pendant cette décision ; ils peuvent reprendre l’accent ensuite. La condition
utilise la capacité de la fiche réellement chargée, y compris si l’ancien état
d’approbation de la liste est devenu périmé.

Les adaptations concernent les trois fichiers du composant Campagnes, le
contrôleur et le template du tiroir de livraison, les deux fichiers de la fiche de
préparation, puis les catalogues FR/EN `admin-campaigns`, `admin-base`,
`admin-automatic`, `admin-sponsors-publication-cleanup` et `admin-workflow-guide`.
Les traductions des liens consommateurs suivent le nom de l’espace sans renommer
les routes ou les identifiants. Les références fonctionnelles ci-dessous sont
actualisées dans le même changement.

## Limites et suite

L’accord client versionné avec preuve entrante, la rédaction générative, les
versions historiques sociales complètes et les outils d’édition sans contrat réel
restent des capacités à concevoir séparément. Leur absence ne bloque pas cette
tranche. Aucun nouvel endpoint, table, dépendance, fournisseur ou moteur de priorité
n’est nécessaire pour les adaptations retenues.

La garde d’abandon couvre la fermeture du tiroir par X, Échap ou B, pas tous les
liens de navigation vers d’autres routes. S30 reste donc partiellement traité.
Les mécanismes de fermeture forcée restent ceux des propriétaires ; cette tranche
ne revendique pas une nouvelle purge globale des saisies privées en mémoire.

Les vérifications navigateur utilisent des API synthétiques interceptées. Un
viewport CSS de 1536 × 864 représente seulement l’équivalence nominale d’un écran
1920 × 1080 à 125 % ; ce n’est pas une qualification du réglage Windows réel. Les
recettes Gamepad simulées ne qualifient pas une manette physique.

La synthèse multi-prestations S01, la mise en scène complète des étapes S02–S06
et la présentation unifiée des historiques ne sont pas livrées intégralement par
cette première tranche. Sur mobile, la fiche complète conserve son défilement
vertical. La recette exhaustive R01–R56 reste à répartir entre les fonctions
existantes, les améliorations visuelles suivantes et les capacités manquantes.

La référence fonctionnelle demeure [Prestations](../technical/admin-campaigns.md),
le [pilotage administratif](../operations/admin-pilotage.md) et le
[tiroir de publication](../operations/publication-automation.md).

## Résultats de validation

Exécuté localement le 23 octobre 2026, avec Node 22 :

- Build Angular de production réussi, SSR et 25 routes pré-rendues ; dernière
  compilation à `2026-10-24T02:38:05Z` (soir du 23 octobre à Toronto).
- Compilation TypeScript du projet et vérification TypeScript des recettes UI
  réussies.
- **141 tests unitaires réussis**, aucun échec : contrôleur de livraison,
  projection du pilotage, retour de préparation, contrôleur Campagnes et moteur
  du lot. Les nouveaux tests couvrent confirmation tardive, contexte modifié,
  répétition, commande active et échec de sauvegarde conservant la saisie.
- Suite navigateur de six fichiers : **309 réussites et 2 captures comparatives
  historiques volontairement ignorées**, aucun échec, en six minutes. Elle couvre
  Campagnes, publication automatique, préparation du dossier, fiches du Guide,
  Guide administratif et aide des parcours. Les nouveaux scénarios X/Échap/B
  vérifient édition, composition, absence de mutation et restitution du focus.
- Revalidation finale de Campagnes après la hiérarchie des actions : **30 tests
  réussis sur 30**, en 53 secondes. Cela inclut quatre nouveaux scénarios FR/EN
  vérifiant la priorité de l’approbation et le passage de l’accent à l’action
  suivante ; ces quatre scénarios s’ajoutent aux 309 précédents.
- Format des fichiers modifiés, lint global et ciblé, contrôles documentaires et
  `git diff --check` exécutés. Le lint global conserve un avertissement préexistant
  dans `scripts/smoke-public.mjs:165`, sans erreur.

Captures réelles du détail, avec données synthétiques identifiées :
`test-results/v33-analysis/rendered/service-detail-{fr-CA,en}-{1536,390}.png`.
Les deux tailles et les deux langues ont été inspectées dans les recettes ; les
captures FR desktop et mobile ont également été relues visuellement. Elles montrent
le composant entier, pas une certification de mise à l’échelle Windows.

Le contenu du pack est conservé ; son format est normalisé pour le dépôt. Les
empreintes SHA-256 des neuf PNG intégrés sont identiques avant et après formatage.
Aucune API réelle, base, seed, livraison sociale, publication Web, opération
financière ou envoi de courriel n’a été exécuté pendant cette adaptation.
