# Espace Preflight dans Funding

La page `/admin/fundraiser/preflight` est une supervision des prestations
Funding, des propositions externes et de la recette locale. Sa présentation
reprend la maquette fournie : en-tête, quatre vues, indicateurs colorés,
commandites dépliables et synthèse latérale. Le cadre administratif partagé,
la recherche, le Guide, la langue et les permissions sont conservés.

## Audit et réutilisation

| Catégorie             | Existant et décision                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Réutilisable          | Prestations promises/campagnes, engagements et obligations versionnés, workflow de publication, preuves qualifiées et fiche de préparation. |
| À adapter             | Regroupement par contribution, compteurs opérationnels, filtres, pagination de groupes et présentation Examiner.                            |
| Ajout autonome        | Projection serveur `GET /api/admin/preflight/desk`, navigation interne et détail des métadonnées Preflight.                                 |
| Contrat à étendre     | Rattachement puis adoption contrôlée d’un résultat externe pour un engagement et une prestation exacts.                                     |
| Dépendances restantes | Préparation interapplications d’une commande entière, analyse de médias par destination et correction distante de propositions.             |

Le Comptoir de démonstration `/demo/prestations` conserve des états synthétiques
en mémoire. Il n’est pas le propriétaire du métier administratif. Les vraies
prestations sont les obligations d’un engagement rattaché à une contribution.
Leur suivi et leurs décisions restent dans les composants/services Funding.

## Quatre vues

Le paramètre `view` accepte `desk`, `rehearsal`, `proposals`, `evidence` et ouvre
le comptoir par défaut. La navigation clavier suit les onglets et leur focus.
Les filtres du comptoir utilisent `deskStatus`, `deskPage`, `deskSearch`;
la sélection d’une recette conserve `rehearsalId`.

- **Mon comptoir** utilise le [contrat desk](preflight-desk.md), un snapshot
  PostgreSQL en lecture seule et les projections existantes des campagnes.
  Les quatre catégories comptent des prestations, jamais des propositions.
  Les dispenses restent exclues et identifiées. Les groupes commerciaux sont
  les contributions existantes, avec leur vraie référence et leur devise.
- **Recette locale** réutilise les [scénarios existants](preflight-rehearsals.md),
  leurs six étapes confirmées, identifiants, reprises et limites de suivi.
- **Propositions (toutes)** conserve la [boîte distante](preflight-inbox.md),
  les pages de vingt éléments et leurs avertissements. Examiner consulte les
  métadonnées disponibles; le lien vers la console reste indépendant.
- **Parcours et preuves** utilise la même instance du composant de recette en
  mode observation. Aucun lancement ni renvoi n’y est proposé. Une preuve de
  passerelle décrit un échange; elle n’établit pas la livraison d’une prestation.

Les vues recette/preuves partagent une seule instance lorsqu’on bascule entre
elles. Quitter leur espace arrête le suivi; le retour relit le journal existant
sans nouvelle soumission automatique.

## Examiner et gouvernance

Examiner une prestation ouvre `AdminSponsorshipPreparationComponent`, déjà
utilisé dans les campagnes et les dossiers. Son approbation versionnée porte
sur la préparation du dossier entier, et non sur la seule carte sélectionnée.
Ses droits, confirmations et audits existants restent applicables.

Les liens vers la prestation exacte, le dossier, les corrections et la
publication réutilisent les destinations propriétaires. Une autorisation de
publication reste distincte de l’approbation de préparation. Une livraison
n’entre dans le compteur Livrées qu’avec une preuve qualifiée pour l’obligation
exacte. Aucune consultation ne crée une transaction, un envoi ou une décision.

Les préparations internes sont identifiées comme Funding. Le rattachement des
propositions externes est déclaré non vérifié; ni les noms, ni les montants,
ni les dates ne servent à le déduire. Les scénarios locaux gardent leur badge
de données fictives et la provenance IA simulée observée.

## Écarts assumés avec la maquette

Les nombres de la maquette ne sont pas repris. Les synthèses utilisent le même
univers métier recherché, avant pagination et filtrage d’étape; un dossier
correspondant conserve toutes ses prestations non dispensées.

