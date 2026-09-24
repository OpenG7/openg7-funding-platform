# Reprise du suivi commanditaire sans compte

## Parcours livrés

1. **Retrouver son accès** : la page de suivi sans lien valide et la page Support proposent de demander un nouveau lien privé avec le courriel utilisé au paiement. La réponse publique reste identique pour une adresse connue ou inconnue. Une adresse de contact saisie dans le formulaire ou le brouillon ne permet pas de récupérer l'accès.
2. **Renvoi administratif** : le dossier commanditaire propose « Renvoyer le lien de suivi ». La confirmation affiche l'adresse du paiement relue côté serveur. Le renvoi crée un message dans la file et une trace d'audit. Il peut remplacer un courriel déjà envoyé ; le statut affiché distingue mise en file, envoi précédent et échec de livraison.
3. **Brouillon automatique** : les six champs du formulaire sont sauvegardés sur le serveur après deux secondes sans saisie, même incomplets. Un retour avec un lien valide retrouve le même brouillon, y compris sur un autre appareil. Le statut « Brouillon enregistré » confirme la réponse du serveur.
4. **Soumission explicite** : « Soumettre mes informations à l’équipe » valide les champs et soumet les modifications à la revue. La sauvegarde automatique ne change ni la fiche soumise, ni la revue, ni la publication, ni les faits de paiement. Abandonner les modifications efface le brouillon après confirmation du serveur.

Les médias conservent leur parcours indépendant : téléversement et suppression ont leurs propres confirmations. Abandonner le brouillon texte ne supprime pas les fichiers téléversés.

