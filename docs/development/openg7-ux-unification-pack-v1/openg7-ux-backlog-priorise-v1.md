# OpenG7 Funding Platform — Backlog UX/UI transversal (proposition)

> **Statut : tickets proposés, non créés sur GitHub, non implémentés.**
> Référence : `openg7-platform-unification-ux-blueprint-v1.md` ; inventaire documentaire `9bd24edb1c2d86d942907023e7fa53aa12fd41fd` décrivant la révision applicative `b00ad2b2`.
> Effort relatif `S/M/L` : comparaison de complexité, **pas** une estimation d'heures ou de coûts.

## Convention

- **P0** : cohérence des autorisations, vérité des états et sûreté des effets externes.
- **P1** : efficacité et intelligibilité des parcours.
- **P2** : finition, performance non bloquante et uniformisation visuelle.
- **État source** : `signalé par blueprint`, `proposition`, `à vérifier`. Aucun défaut de production n'est présumé démontré.
- **DoD commun** : analyse du code actif, absence de nouvelle mutation concurrente, droits serveur conservés, i18n FR/EN, clavier/focus, responsive, tests ciblés exécutés, compte rendu avec preuves et limites.

## Lot 0 — Établir la réalité avant tout changement

### OUX-001 — Réconcilier les révisions et les PR ouvertes

- **Priorité / effort** : P0 / M ; **état** : à vérifier.
- **Sources** : blueprint général (document `9bd...`, code `b00ad2b2`), blueprint dossier V2 (autre snapshot), PR 347/348 mentionnées par le document.
- **Travail** : identifier la branche active, composants présents, modération d'en-tête, Assistant, guide, propriétés API et états simulés. Produire un tableau `décrit / codé / testé / déployé / inconnu`.
- **Acceptation** : aucun code métier modifié avant signature de la matrice ; aucun « livré » déduit d'une simple maquette ; conserver les numéros de PR/révisions précis.

### OUX-002 — Recenser les raccourcis et les retours de contexte

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Surfaces** : Cockpit, À traiter, Pilotage, Assistant, Commandites, Campagnes, Automatisation, Factures, Qualité.
- **Travail** : inventaire des URL/cibles `sponsorshipId`, `obligationId`, `deliveryId`, `contributionId`, `messageId`, onglet, fragment, retour et focus.
- **Acceptation** : navigation directe sans objet connu ne choisit pas arbitrairement le premier résultat ; retour au dossier correct si disponible.

## Lot 1 — Clarté des droits, de la preuve et du mode simulé

### OUX-003 — Aligner le bouton de génération de factures sur la capacité API

- **Priorité / effort** : P0 / S–M ; **état** : écart signalé par blueprint.
- **Propriétaire** : page `/admin/fundraiser/invoices` + politique API existante.
- **Travail** : inspecter `canManage`, distinguer permissions `reader/operator/owner` sur l'action de backfill ; désactiver/masquer selon choix UX cohérent ; conserver inspecteur/document en lecture autorisée.
- **Acceptation** : opérateur non autorisé ne voit pas une action apparemment exécutable ; backend refuse toujours les appels non autorisés ; tests des trois rôles, 403 et session expirée.

### OUX-004 — Aligner le formulaire Dépenses sur les capacités API

- **Priorité / effort** : P0 / M ; **état** : écart signalé par blueprint.
- **Propriétaire** : `/admin/fundraiser/expenses`.
- **Travail** : autorisations précises sur création, édition, publication et preuves ; présentation lecture seule pour les non-propriétaires ; ne pas modifier l'API pour accommoder l'UI.
- **Acceptation** : aucun bouton mutation présenté comme autorisé sans capacité ; tests owner/operator/reader et transition de rôle.

### OUX-005 — Distinguer clairement simulation, indisponibilité et confirmation

