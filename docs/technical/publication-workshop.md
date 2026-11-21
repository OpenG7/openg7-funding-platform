# Suivi individuel et atelier de publication

L’onglet Publication est un suivi individuel compact : état courant, exceptions,
prestations promises, prochaine action et livraisons confirmées. Son ancien
atelier administratif est remplacé intégralement. Preflight prépare les
propositions privées; le Comptoir et Examiner accueillent leur traitement;
Funding conserve les décisions et les moteurs de diffusion existants. Consulter
un dossier n’est pas une étape obligatoire de préparation ou de livraison.

## Cartographie préalable

Funding possède un [connecteur durable](preflight-connector.md), une boîte distante
et une recette synthétique. L’Atelier ajoute la préparation éditoriale par dossier
et son adoption privée. Le connecteur et l’Atelier conservent des registres de
versions distincts pour la même source; leur activation simultanée est refusée
avant le démarrage des traitements.

| Responsabilité                   | Propriétaire et composants réutilisés                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Accord et prestations promises   | Funding : `sponsorship-commitments/*`, versions d’engagement et obligations                                |
| Identité et consentement public  | Funding : dossier, consentement documenté et reçus audités                                                 |
| Préparation administrative       | Funding : `admin-preparation.service.ts` et préparation par prestation                                     |
| Missions et propositions privées | Preflight : contrats v1, `workflows.ts`, moteur, worker et persistance JSONB                               |
| Transport authentifié            | Funding : `preflight/client.ts`, OAuth et validation du contrat distant                                    |
| Revue exacte et édition          | Funding : examen par prestation, sauvegarde de brouillon et contrôle de version                            |
| Autorisation et exécution        | Funding : modération, publication Web et moteur social existants                                           |
| Preuves de livraison             | Funding : preuves qualifiées par obligation; aucune réponse IA ne fait preuve                              |
| Présentation du dossier          | Funding Web : projection `admin-sponsorship-publication-monitor`, contrôleur de suivi et tiroir de détails |

Les anciens blocs visuels ont les destinations suivantes. Les composants métier
et leurs contrats restent réutilisés; les formulaires ne sont pas conservés dans
des accordéons de Publication.

| Ancienne zone                                                 | Propriétaire dans le nouveau parcours                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Atelier, propositions complètes et adoption                   | Espace de préparation du Comptoir, `AdminPublicationWorkshopComponent`                  |
| Contrôles administratifs et approbation du dossier            | Même espace, `AdminSponsorshipPreparationComponent`                                     |
| Accord, qualification historique et ajustements               | Outils du dossier → Accord, `AdminSponsorshipCommitmentsComponent`, ouvert à la demande |
| Réglages du profil, visibilité Web et suivi social déclaré    | Fiche et Médias, formulaire et workflow natifs                                          |
| Édition et revue d’une prestation                             | Examiner sur l’obligation exacte                                                        |
| Programmation, autorisation et incident de livraison          | Contrôleur et tiroir de livraison existants                                             |
| Preuves et historique                                         | Détails de la prestation, Suivi des prestations et Historique                           |
| Grandes synthèses, guide en six étapes et panneaux redondants | Retirés du suivi; aucune seconde procédure de validation                                |

## Contrats et versions

L’enveloppe mission v1 et les deux workflows existants restent compatibles.
Un contexte éditorial optionnel versionné permet au workflow de commandite de
préparer un contenu commun et des déclinaisons Web/Facebook/LinkedIn sans nouveau moteur.
Chaque déclinaison référence sa destination et son obligation exacte.
Pour les accords à passages multiples, la préparation vise le prochain passage
non livré de chaque destination et cible. Toutes les versions des obligations
ouvertes participent à l’empreinte source; les prestations restantes restent
conservées. Une livraison qualifiée ou une dispense fait avancer la préparation du passage
suivant, sans gonfler les réponses de transport avec des copies du même texte.

La version de l’accord, la révision monotone du snapshot source, son empreinte,
la proposition Preflight, le contenu commun, les déclinaisons, le brouillon
Funding, l’approbation et la livraison constituent des références distinctes.
Une nouvelle proposition ne remplace pas silencieusement un brouillon modifié.
Les propositions obsolètes restent consultables, sans pouvoir être adoptées
comme courantes.

Les versions du contenu commun et des déclinaisons commencent à 1 dans chaque
proposition. Les adaptations Web/Facebook/LinkedIn sont déterministes à partir d’un même
brouillon IA validé. Les médias restent sans sélection : cette évolution ne
qualifie aucun droit d’utilisation par destination.

