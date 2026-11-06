# Sessions de travail de l’atelier Preflight

La session de travail conserve la progression personnelle d’une administratrice
dans [l’atelier d’examen](preflight-examination.md). Elle reste distincte de sa
session d’authentification et du cycle de vie des prestations. Funding possède
les brouillons, les décisions humaines, les autorisations et les preuves.

La maquette guide les panneaux bleus, les trois colonnes et les niveaux
d’action. L’en-tête et la navigation Funding existants sont conservés; cette
livraison ne remplace pas l’identité visuelle globale de l’administration.
Les aperçus utilisent les contenus réels disponibles, sans rendu ni provenance
IA inventés pour reproduire l’illustration.

## Audit des mécanismes réutilisés

| Besoin                     | Mécanisme propriétaire et évolution retenue                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sélection et navigation    | Atelier existant, identifiants contribution/obligation et filtres du comptoir dans l’URL                                                                        |
| Décisions humaines         | Décisions versionnées de la migration064, confirmation et audit existants; aucun deuxième service d’approbation                                                 |
| Brouillon social           | Propriétaire `sponsor_publication_drafts`, avec contrôle de version avant sauvegarde depuis l’atelier                                                           |
| Contenu Web                | Projection générée `contribution_activity.snapshot.cartouche`; aucune écriture de présentation publique par le bouton de sauvegarde de session                  |
| Continuité personnelle     | Persistance de références, position, filtres, reports et saisies d’examen; conventions d’acteur, révision et commandes idempotentes du portefeuille automatique |
| Planification et livraison | Liens vers les workflows propriétaires existants; aucun ordonnanceur supplémentaire                                                                             |
| Authentification           | Identité OIDC stable et autorisation serveur existantes; la session de travail peut survivre à une reconnexion                                                  |

Le portefeuille automatique possède déjà sa propre persistance, mais son avance
prépare des brouillons. L’atelier réutilise ses conventions et ne détourne ni
ses tables ni son exécution pour une simple navigation.

## Propriété et persistance

La migration `065_admin_preflight_work_sessions.sql` et le rafraîchissement des
grants sont requis. Les tables de session et d’éléments autorisent la progression
mais protègent leurs identités; le journal des commandes est immuable.

Le contexte est privé à l’acteur authentifié. Un compte OIDC retrouve ses repères
après reconnexion avec une nouvelle session d’authentification. Le mode token
local conserve son identité partagée; il ne fournit pas d’isolation entre les
personnes utilisant ce même accès.

Les contrats publics sont dans
`packages/funding-core/src/admin-preflight-work-sessions.ts` :

- `GET /api/admin/preflight/work-sessions` retrouve le contexte courant et les
  sessions récentes; `sessionId` sélectionne une session privée précise et
  `requestId` permet de vérifier l’application d’une commande incertaine.
- `POST /api/admin/preflight/work-sessions` démarre le contexte depuis une
  contribution et une obligation réelles, avec un identifiant de requête.
- `POST /api/admin/preflight/work-sessions/:id/commands` enregistre une visite,
  un report, un checkpoint, une pause, un arrêt ou une reprise; il exige la
  révision attendue.
- `POST /api/admin/sponsorships/preparation/service/save-draft` sauvegarde le
  brouillon social existant avec la version attendue du reçu. Lorsqu’une session
  est attachée, sauvegarde, progression et audit partagent la transaction.

Les mutations sont réservées aux opérateurs et propriétaires. L’API dérive
l’acteur de la session authentifiée et vérifie l’origine; les entrées ne peuvent
pas sélectionner un autre acteur. Les réponses sont `private, no-store`.

Le serveur conserve les références exactes des prestations, leur version
observée, le contexte de recherche et de filtre, la dernière position, les
reports explicites et les saisies personnelles d’examen. Les contenus métier
existants restent chez leur propriétaire; une référence de brouillon n’est pas
une deuxième copie de ce brouillon.