- **Priorité / effort** : P0 / M ; **état** : partiellement documenté.
- **Propriétaires** : Assistant, analyse média, automation sociale, activité externe.
- **Travail** : texte et badges honnêtes `mock`, `disabled`, `not_configured`, `pending`, `uncertain`, `live confirmé` selon source ; pas de traduction « IA analysée » sur résultat de l'analyse technique Sharp seule.
- **Acceptation** : capture et tests de ces états ; aucun statut `Publié` ou `Livré` sans fait conforme.

### OUX-006 — Contrat de réconciliation des résultats incertains

- **Priorité / effort** : P0 / M ; **état** : amélioration de présentation.
- **Propriétaires** : Automatisation / tiroir de livraison, File courriel, remboursements, registres selon leurs contrats.
- **Travail** : pour toute issue `uncertain`, afficher cible, historique, requête existante, vérification permise et absence d'option de renvoi sauvage.
- **Acceptation** : tests où timeout puis retour serveur tardif n'entraîne aucun doublon d'envoi/remboursement.

## Lot 2 — Shell, navigation et surfaces communes

### OUX-007 — Clarifier les quatre modes administratifs

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Propriétaire** : `AdminLayout`, entêtes de Cockpit/À traiter/Pilotage/Assistant.
- **Travail** : sous-titres `Observer / Prioriser / Décider / Préparer`, libellés précis, liens propriétaires ; ne pas fusionner les moteurs.
- **Acceptation** : utilisateur situe sans ambiguïté où voir l'état, traiter une alerte, décider ou préparer ; test de parcours et retour.

### OUX-008 — Normaliser les panneaux, le focus et la hiérarchie des couches

- **Priorité / effort** : P1 / L ; **état** : proposition.
- **Propriétaire** : primitives partagées tiroir/confirmation/inspecteur/modération, Guide, manette.
- **Travail** : contrat de z-index/focus, `Escape`, retour de focus, opérations verrouillantes, défilement et footer sticky ; test 1536×864 CSS et 390 px.
- **Acceptation** : aucune commande sensible recouverte ; une confirmation ne se ferme pas en déclenchant l'action sous-jacente.

## Lot 3 — Dossier de commandite V2

### OUX-009 — En-tête compact et bouton Modération éditoriale

- **Priorité / effort** : P1 / M ; **état** : préférence confirmée par conversation + point d'entrée documenté dans le blueprint général.
- **Propriétaires** : page commandites, `AdminSponsorshipHeader`, panneau transversal de modération.
- **Travail** : statuts indépendants, montant/devise, actions prioritaires ; **bouton visible dans l'en-tête** pour les rôles habilités, ouvrant l'outil existant pour `sponsorship` et version exacts ; secondaires dans `Plus` au besoin.
- **Acceptation** : revues commanditaire et modération jamais fusionnées ; retour au même onglet après fermeture ; pas de second composant de décision.

### OUX-010 — Prochaine action unifiée et blocages navigables

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Propriétaire** : `AdminSponsorshipNextStep`, progression existante.
- **Travail** : une carte primaire sur Aperçu ; maximum trois familles de blocages ; raisons et propriétaires factuels ; `Tout voir`.
- **Acceptation** : pas de double recommandation, pas de calcul local d'admissibilité, aucun CTA résumé n'exécute une mutation.

### OUX-011 — Identité et médias : scission interne sans nouvelle route

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Propriétaire** : onglet `identity`, `MediaReviewWorkspace` et éditeurs existants.
- **Travail** : sections identité/soumission et revue des médias ; `tab=media` ouvre/focalise la galerie ; droits, analyse, préférences, manifeste versionné inchangés.
- **Acceptation** : cinq onglets, alias `media`/`refund`, lecture du manifeste exacte, rétablissement focus.

## Lot 4 — Prestations et publications

### OUX-012 — Clarifier la chaîne de publication sans nouvelle console

- **Priorité / effort** : P1 / L ; **état** : proposition.
- **Propriétaires** : dossier Publication, Campagnes, brouillons, lots, calendrier, Automatisation, tiroir partagé.
- **Travail** : lien guidé `offre → préparation → contenu → autorisation → livraison → preuve` ; pas de duplication des états de prestation ou du tiroir.
- **Acceptation** : publication Web, publication sociale et preuve restent indépendantes ; aucun canal non promis bloquant ; liens profonds exacts.

