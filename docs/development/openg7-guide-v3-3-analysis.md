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

## Suivi des chantiers locaux V3.3

**6 chantiers réalisés sur 6 ; 0 restant dans ce périmètre local.** Ce registre
compte des adaptations bornées, réalisées et testées localement. Il ne mesure ni
les lots 0–6 du pack, ni ses 211 entrées, ni les fusions ou déploiements. Les
capacités absentes recensées dans les limites restent des travaux séparés.

| Nº  | Chantier                                                  | État et critère de clôture                                                                                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Première adaptation Prestations et Guide                  | Réalisé : vocabulaire, enveloppe, détail exact, action prioritaire et protection de fermeture ; PR #370.                                                           |
| 2   | Départ du tiroir de publication                           | Réalisé : navigation interne, historique, conservation des saisies, invalidation de session et tests ; PR #371.                                                    |
| 3   | Synthèse des prestations d’un dossier — S01               | Réalisé localement : obligations exactes, état et responsabilité serveur, preuve qualifiée, dispenses distinctes, liens ciblés et tests.                           |
| 4   | Lecture, correction et revue du contenu — S02/S05/S06/S11 | Réalisé : version enregistrée, saisie locale, référence et aperçu textuels distincts, conflit sans perte, consultation lecteur et tests.                           |
| 5   | Consultation des historiques et preuves — S08/S23         | Réalisé : sources spécialisées ciblées, dates Toronto, dernière conclusion et pagination explicites, preuves et références exactes, focus et tests.                |
| 6   | Recette transversale finale                               | Réalisé localement : matrice R01–R56, petites hauteurs, espace CSS équivalent à 200 %, clavier, manette simulée et captures ; qualifications matérielles séparées. |

Les quatre familles de capacités hors de ce total sont l’accord client versionné avec preuve
entrante, la rédaction générative, le catalogue complet des versions sociales et
les outils de mise en forme sans contrat de sauvegarde existant.

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

La première tranche protégeait la fermeture du tiroir par X, Échap ou B. Le chantier
suivant décrit ci-dessous étend cette garde aux navigations Angular. Les mécanismes
de fermeture forcée restent ceux des propriétaires ; ces adaptations ne
revendiquent pas une nouvelle purge globale des saisies privées en mémoire.

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

## Chantier suivant : départ du tiroir de publication

Adaptation locale du 23 octobre 2026, poursuivie sans attendre la CI de la première
tranche. La confirmation commune protège maintenant les liens vers le dossier,
les médias et les brouillons depuis les éditeurs Automation et Commandites. Elle
couvre aussi les changements de paramètres de la même page et l’historique
arrière/avant du navigateur. Le contrôleur fournit une décision d’abandon sans
effacer les champs avant la réussite de la navigation.

Le raccord réutilise les propriétaires : `PublicationDeliveryController`, le
tiroir partagé, `AdminConfirmationService` et deux gardes de sortie sur les routes
existantes. Un registre limité aux contrôleurs montés ne copie aucune saisie.
La restauration d’historique Angular utilise `canceledNavigationResolution:
'computed'` : refuser un retour ne doit pas remplacer l’entrée précédente et
empêcher une nouvelle tentative.

L’annulation conserve les champs et le focus ; une requête active bloque le
départ. Une navigation concurrente invalide la décision précédente. L’expiration
de session ou un refus d’accès conserve la purge du propriétaire et ferme sa
confirmation devenue obsolète. Aucun enregistrement, approbation ou envoi n’est
ajouté. Le rechargement, la fermeture de l’onglet et les sorties hors du routeur
Angular restent hors périmètre ; aucune persistance de brouillon n’est créée.

Vérifications locales de ce chantier, avec Node 22 :

- Build Angular de production réussi à `2026-10-24T03:29:07Z`, avec SSR et
  25 routes pré-rendues ; compilation TypeScript du projet et des recettes UI
  réussie.
- **111 tests unitaires réussis** pour le contrôleur de livraison. Les décisions
  de navigation restent non destructives, ne se dupliquent pas et sont invalidées
  par un changement de saisie, de contexte, de version ou de disponibilité.
- **24 nouveaux scénarios navigateur réussis**, FR/EN : liens des deux éditeurs,
  retour annulé puis accepté en édition et composition, retour/avance concurrents,
  refus média tardifs `401`/`403` et redirection de session expirée. Les sorties ne
  créent aucune commande ni requête de mutation.
- Régression des deux espaces : **376 réussites sur 378** au premier passage.
  Une ancienne recette attendait encore une fermeture immédiate après une
  sauvegarde échouée : elle vérifie maintenant l’annulation conservant texte et
  erreur, puis l’abandon explicite. Cette recette et huit vérifications de
  navigation ont ensuite réussi : **9/9**.
