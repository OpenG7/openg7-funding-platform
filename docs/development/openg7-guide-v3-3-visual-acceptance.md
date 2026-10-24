# Réception visuelle des publications V3.3

Cette réception compare les adaptations C7–C10 au
[dossier illustré](openg7-guide-codex-v3-3/OpenG7_Dossier_Codex_Illustre.html#prompt).
Elle ne certifie ni ses 211 entrées ni toutes les capacités représentées.
Le [diagnostic](openg7-guide-v3-3-analysis.md) conserve leurs écarts et propriétaires.

## Reproduire

Depuis la racine du checkout intégrant C7–C10, avec Node 22, Yarn 4, les dépendances
installées et les binaires Playwright Chromium, Firefox et WebKit disponibles :

```sh
yarn test:ui:publication-review
yarn test:ui:publication-review:gallery
```

La première commande compile le Web en production/SSR, vérifie les types UI puis
exécute les familles ciblées sur Chromium, Firefox, WebKit et mobile WebKit. Elle
utilise le serveur Web local sur `127.0.0.1:4179` et des API interceptées ; aucun
seed, Docker financier, `.env` ou fournisseur réel n’est démarré. Le port doit être
libre. La seconde commande lit seulement les fichiers locaux. Pour limiter la
recette, ajouter par exemple `--project=chromium` à la première commande.

Ouvrir ensuite `test-results/publication-review-gallery/index.html`. Le rapport
source est `test-results/publication-review/results.json` ; le manifeste de la
galerie donne le commit déclaré au lancement, l’état du checkout, les résultats,
les captures, leurs SHA-256 et leurs métadonnées. Un checkout modifié reste signalé
comme tel ; le SHA ne qualifie pas alors ses modifications non commitées.
Ces commandes sont un protocole de reproduction, pas une preuve d’exécution.

## Matrice courte

| Critère observable                                                                                                                                  | Pack / adaptation         | Famille de recettes                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Le passage sélectionné reste identique entre contenu, autorisation administrative, résultat et preuve ; le retour conserve cette sélection.         | S01/S02/S05/S20/S23 · C10 | `publication guideposts`, `publication authorization guidepost`, dans `admin-sponsorship-progress.spec.ts`.                            |
| Un formulaire unique, l’aperçu à droite sur bureau, la version enregistrée distincte de la saisie et une seule sauvegarde.                          | S06/S06.1 · C8            | `publication content review`, `publication review layout`.                                                                             |
| L’agrandissement conserve la saisie ; réduire restitue les commandes et le focus sans créer un second éditeur.                                      | S11/S30 · C8              | `publication review layout`.                                                                                                           |
| Sauvegarde principale pendant l’édition, autorisation distincte hors édition ; « Autres actions » contextuel et Échap refermant d’abord le panneau. | S05/S06/S19/S38 · C9      | `publication context actions`.                                                                                                         |
| Fuseau explicite et erreur DST liée au champ, sans perte du texte. Un horaire inchangé conserve l’instant original.                                 | S18 · C7                  | `publication drawer reliability` ; l’instant exact exige également l’assertion du payload, invisible sur une capture seule.            |
| Simulation identifiée ; lien public réservé au résultat publié en mode réel avec URL.                                                               | S20/S21/S22 · C7          | `publication drawer reliability` ; reprise incertaine dans les recettes propriétaires séparées.                                        |
| Conflit sans faux succès ni perte de saisie, commandes d’écriture absentes pour le lecteur, abandon confirmé.                                       | S30/S31/S32 · C8/C9/C10   | `publication content review`, `publication review layout`, `publication context actions`, repères lecteur.                             |
| Actions atteignables au clavier sans débordement sur bureau, petite hauteur et mobile.                                                              | S06/S11/S30 ; R43/R45/R46 | `publication transverse acceptance`, `publication review layout` : 1536×864, 1280×520, 390×844 et espace CSS 768×432 selon la recette. |

Les familles du tiroir sont enregistrées dans
`tests/playwright/admin-publication-automation.spec.ts`. La copie de référence du
dossier C7 est couverte par `tests/admin-sponsor-list-controller.test.mjs` ; cette
suite navigateur ne prétend pas en fournir une nouvelle preuve.

## Captures et lecture du résultat

Une galerie utile montre : passage sélectionné, éditeur, aperçu agrandi, autres
actions, erreur DST, simulation sans lien, résultat réel synthétique avec lien et
confirmation d’abandon à petite hauteur. Chaque vignette est un PNG intact
cliquable. Examiner aussi les assertions : une image ne démontre ni l’absence de
mutation ni une version envoyée correctement.

Les scénarios doivent appeler
`tests/playwright/support/publication-review-capture.ts`, qui écrit et attache le
PNG nommé explicitement ainsi que son JSON de métadonnées. Exemple pour une
recette ayant explicitement configuré un lecteur et le viewport correspondant :

```ts
await capturePublicationReview(page, testInfo, 'publication-reader-fr-CA-390', {
  language: 'fr-CA',
  viewport: { width: 390, height: 844 },
  access: 'reader'
});
```

Le helper vérifie le viewport CSS rendu. L’accès absent reste inconnu ; il n’est
jamais déduit du titre. Une écriture `page.screenshot()` seule ne suffit pas :
le PNG doit être attaché à une tentative finalement réussie. La galerie exclut les
échecs, instabilités, ignorés, captures `test-failed` et captures automatiques
génériques. Elle annonce séparément tests réussis et tests illustrés, sans supposer
une image pour chaque succès. Toute métadonnée absente est signalée.

Entrée et sortie sont confinées au `test-results` du dépôt, sans suppression ni
réseau. Limites : 240 images, 8 Mio par PNG, 200 Mio copiés par exécution ; un
dépassement échoue explicitement. Les images d’anciennes générations peuvent
rester sur disque, mais seules celles du manifeste courant figurent dans la page.

Restent hors portée : accord client social versionné et pièces entrantes,
rédaction générative raccordée, catalogue historique complet avec comparaison,
restauration/export, et outils riches ou cadrage sans pipeline propriétaire.
Fournisseur réel, manette physique, Windows à 125 % et zoom réel ne sont pas
qualifiés. L’espace CSS 768×432 ne remplace pas une telle qualification.
