# Modification d’un dossier commanditaire

Depuis `/admin/fundraiser/sponsors`, sélectionner le dossier puis choisir **Modifier le dossier**, sous son en-tête. Le formulaire est accessible depuis chaque onglet, en français et en anglais, sur ordinateur et mobile.

Dans **Identité**, le bouton **Modifier l’identité et les coordonnées** ouvre le même formulaire. Deux états distincts expliquent ce qui manque : les coordonnées requièrent un nom d’entreprise et un courriel de contact ; la transmission nécessite que le commanditaire ait soumis son formulaire depuis son lien privé. Une correction administrative ne crée pas cette transmission. Le propriétaire peut rejoindre le contrôle **Renvoyer le lien de suivi** depuis cette section ; les autres rôles voient qui contacter. Rejoindre ce contrôle n’envoie rien : le renvoi conserve sa confirmation du destinataire.

L’encadré **Coordonnées et transmission : deux actions distinctes** explique la différence entre une saisie administrative (par exemple après un appel) et la transmission datée du commanditaire qui soumet le dossier à la revue. Tant que cette transmission manque, l’onglet Identité et le formulaire de correction précisent que remplir tous les champs ne permet pas de valider cette étape à sa place. La progression et le guide rappellent cette règle. Les libellés ne présument pas que les coordonnées actuellement affichées ont été saisies par un administrateur.

La progression expose `identity_missing` / `blocked` lorsque le nom ou le courriel manque, `identity_submission_pending` / `pending` lorsque seules les informations transmises sont attendues, et `identity_complete` / `complete` lorsque les deux conditions sont satisfaites. Le nouveau motif s’applique au jalon et à la prochaine étape du dossier/cockpit. Le format de la réponse est conservé ; déployer les traductions Web avant ou avec l’API qui émet ce motif. Les dossiers existants ne sont pas marqués comme transmis automatiquement.

Les cinq champs sont préremplis avec les informations du dossier sélectionné dès l’ouverture du formulaire. Un champ non renseigné reste vide. Après une annulation, rouvrir le formulaire reprend les informations enregistrées ; le brouillon annulé n’est pas conservé.

Champs corrigibles : entreprise (obligatoire, 200 caractères), nom public (100 caractères), contact et courriel (200 caractères), site web (URL HTTP/HTTPS sans identifiants, 2 048 caractères). Les champs facultatifs peuvent être effacés. Choisir un motif : correction d’une erreur, mise à jour du contact ou de l’entreprise, puis enregistrer et confirmer le récapitulatif. Annuler ne sauvegarde rien et restaure le focus.

La correction conserve le paiement, la devise, les montants, les identifiants Stripe, les factures et notes de crédit déjà émises, le courriel original du paiement, les consentements, la revue et les statuts de publication. Le courriel du contact corrigé sert aux prochains messages qui ciblent ce contact ; les messages déjà en file et les snapshots de facturation ne sont pas réécrits. Le nom et le site d’un dossier déjà admissible au répertoire public peuvent changer après cette confirmation administrative.

Un échec conserve les saisies. Une relance identique réutilise l’identifiant de la demande. Un conflit signale que le dossier a changé : fermer le formulaire et utiliser **Actualiser le dossier** avant de reprendre la correction. Un refus d’accès efface le brouillon ; une session expirée revient à la connexion.

## Contrat et garanties

`POST /api/admin/sponsorships/details` (alias `/admin/sponsorships/details`) exige une session administrative autorisée, PostgreSQL et un corps JSON limité à 16 Kio. En mode OIDC, les opérateurs et propriétaires peuvent corriger ; les lecteurs sont refusés. La vérification d’origine des mutations OIDC existante s’applique.

Le corps contient `contributionId`, `expectedVersion`, `requestId` (UUID), `confirmed: true`, `reason` (`correction`, `contact_update`, `organization_update`) et les cinq champs `companyName`, `publicName`, `contactName`, `contactEmail`, `websiteUrl`. Les propriétés inconnues sont refusées. Les coordonnées sont normalisées et validées côté API ; aucune donnée financière n’est acceptée dans ce contrat.

Le dossier est verrouillé pendant une transaction. La version est vérifiée avant correction ; la modification et l’audit `sponsorship.details.update` sont atomiques. L’audit conserve l’acteur, la cible, la date, les noms des champs modifiés, le motif, l’identifiant de demande, son empreinte et le résultat. Les anciennes et nouvelles coordonnées ne sont pas copiées dans l’audit. Le dossier présente un libellé traduit dans son historique.

Une demande identique déjà appliquée retourne son résultat enregistré, sans second audit. Réutiliser son identifiant avec un autre contenu produit un conflit. Une soumission sans changement ne modifie ni version ni audit. Réponses : 200 (`updated`, `version`), 400 (entrée invalide), 401/403 (accès), 404 (dossier absent), 409 (conflit), 405 (méthode), 415 (type de contenu), 503 (stockage indisponible ou échec). Les réponses sont privées et non mises en cache.

Aucune nouvelle migration ni opération sur les données existantes n’est nécessaire. Les tables `fund_contributions` et `admin_audit_log` doivent déjà être migrées. La validation commune appartient à `funding-core`. L’API utilise son chemin relatif de module pour respecter la compilation actuelle sous `dist/packages/funding-core/src` ; les alias TypeScript du dépôt ne réécrivent pas les imports Node à l’exécution. L’image Docker API inclut désormais ce package compilé pour rendre la validation disponible à l’exécution.

## Vérification locale

- `yarn build` puis `node --test tests/admin-sponsorship-details.test.mjs` : validation et autorisations.
- `node --test tests/integration/admin-sponsorship-details.integration.mjs` : PostgreSQL jetable local et API réelle, atomicité, relances, conflits, audit et conservation des données financières. Aucun `.env` ni fournisseur réel utilisé.
- `yarn test:ui:admin` : tests navigateur du formulaire dans `admin-sponsorship-progress.spec.ts`, avec des données synthétiques.
