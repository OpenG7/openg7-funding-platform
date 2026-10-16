# Administration et manette dans une sandbox locale

La sandbox ouvre une seconde installation jetable : vraie API OpenG7, PostgreSQL
privé en mémoire, Checkout Stripe simulé, courriels capturés et publications
sociales simulées. Elle ne lit pas `.env` et ne rejoint pas l'installation locale
habituelle. Ses paiements et justificatifs sont uniquement synthétiques.

## Démarrer et se connecter

Prérequis : Node.js 22 ou ultérieur, dépendances du dépôt et Docker local disponible.
Depuis la racine :

```sh
yarn sandbox:admin
```

Le lanceur construit les images, crée un projet Compose unique, applique les
migrations sur sa base neuve et affiche deux URL sur `127.0.0.1` : administration
et formulaire de contribution. Garder ce terminal ouvert.

Dans l'administration, choisir la connexion par identité, puis le compte de test
`owner` chez le fournisseur **Identité simulée**. L'API crée le propriétaire
`fixture-owner`. Le fournisseur et ses signatures sont locaux ; cela ne valide
pas un compte Keycloak personnel, un vrai mot de passe ou le MFA réel. Aucun
secret racine n'est fourni au navigateur ni inscrit dans le manifeste public.

## Créer un paiement et suivre ses actions

1. Dans l'administration, ouvrir **Manette virtuelle · Essais**, puis la rubrique
   des paiements de test **Simuler un paiement réussi**.
2. Choisir contribution personnelle ou commandite et le montant. Régler le
   consentement public, lire les conditions présentées, puis cocher la
   confirmation du scénario fictif. L'offre et la charte s'affichent lorsque
   le parcours de commandite les requiert.
3. Cliquer sur **Simuler la réussite**, puis attendre **Paiement simulé confirmé
   par l'API**. Le panneau crée un Checkout normal et confirme sa réussite chez
   le fournisseur local ; celui-ci transmet un webhook signé à l'API. Seules les
   lectures serveur permettent d'annoncer le paiement confirmé.
4. Cliquer sur **Ouvrir le parcours et les actions à tester**. Le guide affiche
   le dossier, les étapes restantes et la prochaine action. Les boutons de la
   manette virtuelle se cliquent à la souris ; les contrôles habituels de la
   page restent utilisables. Fermer le panneau permet de reprendre la manette
   physique, après retour au neutre.
5. Vérifier factures, Attention et progression après les actions. Une approbation
   ne publie pas automatiquement. Une livraison sociale simulée ne constitue pas
   une preuve de réalisation réelle et peut donc laisser des engagements ouverts.

Pour une commandite confirmée, **Jouer le commanditaire ↗** ouvre le même Checkout
dans un nouvel onglet. Il indique **Paiement simulé déjà confirmé** : cliquer
sur **Continuer vers OpenG7** pour compléter la fiche et téléverser un logo et
des photos fictifs. Revenir ensuite dans l'onglet admin pour examiner les médias
et poursuivre le guide avec la manette. Cette consultation ne crée ni nouveau
paiement ni nouveau dossier.

Une interruption conserve le même identifiant de Checkout dans cet onglet.
**Reprendre ce même paiement de test** poursuit ce dossier. **Autre scénario —
conserver le dossier précédent** démarre un nouvel essai et garde l'ancien
paiement et son historique dans la base de la sandbox.

Le formulaire public affiché par le lanceur reste une autre entrée pour essayer
la contribution depuis le début, ainsi que le refus ou l'expiration au Checkout.
Utiliser une adresse telle que `atelier@simulation.example.test` et des fichiers
synthétiques.

Aucun historique financier de recette n'est inséré au démarrage. Les migrations
et configurations initiales habituelles restent la source des réglages. Les
autres comptes synthétiques ne disposent pas de droits par défaut : un propriétaire
peut les attribuer dans **Accès et sessions**, notamment pour une décision qui
exige deux personnes distinctes.

## Vérification automatisée

```sh
yarn test:e2e:sandbox
```

Cette commande équivaut à `yarn sandbox:admin --verify` : elle prépare la même
pile sans seed financier, lance la recette navigateur avec Chromium installé,
puis nettoie la pile même si le test échoue. Elle ne reste pas en attente d'une
commande d'arrêt. La recette utilise l'origine OIDC et les vrais endpoints de
cette sandbox. Les preuves sont conservées sous `test-results/admin-sandbox/` ;
le manifeste public et les réponses API ne sont pas remplacés par des fixtures UI.

## Arrêter et limites

Appuyer sur **Ctrl+C**, ou taper `stop` puis **Entrée** dans le terminal du lanceur.
La commande fonctionne aussi lorsque son entrée standard est un pipe Windows.
Il vérifie les labels du projet puis retire uniquement ses conteneurs et réseaux.
La base et les médias de cette session disparaissent ; l'installation habituelle reste indépendante.
Ne pas utiliser la sandbox pour conserver des dossiers ou des données personnelles.

Si le nettoyage échoue, le lanceur conserve ses fichiers temporaires et signale
leur emplacement. Vérifier le projet `og7-acceptance-…` affiché au démarrage avant
toute reprise manuelle ; ne pas lancer une suppression globale Docker.

Le manifeste `/openg7-sandbox.json` annonce seulement la capacité de présentation
locale, version 1. Le proxy `/__sandbox/stripe/` rejoint uniquement le fournisseur
de cette pile. Ils ne sont pas ajoutés aux déploiements habituels. La sandbox
refuse un daemon Docker distant, utilise des ports loopback et ne configure aucun
paiement, courriel ou réseau social réel. Une manette virtuelle ou simulée ne
qualifie pas une manette USB/Bluetooth physique.