### OUX-013 — Contrat de visibilité de la preuve et des documents

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Propriétaires** : Campagnes, annuaire public, factures, transparence.
- **Travail** : distinguer date/source/portée d'une preuve, version de l'accord, visibilité déclarée et visibilité observée, reçu/avoir/email.
- **Acceptation** : aucune carte ne présente un fait déclaré comme une preuve de livraison contractuelle.

## Lot 5 — Parcours publics et suivi

### OUX-014 — Parcours privé de commandite et récupération

- **Priorité / effort** : P1 / M ; **état** : proposition.
- **Propriétaires** : suivi privé, support.
- **Travail** : réduire la densité des formulaires et de la gestion média, conserver les étapes et l'accès par token ; distinguer brouillon, soumission, correction et recours.
- **Acceptation** : expiration/récupération, droits média et correction testés sans révélation de token ou consentement fabriqué.

### OUX-015 — Vérifier la parité FR/EN pour la commande musicale

- **Priorité / effort** : P2 / S ; **état** : à vérifier, mention du blueprint général.
- **Propriétaire** : `SiteMusicComponent` et routing public.
- **Travail** : vérifier suppression du démarrage automatique selon `/music`, `/boutique`, `/en/music`, `/en/boutique` ; corriger seulement si divergence démontrée.
- **Acceptation** : comportement attendu identique en FR/EN pour pages équivalentes.

## Lot 6 — Performance, accessibilité, contrôle de qualité

### OUX-016 — Budget initial et chargement par fonctionnalité

- **Priorité / effort** : P2 / M ; **état** : avertissement de build documenté.
- **Source** : build inventorié 898,39 ko initial vs avertissement à 800 ko.
- **Travail** : rapport de bundles, identification des modules lourds, choix de lazy-loading seulement où son coût/risque est justifié.
- **Acceptation** : mesures avant/après reproductibles ; budget respecté ou exception documentée, sans dégradation de navigation.

### OUX-017 — Campagne de réception UX et contrôles d'effets externes

- **Priorité / effort** : P0 transversal / L ; **état** : à réaliser.
- **Travail** : matrice test avec `reader/operator/owner`, paiement en attente, consentements, passage identité, droits média, préparation, modération, visibilité Web, publication, résultat incertain, remboursement, courriel, FR/EN, clavier/manette et viewport.
- **Acceptation** : tests unitaires/E2E documentés ; distinction API simulée / intégration contrôlée / live ; captures et limitations datées.

## Séquence des PR recommandée

| PR | Dépend de | Tickets | Critère de sortie |
| --- | --- | --- | --- |
| PR-UX-00 — Cartographie et divergences | — | 001, 002 | État réel validé, aucun code métier modifié |
| PR-UX-01 — Permissions, preuves et états | PR-UX-00 | 003, 004, 005, 006 | Aucun droit présenté trompeusement, aucun statut mock traité comme live |
| PR-UX-02 — Shell et focus | PR-UX-00 | 007, 008 | Parcours et superpositions utilisables en desktop/mobile/clavier |
| PR-UX-03 — Dossier de commandite V2 | PR-UX-01, PR-UX-02 | 009, 010, 011 | En-tête/bouton, blocages, identifiants, cinq onglets préservés |
| PR-UX-04 — Chaîne des prestations | PR-UX-03 | 012, 013 | Autorisations/proofs correctes et navigation contextuelle |
| PR-UX-05 — Parcours publics | PR-UX-01 | 014, 015 | Récupération, sécurité, FR/EN cohérents |
| PR-UX-06 — Validation / performance | Lots précédents | 016, 017 | Mesures et limites traçables |

**Règle :** aucun lot ne promet de publication, remboursement ou envoi réel pendant les tests sans environnement séparé, autorisation appropriée et plan de réconciliation. Le présent backlog ne crée aucune PR ni issue GitHub.