## Données et autorité

Le snapshot transporte uniquement les faits nécessaires et autorisés. Sans
consentement public, aucun nom public n’est transmis comme matériau publiable.
Les coordonnées privées inutiles sont exclues. Les informations absentes et
les consentements manquants produisent une préparation partielle, consultable
pour examen, sans autorisation implicite.

La préparation et l’adoption d’une proposition ne constituent ni une approbation
éditoriale, ni une autorisation de diffusion. Chaque destination conserve ses
contrôles Funding, sa version approuvée et ses preuves. Les modifications et
conflits sont revérifiés côté serveur. La provenance identifie explicitement
le fournisseur simulé; aucun fournisseur payant n’est activé par cette évolution.

L’adoption confirmée peut remplacer le résumé Web courant par le résumé proposé,
dans le profil natif tenu privé. La confirmation l’indique explicitement. Une
modification source postérieure à la génération bloque cette adoption. Un
brouillon social modifié manuellement bloque le remplacement et annule
l’ensemble de la transaction; aucune proposition ne l’écrase automatiquement.
Si le résumé adopté diffère du contenu déjà examiné, la décision de modération
du dossier devient obsolète. Une personne doit examiner le nouveau contenu et
enregistrer une décision courante avant sa composition par le moteur social.
Les brouillons sociaux jamais examinés restent admissibles à une composition
privée selon les autres contrôles; cette composition n’autorise pas leur envoi.
Le titre et le corps détaillé restent consultables dans la proposition, tandis
que la publication Web conserve les champs et limites de son propriétaire natif.
La provenance distante vérifiée appartient au contrat Atelier et à son adoption
persistée. Le reçu d’examen natif conserve son contrat historique
`origin: funding` et `preflightLink: unverified` pour le contenu Funding courant.

## Réutilisation de l’interface

Le suivi compose les données du dossier, les propositions Atelier, les livraisons
et la projection du Comptoir, sans mutation à la lecture. Chaque ligne représente
une obligation enregistrée, avec canal, cible et passage. Les compteurs excluent
les dispenses et comptent seulement les preuves qualifiées; préparation,
adoption, approbation, programmation et simulation ne sont jamais des livraisons.
Les exceptions passent avant la prochaine intervention; les références longues,
versions, preuves et avertissements détaillés s’ouvrent au second niveau.

Le tiroir **Détails de la prestation** regroupe les données existantes de la
prestation sélectionnée. Son résumé présente l’état et la prochaine action, avec
la preuve qualifiée disponible et la dernière observation de visibilité datée.
Une visibilité sans observation datée reste à vérifier; elle ne remplace ni
n’efface une livraison confirmée. Les avertissements, les données périmées,
l’écart entre proposition et brouillon et les simulations restent visibles sans
déplier un volet.

Trois volets, **Contenu associé**, **Préparation et programmation** et **Preuves
et références**, sont fermés à chaque ouverture du tiroir ou changement de
prestation. **Contenu associé** présente le texte complet disponible de la
proposition Preflight, du brouillon Funding ou de la livraison, sans le remplacer
par un résumé tronqué. **Préparation et programmation** regroupe les dates
d’adoption et de revue, l’horaire enregistré et les accès secondaires, dont
l’ajustement de la prestation et de ses délais. **Preuves et références** conserve
les versions d’obligation, de proposition, de source et de livraison, les
identifiants d’audit et de preuve et le lien vers le suivi des prestations. Un
horaire enregistré ne prouve pas qu’une programmation est encore active.

Ce tiroir ne porte pas de nouvelle approbation et n’affiche pas la fiche globale
de préparation. Les prérequis communs se traitent dans le dossier; les commandes
d’ouverture et d’examen conservent leur cible et leur parcours propriétaires,
avec leurs droits et confirmations existants.

Une action contextuelle par prestation rejoint son responsable. Les contenus
complets et l’adoption restent dans l’atelier réutilisé, puis Examiner assure
la revue exacte du brouillon. Le dernier suivi connu peut rester visible après
une panne avec sa date; un accès refusé ou une nouvelle session purge le contexte.
Une file indisponible ne prouve ni son absence ni une attente collective.

Les parcours utilisent uniquement des identifiants de navigation :

- Comptoir : `/admin/fundraiser/preflight?view=desk`, `deskSearch` porte la
  référence du dossier et `reviewReturn` l’obligation à développer et mettre en
  évidence. Ne pas ajouter `sponsorshipId` à cette vue : il ouvrirait Examiner.