Les références commerciales Funding remplacent les numéros universels CMD
illustratifs. Aucun nouveau modèle de commande ou moteur de prestations n’est
créé. Aucun aperçu de média ni contrôle IA réussi n’est fabriqué lorsque la
projection ne fournit pas sa preuve.

La disponibilité de lecture des propositions est datée. Elle ne prouve pas la
santé du worker : celui-ci reste non vérifié dans ce panneau. Une indisponibilité
du comptoir et celle de la boîte externe sont indépendantes. Le comptoir et la
recette peuvent garder les dernières preuves datées lors d’une panne temporaire;
un refus d’accès retire les données concernées.

## Évolution minimale du rattachement externe

Avant de proposer l’adoption de contenus Preflight dans une prestation réelle,
le consommateur Funding devra vérifier et persister ensemble :

1. Tenant et application autorisés, identifiants de mission et de proposition.
2. Engagement source exact, contribution propriétaire, version et empreinte du
   snapshot des faits Funding. Une proposition obsolète doit être bloquée.
3. Obligations concernées par identifiant/version, canal, destination et ordinal.
4. Résultats/brouillons et contrôles référencés, provenance et simulation explicites.
5. Médias et droits d’utilisation propres à chaque destination; une sélection
   Web n’autorise pas un usage Facebook ou LinkedIn.
6. Import idempotent, revue humaine et adoption via les commandes propriétaires,
   avec version courante, autorisation et audit avant toute mutation.

Le protocole générique mission v1 ne constitue pas à lui seul cette adoption.
Le connecteur durable préparé séparément doit être intégré et qualifié avant
d’annoncer un parcours opérationnel complet de préparation en lot. Ces besoins
ne modifient pas les contrats de recette actuels.

## Validation

Les tests desk couvrent les quatre catégories, les preuves, les autorisations
par prestation exacte, les dispenses, la cohérence globale et le snapshot avec
plus de cent passages. Les tests de campagnes protègent le contrat réutilisé.
Les suites UI Preflight couvrent navigation, recette, propositions et comptoir,
avec FR/EN, clavier, responsive, droits, indisponibilité et reprises.

Appliquer la [matrice de validation](../development/validation.md). Les essais
UI utilisent des fixtures isolées; la recette réelle locale conserve ses
échanges et son worker réels avec IA simulée. Aucun de ces essais ne qualifie
une publication externe ou un environnement de production.

### Vérification locale de la refonte — 4 novembre 2026

- Build Angular production et ses 25 routes statiques réussis; images API/Web
  construites sous Node 22 et redémarrées avec les overlays locaux existants.
- `yarn test` : 7 610 réussites, aucun échec, 8 tests ignorés.
- 39 scénarios navigateur Preflight validés avec fixtures synthétiques isolées,
  dont FR/EN, mobile, clavier, Axe, reprise et parcours Examiner. Une erreur de
  paramètre dans une fixture a été corrigée puis son scénario rejoué.
- 38 tests desk/campagnes/HTTP/autorisation réussis sous Node 22/Linux, conteneur
  éphémère sans réseau, système et tests en lecture seule.
- Lecture réelle du nouveau desk local : 2 prestations enregistrées dans un
  dossier, toutes deux à préparer; aucune livraison annoncée sans preuve.
- Recette réelle relue : attente d’informations et proposition simulée prête
  confirmées; reprise vérifiée, aucune nouvelle mission soumise pour ce contrôle.
- HTTPS réel, connexion obligatoire, API privée 401 et descendant inconnu 404
  sur le serveur Web Docker vérifiés. Les cinq services locaux sont sains.
- Lint sans erreur (un avertissement antérieur dans `scripts/smoke-public.mjs`),
  documentation, budgets, sélection CI et `git diff --check` réussis.

Le proxy Angular de développement déjà présent sur localhost reste conservé;
les images Docker sont également à jour. Aucune migration, publication externe,
modification des règles métier, du realm ou d’un compte humain n’a été effectuée.