Un média approuvé reste verrouillé pour l'entreprise : son retrait exige une
confirmation administrative. Pour remplacer un logo approuvé, l'admin retire
l'ancien fichier, puis l'entreprise téléverse le nouveau dans son suivi ; ce
fichier reste privé et remet le dossier en revue. La suppression ne sélectionne
jamais automatiquement une autre image pour les publications programmées. Le
[moteur de publication](operations/publication-automation.md#authorization-and-concurrency)
bloque les envois liés au visuel retiré ; chaque contenu révisé exige une nouvelle
autorisation. Le paiement et les factures restent indépendants de ces décisions.

Après modification d'une fiche approuvée, la soumission remet le dossier en revue.
Le moteur bloque les anciens envois autorisés avant leur échéance, y compris si
le dossier a déjà été réapprouvé entre-temps. L'admin doit examiner le nouveau
contenu, enregistrer la publication et autoriser à nouveau son envoi. Le brouillon
automatique seul conserve la fiche approuvée et ses autorisations. Le paiement et
la facture émise restent inchangés. Voir le [contrat du moteur](operations/publication-automation.md#authorization-and-concurrency)
et la [recette de révision](sponsorship-e2e-coverage.md#recette-navigateur--révision-dun-dossier-approuvé).

## Contrats et garanties

| Route                                                          | Accès et comportement                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sponsorship-followup/recover`                       | `{ email, locale }`. Courriel valide : `202 { accepted: true }`, même sans dossier ou si la mise en file échoue. Courriel invalide : `400`. Base indisponible/configuration absente : `503` lorsque détectée avant la recherche ; limitation IP : `429`. Aucun dossier, destinataire ou jeton retourné. |
| `GET /api/admin/sponsorships/followup-access?contributionId=…` | Session admin requise côté API. Adresse admissible du paiement ou `null`.                                                                                                                                                                                                                               |
| `POST /api/admin/sponsorships/followup-access`                 | Session admin, UUID de dossier, `recipient`, UUID `requestId`, `confirmed: true`, `locale`. L'adresse doit encore correspondre au paiement. Aucun lien privé retourné à l'interface admin.                                                                                                              |
| `GET /api/sponsorship-followup/draft?token=…`                  | Jeton valide. Réponse `{ revision, data, updatedAt }` privée et non mise en cache.                                                                                                                                                                                                                      |
| `POST /api/sponsorship-followup/draft`                         | `{ token, expectedRevision, data }`. Champs texte bornés ou `data: null` pour abandonner. Dossier admissible à l'édition requis. Conflit : `409`, sans écrasement.                                                                                                                                      |
| `POST /api/sponsorship-followup/details`                       | Contrat existant avec `draftRevision` optionnel. Le nouveau front l'envoie toujours. Un ancien client sans révision peut soumettre seulement en l'absence de brouillon actif, ou répéter une soumission déjà confirmée sans effet.                                                                      |

Les liens de reprise contiennent un jeton aléatoire de 256 bits. La table d'accès conserve son SHA-256 ; le jeton complet figure uniquement dans le corps du courriel nécessaire à sa livraison. Il n'est pas ajouté aux métadonnées ni aux audits. Le navigateur retire le jeton de l'URL après lecture et le conserve en mémoire/session comme auparavant.

L'expiration reprend `FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS` (30 jours par défaut). Un nouveau lien n'invalide pas les liens encore valides : une demande publique ne peut donc pas fermer la session d'un commanditaire. Un lien expiré ne donne accès ni au dossier ni au brouillon. Le brouillon appartient au dossier, pas au navigateur ni au lien.

La récupération cible les contributions de type commandite avec paiement `paid`, `refunded` ou `disputed`, à l'adresse `email_private`. Un dossier refusé reste consultable sans autoriser son édition. La demande publique est bornée aux 20 dossiers les plus récents de l'adresse, avec regroupement pendant dix minutes par dossier. Les demandes admin sont regroupées pendant une minute ; le même `requestId` reste idempotent. Les limiteurs IP existants s'appliquent également.

La création du jeton, du message et de l'audit est transactionnelle. Aucun appel au fournisseur de courriel n'a lieu dans cette transaction. Le worker existant assure la livraison et ses reprises. Une erreur de file ne laisse pas un nouveau jeton orphelin.

Les écritures de brouillon sont sérialisées dans le navigateur et verrouillées par dossier côté PostgreSQL. Une révision protège contre les écrasements entre onglets. Répéter une écriture identique après perte de réponse est sans effet supplémentaire. La soumission ou l'abandon conserve une révision vide afin qu'un ancien onglet ne puisse recréer silencieusement un brouillon périmé. Répéter une soumission confirmée ne relance pas la revue et ne supprime pas un brouillon ultérieur.

## Limites visibles

- Les dernières secondes non encore confirmées peuvent être perdues si le navigateur ferme ou plante. Aucune promesse de sauvegarde hors ligne : une erreur conserve la saisie dans la page et propose une reprise.
- En cas de conflit, la saisie locale reste affichée. « Charger le brouillon sauvegardé » remplace explicitement cette saisie par la version serveur ; il n'y a pas de fusion automatique.
- Il faut pouvoir recevoir les courriels de l'adresse du paiement. Le renvoi ne permet pas à l'admin de changer silencieusement cette adresse.
- La mise en file n'est pas une preuve de livraison. Un échec reste consultable et relançable dans la file administrative.
- Les jetons expirés et les brouillons ne sont pas purgés automatiquement par ce lot. Leur conservation suit celle du dossier et des sauvegardes ; toute politique de purge devra préserver les révisions nécessaires aux liens encore valides.

## Migration et exploitation

Changement de risque modéré, migration additive `019_create_sponsorship_access_and_drafts.sql`. Elle crée `sponsorship_access_tokens` et `sponsorship_followup_drafts`, sans réécrire les contributions existantes. Les dossiers sans brouillon commencent à la révision zéro.

Appliquer la migration avant de démarrer la nouvelle API ; les anciennes tables et les anciens liens restent compatibles. PostgreSQL et le worker de courriels existant sont nécessaires. Aucun nouveau secret ou paramètre d'environnement n'est requis. Aucun déploiement, envoi réel, migration de production ou backfill n'est exécuté dans ce lot.

## Vérifications

- `yarn test` : contrats, validation des brouillons incomplets et contrôles historiques.
- `yarn test:integration:payments` : PostgreSQL jetable, migration sur un dossier existant, concurrence, idempotence, expiration, destinataire autoritaire, renvoi d'un message déjà envoyé et rollback de la file.
- `yarn test:ui:followup` : restauration après rechargement, saisie pendant une sauvegarde lente, erreur/reprise, abandon, conflit, récupération FR/EN et non-régression du suivi.
- `yarn test:e2e:acceptance tests/playwright/sponsorship-access.spec.ts tests/playwright/sponsor-navigation.spec.ts` : vraie API, base et navigateur dans une pile Docker isolée. Vérifie la persistance, l'autorisation admin, la confirmation du destinataire, la file, l'audit et les parcours existants. SMTP est désactivé ; aucun courriel réel n'est envoyé.

Les nouvelles suites sont découvertes par les étapes PostgreSQL, suivi UI et Docker des workflows existants. Les résultats locaux finaux sont rapportés avec le changement ; les intégrations externes réelles et les workflows distants doivent encore être vérifiés lors de leur exécution.

Résultats locaux du 18 septembre 2026 sous Node 22 :

- 232 tests Node réussis.
- 24 tests d'intégration PostgreSQL réussis ; le scénario d'accès a également été rejoué après l'ajout des assertions de renvoi et de récupération publique.
- 32 tests de suivi dans le navigateur réussis, dont le rejet d'une réponse tardive après expiration de l'accès ; build Angular et 22 routes pré-rendues.
- 10 scénarios Docker ciblés réussis, sans test ignoré ni retry. La pile jetable a été supprimée par le runner.
- TypeScript complet et lint sans erreur ; un avertissement préexistant dans `scripts/smoke-public.mjs`.
- Format des nouveaux fichiers et `git diff --check` conformes. Le contrôle de format global signale toujours 335 fichiers comportant des écarts préexistants ; les changements de format sans rapport ont été retirés du diff.

La suite Docker complète et les workflows GitHub n'ont pas été exécutés pour ce lot. La livraison par un fournisseur de courriel réel reste à vérifier dans l'environnement prévu.

<a id="recette-complete-courriel-en-echec-et-reprise-du-dossier"></a>

## Recette complète : courriel en échec et reprise du dossier

`tests/playwright/sponsorship-email-recovery-acceptance.spec.ts` relie les
scénarios 12, 15, 16 et 54 de l’[inventaire](development/end-to-end-scenarios-inventory.md).
Le navigateur, PostgreSQL, l’API, le worker et le transport SMTP sont réels ;
Stripe est simulé et Mailpit capture les courriels dans la pile jetable.
Aucune requête applicative n’est interceptée et la recette ne modifie pas la base.

```sh
yarn test:e2e:acceptance sponsorship-email-recovery-acceptance.spec.ts --project=chromium
```

1. Une entreprise contribue 500 CAD via le formulaire et Checkout simulé, puis
   sauvegarde un brouillon incomplet et ferme le navigateur. Le Checkout de test
   utilise une adresse unique sous `simulation.example.test`, distincte du
   contact du brouillon et des autres recettes.
2. Depuis un lien invalide, elle demande un nouvel accès. Adresse inconnue,
   adresse de contact du brouillon et adresse du paiement reçoivent la même
   réponse publique. Seule cette dernière crée le courriel et l’accès privé.
3. La passerelle de test refuse la connexion avant la salutation SMTP. L’admin
   constate l’échec, peut annuler une relance sans effet, et retrouve le même
   message lors d’un renvoi administratif dans la fenêtre de regroupement.
4. La recette redémarre uniquement l’API du projet Docker isolé vérifié. Le
   message et sa prochaine tentative persistent. Le worker reprend à l’échéance
   réelle d’une minute ; un second refus SMTP confirme son fonctionnement.
5. Après confirmation administrative, une connexion retenue par la passerelle
   permet de lancer deux relances concurrentes. Elles n’effectuent aucun envoi.
   La libération de la connexion donne un seul courriel accepté par Mailpit,
   trois tentatives au total et un succès audité. Un renvoi du message déjà
   envoyé est refusé et une requête non authentifiée reste interdite.
6. Le lien extrait du courriel capturé ouvre un nouveau navigateur mobile. Le
   brouillon serveur est restauré, le jeton disparaît de l’URL, puis l’entreprise
   complète et soumet ses informations. Le dossier arrive en revue sans nouvelle
   décision de paiement, d’approbation ou de publication.

Captures et preuve JSON, sans jeton de suivi dans la preuve, sont enregistrées
dans `test-results/acceptance/`. Les contrôles SMTP reviennent à leur état normal
en fin de recette. Les tests UI complémentaires vérifient FR/EN, mobile/ordinateur,
clavier, confirmation, envoi concurrent, erreur, succès et accessibilité.

Cette recette qualifie Chromium, les erreurs connues avant acceptation SMTP et
la conservation du brouillon après un redémarrage sans envoi actif. Mailpit ne
prouve pas la délivrabilité d’une boîte réelle. L’expiration du jeton et les
conflits de brouillon restent couverts par les suites d’intégration et de suivi
existantes ; ils ne sont pas provoqués par une modification directe des données
dans ce parcours navigateur. Voir les [limites de reprise SMTP](email-smtp.md#failed-messages-and-concurrent-retries).

Exécution du 23 septembre 2026 sur `490084d` avec les changements locaux :
**recette réussie en 1,3 minute**, sans reprise ni test ignoré. Les deux scénarios
de contribution de 50 CAD passent dans la même pile (trois tests en 1,7 minute).
Les contrôles complémentaires passent : 294 tests Node, deux intégrations
PostgreSQL (dont SMTP réel vers Mailpit et concurrence), quatre tests UI FR/EN
sur mobile/ordinateur avec restitution du focus et accessibilité, TypeScript,
lint, builds API/Web et images Docker, contrôles documentaires et `git diff --check`.
Les avertissements préexistants de lint et de budget du bundle Web subsistent.
Le format ciblé passe ; les écarts préexistants hors du raccordement dans
`tests/stripe-stub/server.mjs` sont conservés. La pile jetable a été supprimée.

## Recette de conflits entre deux onglets

La recette [sponsorship-draft-conflict-acceptance.spec.ts](../tests/playwright/sponsorship-draft-conflict-acceptance.spec.ts)
couvre les scénarios 13 et 14 de l'inventaire dans deux onglets Chromium
avec leurs états locaux distincts, dont un au format mobile. Elle part d'un dossier synthétique déjà payé et
approuvé. Une sauvegarde concurrente provoque un conflit sans effacer la saisie
locale. Le chargement explicite permet de reprendre, puis une tentative d'abandon
obsolète ne peut pas supprimer la nouvelle révision. L'abandon confirmé par le
serveur revient aux informations soumises et avance la révision du brouillon.

Une sauvegarde et une soumission anciennes ne peuvent pas recréer le brouillon
abandonné. Après rechargement explicite, seule une nouvelle soumission remet le
dossier en revue, avec un seul audit et sans effet sur les montants. Ce parcours
ne qualifie pas une coupure hors ligne prolongée ni la fusion automatique de champs.

```sh
node scripts/admin-acceptance.mjs sponsorship-draft-conflict-acceptance.spec.ts --project=chromium
```

## Description de commit historique

```text
feat(sponsorship): permettre la reprise du suivi et sauvegarder les brouillons

- Récupérer un lien privé via le courriel du paiement, sans compte utilisateur.
- Ajouter le renvoi admin confirmé, idempotent et audité dans la file de courriels.
- Sauvegarder les brouillons côté serveur avec révisions et gestion des conflits.
- Séparer le brouillon de la soumission et préserver les faits de paiement.
- Ajouter la migration 019, les textes FR/EN et les tests de reprise.
```