- Examiner : même route, avec `sponsorshipId` et `obligationId` exacts.
- Propositions et préparation : même route avec `view=publication` et
  `workshopSponsorshipId`. Cet espace réutilise les préparations et leur adoption;
  il ne crée pas un moteur de validation collective.
- `publicationReturn` conserve l’identifiant UUID du dossier pour le retour au
  suivi. Le Comptoir et Examiner construisent un lien interne fixe; aucune URL
  de retour arbitraire n’est exécutée.
- Accord : bouton **Accord** dans la barre d’outils globale du dossier, accessible
  depuis chaque onglet. Le panneau n’est monté qu’à sa première ouverture; il ne
  fait plus partie du contenu permanent de Publication. Les liens existants
  `/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=publication#dossier-agreement`
  et les fragments `dossier-assistance-source` / `dossier-assistance-review`
  ouvrent cet outil à la demande. Qualification, ajustements et commandes de
  délai ou de durée conservent leurs contrôles métier.
- Réglages du profil : même route avec `tab=media#dossier-website-settings`.
- Revue administrative du commanditaire : même route avec
  `tab=publication#dossier-review`. L’activité de préparation enregistrée, si
  disponible, reste consultable dans son tiroir depuis l’en-tête de Publication.

L’attente collective exige une prestation exacte observée dans le Comptoir en
état `to_review`, avec contribution, obligation, destination et ordinal cohérents.
La présence d’une proposition Preflight seule ne suffit pas. La boîte distante
générique et les reçus natifs gardent leur rattachement `unverified`; seule
l’adoption Atelier possède sa provenance vérifiée. Le moteur éditorial Atelier
prépare Web/Facebook/LinkedIn et l’adoption utilise le brouillon natif de chaque
canal, rattaché à son obligation exacte. Les textes sociaux sont bornés à 2 500
caractères dans ce contrat de préparation. Aucun
raccordement, destination configurée, droit média ou fournisseur réel n’est
déduit d’un nom de canal ou d’une image disponible. La décision de revue reste
individuelle et traçable, même lorsqu’elle est prise depuis le Comptoir.

## Déclenchement et API privée

Les triggers de la migration 069 enregistrent durablement les changements de
dossier, d’engagement, d’obligation, de média, d’affectation, de consentement et
de brouillon. Le relais backend les réconcilie toutes les deux secondes lorsque
son activation est explicite. Une même empreinte automatique réutilise sa mission.
Une régénération explicite crée une nouvelle révision après un résultat terminal.
Le contenu de mission est immuable; les appels réseau ont lieu après commit.

Avant une nouvelle mission, le relais notifie `source.updated`. Une réception
incertaine est réconciliée avec le même identifiant de mission avant renvoi.
Funding consulte ensuite les résultats, vérifie le tenant, la source, les
obligations, les contrôles et la provenance, puis conserve la proposition privée.
La version courante est revalidée à la lecture et à l’adoption.

| Méthode | Route sous `/api/admin/sponsorships/publication-workshop` | Effet                                                                                   |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET     | `?contributionId=<uuid>`                                  | Lecture seule du suivi, de la proposition courante et des 30 dernières propositions     |
| POST    | `/prepare`                                                | Préparation ou régénération avec `contributionId`, `expectedSourceVersion`, `requestId` |
| POST    | `/adopt`                                                  | Adoption dans les brouillons natifs avec les mêmes champs et `proposalId`               |

Les lecteurs administratifs consultent les données; seuls les opérateurs et
propriétaires commandent la préparation ou l’adoption. Les POST exigent l’origine
Funding exacte, du JSON borné et un identifiant de requête scellé à l’acteur et au
contenu. Les paramètres de portée fournis par le client sont refusés. Les réponses
restent `private, no-store`; les versions concurrentes produisent un conflit.
L’approbation et la publication ne font pas partie de ces routes.

## Qualification

Le raccordement exige la migration additive
[069](../../apps/funding-api/migrations/069_publication_workshop.sql), après la
migration [068 du connecteur](../../apps/funding-api/migrations/068_create_preflight_connector.sql),
et les grants API correspondants. Le fichier Atelier réel est
`069_publication_workshop.sql`, et non `068_publication_workshop.sql`.
La refonte du suivi ne modifie ces migrations ni n’en ajoute.
`PREFLIGHT_WORKSHOP_ENABLED=false` reste la valeur initiale. Le connecteur conserve
son flag `PREFLIGHT_ENABLED`; l’API et son worker refusent les deux flags à `true`
avant tout traitement. La boîte
distante et la recette synthétique possèdent leurs propres flags et n’activent
pas ce relais.