- L’autre échec concernait le défilement vers Stripe depuis le Guide sur mobile :
  le focus atteignait la section, qui restait hors écran. Ce cas est passé lors de
  la relance puis **4/5 répétitions**, sans changement de sa source ni de sa
  recette. L’instrumentation minimale l’a reproduit : un seul appel natif de
  défilement laissait la section au-dessus de la fenêtre, sans second défilement
  JavaScript. La page mesure maintenant sa géométrie avant le focus et
  `scrollIntoView`, pour résoudre le layout courant tout en conservant marges et
  conteneurs défilants. La recette originale, sans instrumentation, passe ensuite
  **20/20 répétitions**. Le mécanisme interne exact du navigateur n’est pas établi ;
  la correction porte sur l’alignement observé, pas sur les droits ni les gardes.
- Passe finale après les deux corrections : **51/51 scénarios réussis**, dont les
  24 nouveaux cas, les sections du dossier, le focus mobile/bureau, la navigation
  du pilotage, l’historique de la file de publication et les accès expirés. La suite
  complète de 378 cas n’a pas été relancée après ces corrections ciblées.
- Format ciblé, lint global et ciblé, contrôles documentaires et
  `git diff --check` exécutés. Le seul avertissement de lint reste celui de
  `scripts/smoke-public.mjs:165` déjà présent avant ce chantier.

Les recettes utilisent le Web compilé et des réponses synthétiques interceptées,
sans API réelle, base, déploiement ni action de publication. Les traces de
régression sont dans `test-results/publication-navigation-regression/` ; les
relances ciblées dans `publication-navigation-routing/` et
`publication-navigation-focus-layout-fix/` sous `test-results/`. La dernière passe
est dans `test-results/publication-navigation-release-check/`.

## Chantier 3 : synthèse des prestations du dossier

