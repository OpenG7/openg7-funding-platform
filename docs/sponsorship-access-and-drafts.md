# Reprise du suivi commanditaire sans compte

## Parcours livrés

1. **Retrouver son accès** : la page de suivi sans lien valide et la page Support proposent de demander un nouveau lien privé avec le courriel utilisé au paiement. La réponse publique reste identique pour une adresse connue ou inconnue. Une adresse de contact saisie dans le formulaire ou le brouillon ne permet pas de récupérer l'accès.
2. **Renvoi administratif** : le dossier commanditaire propose « Renvoyer le lien de suivi ». La confirmation affiche l'adresse du paiement relue côté serveur. Le renvoi crée un message dans la file et une trace d'audit. Il peut remplacer un courriel déjà envoyé ; le statut affiché distingue mise en file, envoi précédent et échec de livraison.
3. **Brouillon automatique** : les six champs du formulaire sont sauvegardés sur le serveur après deux secondes sans saisie, même incomplets. Un retour avec un lien valide retrouve le même brouillon, y compris sur un autre appareil. Le statut « Brouillon enregistré » confirme la réponse du serveur.
4. **Soumission explicite** : « Enregistrer les informations » valide les champs et soumet les modifications à la revue. La sauvegarde automatique ne change ni la fiche soumise, ni la revue, ni la publication, ni les faits de paiement. Abandonner les modifications efface le brouillon après confirmation du serveur.

Les médias conservent leur parcours indépendant : téléversement et suppression ont leurs propres confirmations. Abandonner le brouillon texte ne supprime pas les fichiers téléversés.

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

## Description de commit

```text
feat(sponsorship): permettre la reprise du suivi et sauvegarder les brouillons

- Récupérer un lien privé via le courriel du paiement, sans compte utilisateur.
- Ajouter le renvoi admin confirmé, idempotent et audité dans la file de courriels.
- Sauvegarder les brouillons côté serveur avec révisions et gestion des conflits.
- Séparer le brouillon de la soumission et préserver les faits de paiement.
- Ajouter la migration 019, les textes FR/EN et les tests de reprise.
```