Le manifeste est borné à 100 prestations. Ouvrir un autre dossier ajoute ses
prestations à la session active sans supprimer les précédentes; les boutons
précédent/suivant restent dans le dossier et les filtres courants. Les dix
sessions récentes sont proposées. Après une fin, reprendre l’ancienne session ou
en démarrer une nouvelle sont deux actions explicites.

Chaque modification de contexte exige une révision attendue et un identifiant
de commande. Deux onglets ou appareils ne peuvent pas écraser silencieusement
la même révision. Une commande répétée avec les mêmes entrées retrouve son
résultat; réutiliser sa clé pour un autre contenu produit un conflit.

Les réponses perdues ou les délais dépassés ne prouvent pas un échec de
mutation. L’interface conserve la référence de l’opération et rapproche l’état
serveur avant de présenter une réussite ou de permettre une nouvelle décision.
Les lectures relisent les faits Funding et rendent visibles les versions
devenues obsolètes. Les données privées sont purgées lors d’un refus d’accès
ou d’un changement d’identité.

## Sauvegarder, poursuivre et terminer

La sauvegarde de contenu social utilise le brouillon privé existant. Elle ne
vaut aucune approbation et ne confirme son succès qu’après réponse positive du
serveur. Un conflit de version conserve la saisie affichée pour permettre sa
réconciliation; il n’autorise pas un écrasement du nouveau contenu.

Un reçu de commande confirmé reste une preuve de sauvegarde même si un autre
onglet a ensuite changé le brouillon. L’atelier lève l’incertitude, montre le
contenu serveur actuel et conserve la saisie locale comme obsolète, sans permettre
de l’écraser silencieusement. Si le workflow métier interdit désormais l’édition,
la saisie reste consultable et copiable en lecture seule jusqu’à son abandon.

Le Web ne possède actuellement aucun éditeur privé libre de sa projection
générée. L’atelier y conserve les repères et la justification en cours; son
éditeur propriétaire reste accessible séparément. Le formulaire de présentation
publique n’est pas employé comme sauvegarde privée « pour plus tard ».

Passer reporte personnellement une prestation et la conserve dans les éléments
à reprendre. Suivant reste dans le périmètre de navigation courant. Les sorties
avec saisie non enregistrée proposent enregistrer, abandonner explicitement ou
rester; le retour navigateur et le rechargement doivent conserver cette
protection. Une fin de parcours est explicite.

Terminer ouvre un bilan. Continuer referme ce bilan. Enregistrer et terminer
attend les sauvegardes admissibles puis conserve un point de reprise serveur.
Terminer en abandonnant la saisie non enregistrée exige une confirmation; cela
n’efface aucune décision ni sauvegarde déjà confirmée. Une session arrêtée reste
reprenable explicitement depuis Preflight. Son état personnel ne signifie pas
que ses prestations sont achevées.

Planifier ouvre le parcours de livraison autorisé par Funding. Consulter les
preuves distingue contrôles et décisions de préparation des confirmations de
livraison. Aucune commande de session ne publie, n’approuve une prestation
voisine ou n’annule un engagement.

## Périmètre du bilan

Les approbations et demandes de correction proviennent de décisions réellement
enregistrées pour l’acteur et les prestations de la session, dans son intervalle
d’activité. Les reports et éléments sauvegardés pour reprise proviennent de la
progression personnelle persistée. Le stock « À livrer » est relu dans les faits
Funding courants du périmètre concerné.

Une reprise prolonge l’activité de la même session depuis son premier démarrage.
Une ancienne approbation reste comptée dans cette activité après une modification
de contenu; elle ne qualifie plus le nouveau contenu. Celui-ci peut alors revenir
dans « À reprendre ». Les lectures et réponses de mutation utilisent chacune un
snapshot PostgreSQL cohérent pour éviter de mélanger versions et stock.