Déployer le contrat éditorial Preflight acceptant `linkedin` avant d’activer le
producteur Funding qui transmet les destinations Web, Facebook et LinkedIn
prévues dans le dossier.
Les contextes Web/Facebook existants restent compatibles. Un serveur Preflight
plus ancien doit refuser une destination inconnue; ce refus ne permet ni de
supprimer LinkedIn de la mission, ni de la transformer en Facebook. La mission
et son erreur restent visibles pour réconciliation après mise à niveau.

L’overlay [workshop](../../docker-compose.preflight-workshop.yml) se place après
l’overlay [inbox](../../docker-compose.preflight-inbox.yml) et les overlays TLS et
identité déjà utilisés. Il configure le flag Atelier et désactive le producteur
du connecteur. Il réutilise le secret serveur monté en lecture seule et
sa copie privée en mémoire; aucun secret ne passe au navigateur. Les endpoints
HTTPS, le tenant et le client limités à `funding-platform` restent configurés
côté serveur. `PREFLIGHT_MAX_COST_USD` borne le budget demandé par mission sans
activer un fournisseur IA payant.

Activer le relais autorise la préparation des dossiers Funding concernés et leur
réconciliation; cette décision opérationnelle est distincte de l’installation du
code. Conserver les overlays et la configuration privée lors des recréations.
Aucun service, compte, consentement ou dossier réel n’a été modifié par la recette
sur données synthétiques.

### Recette locale avec le vrai raccordement

Depuis la racine Funding, indiquer le chemin absolu du checkout Preflight :

```powershell
node scripts/admin-acceptance.mjs --preflight-root C:\GitHub\openg7-preflight sponsorship-preflight-acceptance.spec.ts --project=chromium
```

Le profil prépare une pile jetable, ses bases et une identité OAuth/JWKS locale.
Il exécute le relais Funding, l’API et le worker Preflight avec l’IA, Stripe et
les transports sociaux simulés. Le parcours part d’une commandite de 15 CAD,
prépare une variante par destination, puis vérifie l’adoption humaine et les
décisions Funding distinctes. Les autres passages promis restent suivis dans
Funding. Relever les
résultats de chaque étape dans les artefacts de la recette; la présence de cette
commande ne constitue pas un résultat d’exécution.

La visibilité Web peut produire une preuve locale qualifiée selon le contrat
Funding. Les reçus Facebook/LinkedIn en mode `mock` restent simulés et ne
soldent pas leurs obligations. La notification métier finale vers Preflight
conserve son état de raccordement propre; aucune clôture globale n’en est déduite.

La régression d’une offre historique de 500 CAD dans
`tests/integration/publication-workshop.integration.mjs` vérifie trois variantes,
la réutilisation du brouillon LinkedIn natif, l’adoption idempotente et la
préservation d’une correction humaine LinkedIn. Elle utilise un PostgreSQL
jetable et une réponse Preflight synthétique; elle ne qualifie pas à elle seule
le transport distant ou le parcours navigateur. Aucune adoption ne crée de
décision de préparation, de livraison ou de preuve d’acquittement.

Les tests unitaires, PostgreSQL jetable et navigateur sur fixtures prouvent des
périmètres distincts. Une recette avec IA simulée ne qualifie ni un fournisseur
IA réel, ni les identités, les médias ou la diffusion de production. Les commandes
applicables sont décrites dans la [matrice de validation](../development/validation.md).

Recette initiale de l’Atelier du 8 novembre 2026, antérieure à la refonte du suivi
(ces résultats ne qualifient pas la nouvelle interface) : builds TypeScript et Angular/SSR, contrôle
des types des tests UI, suite Funding de 7 699 réussites et 8 tests ignorés,
3 intégrations Atelier et 33 régressions PostgreSQL réussies. Les 25 scénarios
navigateur distincts couvrent notamment FR/EN, Nuit, clavier, Axe, mobile,
historique, conflit, droits et reprise. La recette inter-dépôts valide 5 tests
avec l’API et le worker Preflight réels et l’IA simulée. Preflight valide aussi
61 unités et 13 tests PostgreSQL. Le lint ne présente aucune erreur; son
avertissement préexistant dans `scripts/smoke-public.mjs` reste hors périmètre.
Un complément de 35 tests API/client/worker passe également sous Node 22.23.3
dans un conteneur jetable sans réseau externe, avec sources et dépendances de
test montées en lecture seule.