Adaptation locale du 23 octobre 2026, sur
`codex/admin-dossier-service-summary`, depuis `9aa6331f` (PR #371), sans attendre
ni consulter sa CI. Le suivi local passe à **3/6 réalisés, 3 restants**.

L’onglet **Aperçu** de Commandites présente les obligations de l’accord actif,
avec canal, destination et occurrence. Les compteurs séparent réalisations à
preuve qualifiée, dispenses enregistrées et travail restant. Une déclaration
historique, une simulation ou un workflow complet sans preuve qualifiée ne devient
pas une réalisation confirmée. Accord absent, à confirmer et accord sans
prestations ont chacun un message explicite, sans total présumé.

Le modèle de présentation réutilise `qualifiedPublicationEvidence` et le contrat
serveur existant. `AdminSponsorshipProgress` porte le rendu et le badge partagé ;
`AdminSponsorshipNextStep` garde l’action prioritaire. Aucun second calcul de
priorité, endpoint, commande ou effet externe n’est ajouté. Chaque lien transmet
`sponsorshipId` et `obligationId` exacts au propriétaire Prestations de services.
Le récapitulatif statique des avantages est masqué une fois la synthèse chargée.
Les dates de preuve sont explicites à Toronto. La visibilité courante de la fiche
OpenG7 reste distincte de sa réalisation historique et n’est jamais appliquée à
OpenG20. Rechargement, erreur, refus ou changement de dossier retirent les anciens
faits de la synthèse.

Vérifications exécutées avec Node 22 :

- Build Angular de production réussi à `2026-10-24T03:52:34Z`, SSR et 25 routes
  pré-rendues ; compilation TypeScript du projet et des recettes UI réussie.
- **40 tests unitaires réussis**, dont 15 nouveaux groupes sur la synthèse et les
  tests existants de qualification des preuves et de purge du contrôleur.
- **10 nouveaux scénarios navigateur réussis**, FR/EN, bureau/mobile : six
  occurrences pour trois avantages, preuves qualifiées ou absentes, dispenses,
  simulation, durée, visibilité OpenG7, entrée exacte au clavier, états incomplets,
  rechargement, `401`/`403`/`503` et changement de dossier. Les quatre rendus ont
  passé Axe sur la synthèse et le contrôle de débordement horizontal.
- Passe ciblée de **45 scénarios** : 43 réussites et deux anciennes assertions
  incompatibles avec le remplacement du récapitulatif et l’ajout de liens de
  consultation. Ces assertions ont été limitées à leur objet, sans affaiblir la
  vérification de navigation ou de prochaine action ; **les deux relances passent**.
  Les 45 scénarios sont ainsi validés, sans relance de la suite UI complète.
- Revue indépendante : correction de la visibilité indûment attribuée à OpenG20,
  puis aucun autre défaut concret relevé. Format ciblé, lint global, contrôles
  documentaires et `git diff --check` réussis ; seul l’avertissement préexistant
  `scripts/smoke-public.mjs:165` subsiste au lint.

Les quatre captures finales sont sous
`test-results/dossier-service-summary-final/`, nommées
`service-summary-{fr-CA,en}-{1536,390}.png` dans les dossiers de recette.
Le rendu français bureau et mobile a été inspecté visuellement ; le rendu bureau
final a été relu après la correction de visibilité et de l’espacement des occurrences.
Les deux relances sont dans `test-results/dossier-service-summary-regression-fixes/`.
Ces tests utilisent des réponses synthétiques interceptées, sans API réelle,
base, déploiement ni publication. La manette physique et le zoom Windows restent
hors de cette validation ; la recette transversale est le chantier 6.

La revue du 24 octobre 2026 ajoute deux lectures indépendantes, modèle et UI :
aucun défaut actionnable supplémentaire identifié. Les validations applicatives
ci-dessus restent celles du même code ; elles ne sont pas relancées pour cette
revue et la préparation de la PR. La branche cible reste celle de la PR #371,
encore ouverte, pour isoler le diff du chantier 3.

Le chantier suivant est la lecture, correction et revue du contenu exact dans le
tiroir existant (S02/S05/S06/S11), avant les historiques et la recette transversale.

## Chantier 4 : lecture et correction du contenu exact

Adaptation locale du 24 octobre 2026, sur
`codex/admin-publication-content-review`, depuis `333f463a` (PR #372), sans attendre
la CI. Le suivi des adaptations locales passe à **4/6 réalisés, 2 restants**.

Le tiroir existant présente la version enregistrée et les modifications locales.
Deux volets repliés distinguent le texte saisi du texte, de l’horaire et de la
version enregistrés. L’aperçu textuel ne prétend pas reproduire un réseau social.
Le conflit de version conserve les corrections et explique comment les garder
avant de fermer et de relire la version courante. Aucun historique de versions,
accord client, outil riche ou service génératif n’est simulé. Sauvegarde,
modération et autorisation restent portées par leurs propriétaires inchangés.

Les nouvelles recettes ont révélé des commandes d’édition encore proposées au
rôle lecteur. Le tiroir et l’entrée Nouvelle publication appliquent désormais la
condition de présentation existante de la modération ; le lecteur conserve le
texte et les historiques disponibles. Les contrôles API restent inchangés et
autoritaires. Une erreur du sélecteur Axe initial (`role` explicite au lieu du
dialogue HTML natif) a également été corrigée dans la recette.

Validation locale : build Angular production/SSR à `2026-10-24T04:14:03Z`, 25 routes
pré-rendues, TypeScript projet et UI, **111 tests du contrôleur** et **23 scénarios
navigateur réussis**, dont 12 nouveaux cas FR/EN. La passe finale couvre versions
17→18, aperçus échappés, conflit/503, composition, lecteur, X/Échap/B, historique
arrière et autorisation exacte. Axe passe sur les quatre rendus bureau/mobile.
Deux lectures de revue, initiale puis complémentaire après le correctif lecteur,
n’ont relevé aucun défaut actionnable restant. Les captures FR bureau/mobile ont
été relues visuellement sous `test-results/v33-c4-content-review-final/`.

Format, lint global/ciblé, contrôles documentaires et `git diff --check` réussis ;
le seul avertissement de lint est celui déjà présent dans
`scripts/smoke-public.mjs:165`. Les tests utilisent des réponses synthétiques
interceptées, sans action réelle ni déploiement. Le chantier suivant est la
consultation des historiques et des preuves existants (S08/S23).

## Chantier 5 : sources d’historique et preuves disponibles

Adaptation du 24 octobre 2026 sur `codex/admin-dossier-history-sources`, depuis
`fa3b170b` (PR #373), sans attente de CI. **5/6 adaptations locales réalisées,
1 restante** : la recette transversale.

L’onglet Historique relie le journal d’interventions, les approbations de
préparation, les preuves du dossier et la modération selon les droits existants.
Chaque source conserve son périmètre ; les jalons et dernières actions disponibles
ne sont pas annoncés comme un historique complet des textes sociaux. Les liens
conservent le dossier exact et les ouvertures ne créent aucune décision.

L’audit historique réutilisé affiche canal et destination en clair, dates de
preuve/inventaire/conclusion à Toronto, page et limite distinctes du total filtré,
dernière conclusion disponible et références repliables. **Suivant** remplace la
page. Le lien Prestations cible contribution et obligation exactes ; il ne
qualifie pas la preuve. Le DTO ne fournit ni auteur, raison ni anciennes versions
sociales : aucun de ces éléments n’est inventé. Contrôleurs et API restent inchangés.

La revue indépendante a relevé un P3 de focus : fermer la modération ouverte
depuis l’historique renvoyait au bouton d’en-tête. Le panneau conserve désormais
son déclencheur réel et le repli existant si ce déclencheur a disparu ou est
masqué ; les protections de contexte restent actives. Le correctif a été relu et
testé en FR/EN ; aucun défaut actionnable ne reste dans le diff examiné.

Validation : build Angular production/SSR à `2026-10-24T04:22:30Z`, 25 routes
pré-rendues ; TypeScript projet/UI, **16 tests du contrôleur d’audit** et
**29 scénarios navigateur réussis**, dont huit nouveaux cas. Les recettes couvrent
sources/droits, retour du focus et filtres, changement de page sans cumul, dates
UTC passant au jour précédent à Toronto, conclusion minimale, liens exacts,
conflit/reprise et outils existants. Axe passe sur les huit rendus des nouvelles
surfaces, FR/EN et bureau/mobile. Les captures FR bureau et mobile ont été relues
sous `test-results/v33-c5-history-review-final/`.

Format, lint global/ciblé et contrôles documentaires passent ; le diff du chantier
est vérifié séparément des changements Docker apparus dans le workspace, conservés
hors commit. L’avertissement de lint préexistant reste inchangé. Tests sur réponses
synthétiques interceptées, sans déploiement ni action métier réelle.

## Chantier 6 : recette transversale locale

Recette du 24 octobre 2026 sur `codex/admin-guide-v33-acceptance`, depuis
`ff9091fe` (PR #374). Les trois PR de cette séquence restent distinctes : chantier
4 #373, chantier 5 #374, puis chantier 6. Aucune CI n’est attendue et aucune PR
n’est fusionnée automatiquement. **6/6 adaptations locales réalisées** ne signifie
ni V3.3 intégralement livrée, ni 56 critères métier intégralement qualifiés.

Les huit nouvelles recettes du tiroir couvrent FR/EN aux viewports effectifs
1536×864, 1280×520 et 768×432, dont deux recettes de manette simulée. Elles
parcourent les contrôles avec Tab/Shift+Tab, ouvrent les références, gardent la
saisie lors d’une annulation et restituent le focus après abandon explicite.
Chaque action finale est focalisée, entièrement dans le viewport et atteignable
par hit-test. La modalité native, le fond inerte, la priorité de la confirmation
supérieure et l’absence de requête mutante pendant consultation/annulation sont
vérifiés. Un A maintenu ne traverse pas l’ouverture d’une confirmation ; après
retour au neutre, B ferme seulement cette confirmation.

Douze cas supplémentaires exercent la synthèse des prestations, les sources
d’historique et l’audit des preuves en FR/EN à 1280×520 et 768×432. Ils gardent les
assertions de preuve qualifiée, d’identifiants exacts, de droits et de pagination,
puis vérifient le contrôle focalisé et son absence de recouvrement. Les captures
de petite hauteur montrent le viewport, sans agrandir artificiellement la page.

Résultats C6 : **168 tests unitaires réussis** et **42 scénarios navigateur
distincts réussis**, dont 20 nouveaux cas. Les 34 scénarios interespaces couvrent
aussi les prestations/preuves/dispenses, l’obligation exacte avant pagination,
la préparation unique, la conservation des vues du Guide, sa navigation non
modale et la purge après refus ou expiration. Les huit recettes du tiroir sont
exécutées séparément ; leur relance finale conserve également les mesures JSON
sur disque, car une pièce jointe en mémoire au reporter `list` ne suffit pas à
produire un artefact durable après succès. Les suites UI complètes et les
intégrations de fournisseurs ne sont pas relancées.

Le code de production reste celui du build Angular/SSR C5 à
`2026-10-24T04:22:30Z` ; C6 ne change que recettes et bilan. Les sources unitaires
exécutées sont `admin-controller`, `admin-publication-automation-http`,
`admin-sponsorship-services-summary`, `admin-sponsorship-workspace`,
`preparation-pilot`, `publication-automation-commands`, `publication-date-time`
et `sponsorship-publication-workflow`, sous `tests/` avec suffixe `.test.mjs`.

Les artefacts se trouvent dans `test-results/v33-c6-transverse-final/` (captures
et mesures JSON de l’éditeur/confirmation) et
`test-results/v33-c6-cross-workspaces/` (captures des autres surfaces). Les rendus
FR à 768×432 et EN à 1280×520 ont été relus visuellement. Les mesures décrivent
uniquement le viewport CSS ; 768×432 représente l’espace disponible à 200 % d’un
viewport 1536×864, sans qualifier le zoom réel du navigateur ou de Windows.

La revue indépendante de C6 a comparé les 56 lignes au pack, vérifié les trois
boucles étendues et confirmé sur disque les 14 PNG et 14 JSON du tiroir. Aucun
défaut actionnable ne reste dans le diff examiné. Format, TypeScript UI, lint
ciblé, contrôles documentaires et vérification du diff du chantier passent ; le
lint global déjà exécuté en C5 reste sans erreur, avec son avertissement
préexistant. Les changements Docker concurrents sont préservés hors des PR.

### Correspondance des 56 recettes du pack

Les formulations ci-dessous condensent les critères d’origine ; le pack reste
la référence. **T** désigne les huit recettes transverses du tiroir ; **X** les
34 recettes interespaces ; **N** les 168 tests unitaires exécutés en C6.
**C3/C4/C5** désignent les preuves datées des chantiers précédents, sans leur
attribuer une nouvelle exécution C6. « Existant, non relancé » est un inventaire
de couverture propriétaire, jamais une recette C6 réussie. Les preuves partielles
ne valent pas validation de toutes les variantes du critère.

| Recette | Critère                                                       | Capacité actuelle                    | Preuve et limite de la recette locale                                                                                                                             |
| ------- | ------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01     | Prestations identifiables, priorité unique, paiement distinct | Adapté C1/C3                         | X : synthèse exacte et navigation ; N : obligations/preuves ; pas de paiement déduit d’une URL.                                                                   |
| R02     | Web indépendant d’un blocage social                           | Existant                             | N : workflow d’un canal conservé malgré un envoi historique non résolu sur l’autre ; accord client versionné absent.                                              |
| R03     | Correction sans changement de l’offre historique              | Existant                             | C4 : payload d’édition du contenu seulement ; contrats d’engagement conservés, suite d’engagements non relancée C6.                                               |
| R04     | Approbation de préparation unique, historique accessible      | Adapté C1                            | X : approbation unique et vues conservées ; C5 : accès à sa source d’historique.                                                                                  |
| R05     | Consultation sans validation d’un contrôle incomplet          | Existant                             | X : sélection/inspection des prérequis sans mutation.                                                                                                             |
| R06     | Compteur sans contrôles non requis ni nombre universel        | Existant                             | N : projection de préparation ; couverture navigateur détaillée existante, non relancée pour chaque nombre.                                                       |
| R07     | Nouvelle version et invalidation des décisions affectées      | Existant, portée administrative      | N : modification exacte révoquant l’autorisation ; C4 : version 17→18 ; accord client versionné absent.                                                           |
| R08     | Conflit visible sans perte du brouillon                       | Adapté C4                            | C4 : conflit et saisie conservée ; C6 ne rejoue pas une concurrence réelle multiutilisateur.                                                                      |
| R09     | Restauration créant une nouvelle version                      | Manquant                             | Catalogue/restauration des anciens textes absents ; aucune commande fabriquée.                                                                                    |
| R10     | Proposition IA limitée au brouillon                           | Manquant                             | Aucun service de rédaction générative ; pas de recette fonctionnelle annoncée.                                                                                    |
| R11     | Suggestion IA périmée sans écrasement                         | Manquant                             | Même capacité absente ; obsolescence générative non simulée.                                                                                                      |
| R12     | Aucun faux bouton ou succès IA                                | Adapté par absence                   | T et revue du tiroir : texte et commandes existants seulement ; aucune rédaction IA raccordée.                                                                    |
| R13     | Médias collectifs avec portée et droits exacts                | Existant                             | Propriétaires MediaReviewWorkspace et décisions ; suites médias spécialisées non relancées C6.                                                                    |
| R14     | Retrait de sélection sans suppression du fichier partagé      | Existant                             | Contrat d’édition et contrôleur conservés ; scénario média partagé non relancé C6.                                                                                |
| R15     | Aucun outil riche sans contrat supporté                       | Capacité riche manquante             | T : interpolation textuelle échappée, pas de faux onglet riche.                                                                                                   |
| R16     | Limite du bon propriétaire                                    | Existant                             | N : budget UTF-16 de livraison ; C4 : compteur réel 2900, pas de limite 500 inventée.                                                                             |
| R17     | Aucun courriel client ajouté artificiellement                 | Adapté par conservation              | T : zéro mutation de consultation/annulation ; aucun nouveau parcours d’accord par courriel.                                                                      |
| R18     | Preuve entrante liée à version/page exactes                   | Manquant                             | Réception d’accord client versionné absente ; preuve de réalisation non substituée.                                                                               |
| R19     | Lacune d’accord documentée sans fausse réussite               | Documenté                            | Diagnostic et limites de ce bilan ; aucune table/API d’accord reçue ajoutée.                                                                                      |
| R20     | Correction d’identité sans consentement inventé               | Existant                             | Contrôleur d’identité et recettes de soumission conservés ; non relancés C6.                                                                                      |
| R21     | Aperçu de courriel puis confirmation finale                   | Partiel, propriétaire existant       | Demande d’information existante ; preuves entrantes/pièces d’accord client absentes ; pas de recette complète C6.                                                 |
| R22     | Mise en file distincte d’accord reçu ou de réalisation        | Existant, portée sortante            | N : aucune déclaration ou simulation ne solde une prestation ; parcours courriel spécialisé non relancé.                                                          |
| R23     | Simulation distincte de réalisation réelle                    | Existant                             | N et X : statut simulé non qualifié, preuve réelle nécessaire.                                                                                                    |
| R24     | Programmation distincte de publication                        | Existant                             | N : travail programmé/exécuté/réessayé sans prétendre à la réalisation.                                                                                           |
| R25     | Résultat incertain sans second envoi                          | Existant                             | N : réconciliation et commandes versionnées ; aucune preuve de persistance fournisseur réel en C6.                                                                |
| R26     | Rattacher le résultat à l’opération existante                 | Existant                             | N : réconciliation vérifiée et observation conservée en échec ; pas de nouveau post réel.                                                                         |
| R27     | Absence attestée et nouvelle autorisation distincte           | Existant                             | N : attestation explicite, révocation et audit des décisions ; fournisseur simulé.                                                                                |
| R28     | Retrait concurrent arbitré par le serveur                     | Existant                             | N : commandes/verrous et annulation ; une course réelle avec fournisseur n’est pas qualifiée par cette recette UI.                                                |
| R29     | Durée non attestée distincte de réalisation                   | Existant                             | N et X : durée en cours, preuve et observation distinctes.                                                                                                        |
| R30     | Dispense distincte de réalisé                                 | Adapté C3                            | N et X : compteurs séparés et aucune fausse preuve.                                                                                                               |
| R31     | Historique à portée explicite, sources spécialisées           | Adapté C5                            | X : sources du dossier, consultation, dates, pagination et focus.                                                                                                 |
| R32     | Aucune fausse différence d’image historique                   | Comparaison manquante                | Aucun comparateur historique ajouté ; pas de recette d’images avant/après inventée.                                                                               |
| R33     | Aucune consultation client fabriquée                          | Adapté C5                            | X : événements et sources disponibles seulement ; aucun événement « aperçu consulté » ajouté.                                                                     |
| R34     | Comparaison indisponible sans deux versions                   | Manquant                             | Catalogue comparatif absent ; aucun bouton universel Comparer ajouté.                                                                                             |
| R35     | Données privées exclues du contenu public/export              | Partiel, export historique manquant  | T : aperçu limité au texte saisi ; aucune garantie nouvelle d’export ni de filtrage de texte privé librement saisi.                                               |
| R36     | Retour conservant saisie, sélection, origine et focus         | Adapté C2/C5                         | T : annulation conservant texte/focus ; X : sources et retour ; pas de navigation entre versions inexistantes.                                                    |
| R37     | Même garde pour X/B/Échap                                     | Adapté C1/C2                         | C4 : trois fermetures ; T : garde et abandon explicite à petite hauteur.                                                                                          |
| R38     | Fermeture de la confirmation supérieure seulement             | Existant                             | T : Échap/B conserve le tiroir et la saisie ; aucune mutation.                                                                                                    |
| R39     | Retour Guide conservant vue/dossier/contrôle                  | Adapté C1                            | X : vues de préparation conservées ; anciens Bon/Passage/Autre non réintroduits.                                                                                  |
| R40     | Lecture seule UI et refus API                                 | Existant, présentation corrigée C4   | N : droits et origines via guard HTTP injecté ; X : lecteur et purge ; C4 : commandes masquées. Pas de qualification OIDC réelle.                                 |
| R41     | A maintenu sans double activation                             | Existant                             | T : maintien réel dans le simulateur puis neutre/B ; N : parseur et réarmement. Manette physique non qualifiée.                                                   |
| R42     | Saisie/menu, légendes et retour de focus                      | Existant                             | T : parcours clavier et commandes utilisées ; N : entrées combinées ; menus non utilisés non certifiés globalement.                                               |
| R43     | Modale accessible, fond inerte, focus restitué                | Existant                             | T : modalité native, hit-test, Tab/Shift+Tab, confirmation supérieure et retour au déclencheur.                                                                   |
| R44     | Guide non modal sans piège de focus                           | Existant                             | X : pause/fermeture, formulaire derrière le Guide utilisable et lecteur.                                                                                          |
| R45     | Fenêtre réelle 1920×1080 avec échelle système 125 %           | Qualification externe restante       | T vérifie 1536×864 CSS seulement ; Windows 125 % réel non exécuté.                                                                                                |
| R46     | Petite hauteur et espace disponible à 200 %                   | Adapté/recetté localement            | T et X : 1280×520/768×432, actions atteignables et pas de débordement ; équivalence CSS, pas zoom réel qualifié.                                                  |
| R47     | Aperçu sans réactions ou menus sociaux fictifs                | Adapté C4                            | T : rendu textuel et revue visuelle ; aucune statistique ou interaction sociale de démonstration.                                                                 |
| R48     | États lisibles sans couleur seule                             | Adapté C3/C4/C5                      | X : mots/raisons et Axe sur les trois surfaces ; T : focus ; compréhension humaine non déduite d’Axe seul.                                                        |
| R49     | Canal/destination exacts                                      | Existant                             | X : liens et obligation exacte avant pagination ; N : versions/destinations des commandes ; aucun envoi réel.                                                     |
| R50     | Contribution personnelle sans prestation inventée             | Existant                             | N : projection personnelle ; nouvelle synthèse limitée aux dossiers de commandite.                                                                                |
| R51     | Session expirée, purge et reprise sûre                        | Existant                             | X : purge après refus/expiration/changement de rôle ; N : HTTP protégé ; pas de reconnexion OIDC réelle C6.                                                       |
| R52     | Remboursement partiel selon workflow serveur                  | Existant                             | Affichage et calcul financier inchangés ; couverture spécialisée de progression conservée, non relancée C6.                                                       |
| R53     | Une cible interactive, chevron décoratif                      | Adapté C1/C3                         | X : ligne/détail et lien exact ; chevron du lien de prestation non interactif.                                                                                    |
| R54     | Action primaire non dupliquée dans le menu                    | Adapté C1                            | X : approbation unique ; nouveaux liens C3/C5 ne créent pas de décision concurrente.                                                                              |
| R55     | Horaire DST ambigu/inexistant résolu ou rejeté                | Existant, contrat selon propriétaire | N : `publication-date-time` du créneau/brouillon source ; le tiroir garde son contrat de date locale navigateur, il n’est pas requalifié contre tous les cas DST. |
| R56     | Échec de sauvegarde sans perte ni faux succès                 | Adapté C1/C4                         | C4 : échec503/conflit gardant texte/référence ; T : annuler la sortie garde la saisie, sans nouvelle sauvegarde.                                                  |

Les quatre familles fonctionnelles manquantes restent hors des six adaptations :
accord client versionné et preuve entrante, rédaction générative, catalogue complet
des anciennes versions sociales avec comparaison/restauration/export, et outils
riches sans contrat de sauvegarde. Une qualification Windows/manette physique et
les recettes d’intégration réelles restent séparées. Aucun déploiement, publication,
courriel ou remboursement réel n’a été exécuté.

## Tranche complémentaire du dossier illustré

L’utilisateur a autorisé cinq adaptations supplémentaires le 24 octobre 2026,
avec revue, tests locaux et une PR par chantier, sans attendre les CI entre les
chantiers. Le suivi porte sur **11 adaptations planifiées**, pas sur la totalité
des fonctions dessinées : **11 réalisées, 0 restante dans ce périmètre local**.

| Nº  | Adaptation complémentaire                                    | État                         |
| --- | ------------------------------------------------------------ | ---------------------------- |
| 7   | Fiabilité de l’horaire, de la copie et des liens de résultat | Réalisée localement et revue |
| 8   | Éditeur unique, aperçu à droite et agrandissement            | Réalisée localement et revue |
| 9   | Actions secondaires contextuelles sans doublon               | Réalisée localement et revue |
| 10  | Navigation ciblée dans le dossier et la livraison            | Réalisée localement et revue |
| 11  | Recette comparative et captures du rendu réel                | Réalisée localement et revue |

Le chantier 7 conserve l’instant serveur exact, secondes et occurrence comprises,
lorsque l’horaire affiché n’a pas changé. Une date nouvelle ou modifiée doit
exister une seule fois dans le fuseau du navigateur ; un refus conserve la saisie
et associe une erreur au champ. Les helpers existants du calendrier sont réutilisés
depuis un modèle du domaine, avec les réexports historiques conservés. Une copie
sans API presse-papiers n’annonce plus de succès. Le lien public d’une livraison
exige désormais un état publié en mode réel avec URL ; une simulation reste
identifiée sans lien présenté comme un résultat public.

Vérifications du chantier 7 : compilation TypeScript et typage UI, **161 tests Node
réussis**, **16 recettes navigateur FR/EN réussies**, build Angular de développement
avec SSR et 25 routes pré-rendues, format ciblé, ESLint global, contrôles
documentaires et `git diff --check`. Le lint conserve son unique avertissement
préexistant dans `scripts/smoke-public.mjs:165`. Revue indépendante du diff par
l’agent principal ; aucun défaut actionnable restant. Les recettes interceptent
des API synthétiques et n’envoient aucune publication réelle. Les CI seront
examinées à la fin de cette tranche ; leur résultat n’est pas présumé ici.

Quatre recettes existantes de reprise incertaine ont aussi été exécutées avec
succès en FR/EN, bureau/mobile. Elles utilisent une livraison réelle synthétique
pour vérifier le lien public après réconciliation ; les simulations restent
couvertes séparément par les cas qui exigent l’absence de ce lien.

Le chantier 8 réutilise le tiroir large, une grille de revue responsive et un pied
de sauvegarde fixe. L’aperçu à droite distingue le texte saisi, le texte enregistré
et les médias privés disponibles. Son agrandissement reste dans le même dialogue,
conserve le formulaire monté et rétablit le focus au retour. La sauvegarde native
reste unique ; les versions, droits et gardes de sortie sont conservés. Aucun
éditeur riche ou rendu social fictif n’est ajouté.

Validation C8 : build Angular de développement/SSR et 25 routes, typage des
recettes, **44 scénarios navigateur réussis** (contenu, agrandissement, clavier,
manette simulée et régressions C7). Captures FR/EN à 1536×864, 1280×520 et 390×844
dans `test-results/v33-c8-review-layout/` du worktree du chantier ; rendus bureau
et petite hauteur inspectés. Revue indépendante B : aucun défaut actionnable.
Les contrôles de forme, lint et documentation accompagnent la clôture du chantier.

La régression complète du fichier de publication passe également : **152 scénarios
navigateur réussis**, incluant les 44 cas ciblés ci-dessus. Les anciennes recettes
de reprise incertaine utilisent une livraison réelle synthétique lorsqu’elles
vérifient un lien public confirmé ; les cas de simulation vérifient son absence.

Le chantier 9 regroupe les commandes secondaires de la livraison dans un
disclosure contextuel natif. La correction expose une sauvegarde principale ;
l’autorisation reste dans la revue enregistrée. Un retour sans sauvegarde exige
des champs inchangés et rétablit le focus dans la revue. Le tiroir laisse Tab
suivre l’ordre natif depuis ses régions de lecture programmatiquement focalisées.
Les versions, décisions de modération et confirmations appartiennent toujours
aux mêmes contrôleurs. Le lecteur ne reçoit aucun menu de mutation.

B ou Échap replie d’abord le panneau de commandes actif ; le retour au neutre
reste obligatoire avant de quitter le tiroir. Les confirmations supérieures
gardent leur priorité. Revue indépendante B du regroupement et revue A des deltas
de focus/manette : aucun défaut actionnable restant après correction.

Validation C9 : **164 scénarios navigateur réussis** sur le fichier complet de
publication, dont les 12 nouveaux cas contextuels FR/EN et les collections de
dix JPEG avec leur ordre et leurs empreintes vérifiés avant une seule approbation
de la version exacte. Le build Angular/SSR, le typage UI, le lint global, le
format et les contrôles documentaires accompagnent cette validation locale.

Le chantier 10 relie les repères Contenu, Autorisation d’envoi, Publication et
Preuves à la prestation sociale explicitement choisie. Une source unique peut
être reconnue ; plusieurs sources ne sont jamais départagées arbitrairement.
Les liens conservent les UUID du dossier, du brouillon, de la livraison et du
passage, sans texte privé. Le retour des preuves conserve aussi une source
historique partagée par deux brouillons, sans substitution par le workflow courant.
Le propriétaire revalide la correspondance des identifiants.

Les régions disponibles reçoivent le focus après ouverture de la livraison exacte.
Une région absente selon l’état ou les droits est expliquée dans le tiroir, sans
action fictive. Le sélecteur utilise le mécanisme Angular prévu pour réappliquer
sa valeur après chargement des options. Les changements de sélection seuls dans
le même dossier gardent le contexte de défilement ; le contrôle est mis en vue
avant la mesure de recette et le seuil de 2 px reste inchangé.

Validation C10 : **112 tests Node ciblés réussis** et **22 scénarios navigateur
FR/EN réussis**, build Angular de développement/SSR (25 routes), TypeScript,
typage UI, lint, format, documentation et diff. La revue A a conduit à conserver
les identifiants historiques de retour et à synchroniser le sélecteur asynchrone ;
la contre-revue ne relève plus de défaut actionnable. Aucun clic de lecture ne
prépare, n’approuve ou n’envoie de publication.

Le chantier 11 ajoute une recette reproductible et une galerie locale du rendu
effectif, décrites dans la [réception visuelle](openg7-guide-v3-3-visual-acceptance.md).
La réception a conduit à corriger trois défauts dans leurs chantiers propriétaires :
champ et erreur DST désormais visibles après chaque refus, confinement du focus
dans le dialogue natif supérieur sous WebKit, et largeur du sélecteur de prestation
bornée sur mobile. Les assertions de saisie, de version, de neutralité de la manette,
de retour au déclencheur, d’UUID, de largeur et d’absence de commande sont conservées.

Preuve du 24 octobre 2026 : **264/264 scénarios navigateur réussis**, sans échec,
instabilité ou scénario ignoré, sur Chromium, Firefox, WebKit et mobile WebKit.
La révision testée est `3057557c2c93f8e56150f052e76f02c3166c7633`, checkout propre,
avec deux workers. La galerie présente **176 captures issues de 136 scénarios**,
44 images par projet, sans métadonnée manquante. Les images intactes et leurs
empreintes restent dans `test-results/publication-review-gallery/`, hors de Git.
La revue indépendante des captures bureau, mobile, petite hauteur, erreur et
confirmation ne relève plus de défaut concret.

Le build production/SSR (25 routes) et les **7 506 tests Node réussis, 8 ignorés**
portent sur `8a9678c1b425aa06074cff2c71c93cef16c4c0b1`. Le code applicatif est
identique dans la révision de réception : seul le budget local du scénario de
manette passe à 60 secondes, sans modifier ses entrées, trames ou assertions.
Les deux recettes de dix JPEG disposent aussi de 60 secondes. Les suites Node et
navigateur ont été exécutées successivement pour la validation finale. Typage UI,
lint global (aucune erreur, un avertissement préexistant), format et contrôles
documentaires complètent les preuves locales. Ces résultats ne présument pas les CI.

Les cinq PR complémentaires sont [#377](https://github.com/OpenG7/openg7-funding-platform/pull/377),
[#378](https://github.com/OpenG7/openg7-funding-platform/pull/378),
[#379](https://github.com/OpenG7/openg7-funding-platform/pull/379),
[#380](https://github.com/OpenG7/openg7-funding-platform/pull/380) et
[#381](https://github.com/OpenG7/openg7-funding-platform/pull/381).
Les quatre familles fonctionnelles absentes et les qualifications matérielles
recensées plus haut restent des travaux séparés. Aucun déploiement ni effet métier
réel n’a été exécuté.