Ces compteurs ne constituent pas des catégories disjointes. Ils ne sont pas
additionnés pour annoncer un nombre de prestations terminées. Les situations
obsolètes, indisponibles ou incertaines restent identifiables dans le bilan.
Une approbation de préparation ne constitue jamais une preuve de livraison.

## Préparer le travail pendant une absence

Finir une session n’envoie aucune mission et ne démarre aucune préparation.
Les capacités de [raccordement et préparation en lot](preflight-workspace.md)
conservent leurs préconditions, permissions et limites. L’adoption des contenus
externes exige toujours un rattachement vérifié à la prestation et à sa version.

## Livraison et validation

Les migrations et les droits sont préparés selon le
[runbook propriétaire](../operations/database-migrations.md). Les migrations
appliquées restent immuables. Les recettes utilisent uniquement des bases et
des données synthétiques isolées, sans modifier la pile métier existante.

Le code ne met pas à jour automatiquement l’API Docker existante. L’activation
nécessite les migrations jusqu’à 065, les grants du runner à jour, puis le
rebuild/redémarrage de l’API et le chargement du nouveau Web. Aucun nouveau secret,
seed ou worker n’est requis. Une activation en production reste une opération
séparément autorisée.

Contrôles exécutés le 5 novembre 2026 selon la
[matrice de validation](../development/validation.md) :

| Contrôle                            | Résultat                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn test`                         | 7 625 réussis, aucun échec, 8 ignorés parmi 7 633; ces derniers concernent l’outillage et les contraintes de cet hôte Windows                                                         |
| Build Angular production            | Réussi, avec 25 routes prérendues                                                                                                                                                     |
| Compilation typée UI et `yarn lint` | Réussies; un avertissement préexistant de directive ESLint inutile dans `scripts/smoke-public.mjs`                                                                                    |
| Playwright atelier                  | 43 réussis : 26 cas d’examen, dont deux cas FR/EN d’explication des approbations désactivées, et 17 cas de continuité; prérequis dépliables au clavier et captures compactes vérifiés |
| Playwright voisinage                | 49 réussis : comptoir 21, recette 13, propositions 12, workspace 3                                                                                                                    |
| PostgreSQL réel jetable             | 7 réussis, aucun ignoré; rôle runtime, HTTP, transactions et journal immuable                                                                                                         |
| Client d’identité                   | 4 réussis, également inclus dans la suite Node; réponses 401 tardives après changement d’identité, de session ou de rôle                                                              |
| Format, documentation et diff       | Prettier ciblé, `yarn docs:check` et `git diff --check` réussis                                                                                                                       |

Le scénario principal enregistre un vrai brouillon social, décide sur une autre
prestation, termine, recrée le service et reprend avec le contenu conservé.
Les recettes couvrent aussi concurrence entre onglets, droits insuffisants,
versions obsolètes, réponse perdue après COMMIT, échec avant sauvegarde, double
soumission, abandon explicite, nouveau démarrage et absence de livraison implicite.
Une source modifiée après une sauvegarde confirmée conserve un buffer local
copiable et interdit son écrasement silencieux.

Playwright utilise le Web compilé et des API interceptées synthétiques. Les tests
PostgreSQL exécutent les propriétaires réels et les routes HTTP avec une identité
synthétique; ils n’emploient ni `.env` ni base métier. Cette recette ne rejoue pas
un fournisseur OIDC réel ni une publication externe.

Pour rejouer la persistance après `yarn build` :
`node --test tests/integration/admin-preflight-work-sessions.integration.mjs`.
Pour l’atelier après le build Angular :
`yarn exec playwright test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-preflight-work-sessions-ui.spec.ts tests/playwright/admin-preflight-examination-ui.spec.ts --workers=1`.
Les journaux locaux et captures vérifiées sont dans
`test-results/preflight-work-sessions-{final,i18n-final,neighbors}` et
`var/preflight-work-sessions/node-final.log`; ils ne sont pas versionnés.
