# CSS, Tailwind et composants Angular

Tailwind est le framework CSS retenu pour le Web. Cette référence décrit les
styles, leur inventaire et la migration progressive. Les [règles Web](../../apps/funding-web/AGENTS.md) restent propriétaires
des contrats de composants, de l'accessibilité et du rendu SSR.

## Inventaire reproductible

Depuis la racine du dépôt :

```sh
yarn workspace @openg7/funding-web css:inventory
yarn workspace @openg7/funding-web css:inventory --json
```

L'[outil](../../apps/funding-web/tools/css-inventory.mjs) lit `src/**/*.css` et les
styles littéraux des décorateurs Angular `Component`, reconnus par leurs imports.
Il utilise TypeScript pour les métadonnées et PostCSS pour le CSS, sans exécuter
les composants, écrire de fichier ou appeler le réseau. Les CSS sont comptés
une fois, même s'ils sont référencés par plusieurs composants.

Le JSON expose `totals`, `scopes`, `files`, `mappings` et `ignored` : règles,
sélecteurs, propriétés, familles de déclarations, pseudo-sélecteurs/états,
définitions de tokens, usages `var()`, `@media` et `@keyframes`. Il distingue les
déclarations écrites des directives `@apply`, compte leurs utilitaires et recense
les `@reference` et `@import`. Chaque fichier
conserve son chemin et chaque bloc sa ligne source. Les étapes des keyframes
sont des règles, mais pas des sélecteurs d'interface.

Limites : les périmètres public/admin/global sont inférés du chemin; ils ne
décrivent ni les routes ni les droits. Les familles sont une classification par
propriété, pas une décision automatique de remplacement. Les métadonnées et
styles dynamiques non évaluables figurent dans `ignored`. Les attributs HTML
`style`, bindings `[style.*]`, imports CSS et `@apply` ne sont pas développés.
L'inventaire mesure donc les sources, pas le CSS compilé, le bundle, les doublons
logiques ou la conformité d'accessibilité. Relancer la commande pour les chiffres
actuels plutôt que recopier un total qui vieillira.

## Intégration actuelle

Tailwind 4 et son plugin PostCSS sont déclarés dans le
[workspace Web](../../apps/funding-web/package.json). Sa
[configuration PostCSS](../../apps/funding-web/.postcssrc.json) active le plugin.
Angular Material et le CDK ne sont pas installés : leurs correspondances ci-dessous
sont des options à évaluer, pas des composants déjà livrés.

La [référence Tailwind](../../apps/funding-web/src/styles/tailwind.css) expose le
thème et les utilitaires avec le préfixe `tw` et `source(none)`. Elle est chargée
par `@reference` dans les feuilles locales et dans `src/styles.css` pour les
sélecteurs globaux existants. Aucun Preflight ni feuille globale de classes
utilitaires n'est émis. Cela conserve les sélecteurs existants et le chargement
différé des styles admin.

Exemple depuis `components/admin-ui/admin-confirmation.component.css` :

```css
@reference '../../../../../styles/tailwind.css';

footer {
  @apply tw:flex tw:flex-wrap tw:gap-3 tw:mt-6;
}

.target {
  @apply tw:wrap-anywhere tw:text-admin-muted;
}
```

Le chemin de `@reference` dépend du fichier. Ne pas ajouter des classes `tw:*`
dans les templates tant qu'une feuille d'utilitaires correspondante n'est pas
émise : la configuration actuelle sert à compiler les `@apply` locaux.

Les alias `@theme inline` relient par exemple `--color-admin-muted` à
`var(--admin-muted)` et `--text-admin-caption` à
`var(--admin-caption-size, 0.875rem)`. Les valeurs restent résolues sur l'élément
stylé; les thèmes et préférences typographiques existants gardent leur rôle.

## OpenG7 Premium Light — Design System v1

Le thème clair de l'administration s'inspire de la maquette Commandites : fonds
blanc perle, texte bleu marine, sélection bleu grisé clair et action principale
or doux. La référence Algolia précise le dessin géométrique des titres et la
douceur recherchée dans la lecture.
L'or foncé sert aux repères et le bleu aux liens et au focus. Les couleurs d'état
conservent leur sens. La palette publique reste indépendante.

Les fondations ont un propriétaire précis :

- [Apparence](../../apps/funding-web/src/styles/admin-appearance.css) : couleurs
  sémantiques et variantes Nuit OpenG7/Graphite. L'identifiant enregistré
  `mineral` désigne toujours le thème clair, désormais nommé Premium Light;
  aucun effacement des préférences du navigateur n'est nécessaire.
- [Typographie](../../apps/funding-web/src/styles/admin-typography.css) : règles
  communes du corps, des légendes, de la navigation, des titres et des contrôles.
  Les [valeurs](../../apps/funding-web/src/styles/admin-type-tokens.css) sont
  chargées avec le cadre admin et la connexion : Inter pour la lecture, les
  contrôles et les sous-titres; Sora pour les titres h1/h2, avec un h1 fluide de
  26 à 30 px au réglage de texte par défaut. Les tailles en rem suivent ce réglage.
- [Contrat admin](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-theme.css) :
  espacements de page, section et carte, rayons, ombres, bordure des contrôles et
  durée des interactions. La bordure des champs est plus contrastée que celle
  des cartes. La préférence de mouvement réduit ramène cette durée à zéro.
- [Alias Tailwind](../../apps/funding-web/src/styles/tailwind.css) : accès aux
  tokens par `@theme inline`, par exemple `tw:p-admin-card`,
  `tw:gap-admin-section`, `tw:gap-admin-card-gap`, `tw:font-admin-body` et
  `tw:font-admin-heading`. Changer un token ne demande
  pas de recopier une couleur ou un espacement dans chaque composant.

Les [fontes](../../apps/funding-web/src/styles/admin-fonts.css) sont deux fichiers
WOFF2 variables Latin, auto-hébergés et chargés avec les styles admin différés.
Leur [provenance et leurs empreintes](../../apps/funding-web/src/styles/fonts/SOURCES.txt)
accompagnent les licences SIL OFL 1.1. Le navigateur ne contacte pas Google Fonts;
`font-display: swap` et la pile système gardent le texte visible si une fonte
échoue. Les glyphes absents passent à Inter puis à la pile système; la couverture
FR inclut les ligatures Œ/œ et les accents combinants. Le site public conserve sa police et
ne télécharge pas ces deux fichiers lors d'une entrée directe. Les règles globales
restent limitées aux hôtes admin pour atteindre leurs pages routées; les valeurs
et les fontes sont différées pour préserver le budget du chargement initial.

Les primitives Angular existantes (boutons, formulaires, badges, cartes métriques
et confirmation) consomment ce contrat. Le cadre, le cockpit, les dossiers
commanditaires et les espaces de publication utilisent ces compositions harmonisées.
Leurs contenus, permissions, étapes et confirmations restent portés par leurs
composants métier. Les autres compositions profitent de la palette commune;
leur harmonisation détaillée reste progressive.

Le tableau de bord commence par une synthèse financière compacte, puis la file
des priorités et le dossier courant. Les tendances restent consultables avec
leurs périodes et séries; les calculs et précisions financières sont conservés.
Les célébrations, l'activité et la supervision viennent après ce travail courant.

Contributions, Factures et Dépenses commencent par une synthèse compacte, puis le
registre courant et ses contrôles. Les montants gardent leur devise et leur format.
Le rapprochement Stripe suit le registre des contributions; la création d'une
dépense occupe un rail à partir de 66 rem disponibles, puis suit la liste sur les
écrans plus étroits. Factures conserve sa sélection et son détail côte à côte à
partir de 60 rem. Les formulaires se replient selon leur propre largeur; aucune
harmonisation visuelle ne change les confirmations, les versions ou les faits
comptables.

Transparence conserve une synthèse des montants avec leurs devises, puis les
statuts et le snapshot avec sa provenance et sa date. L'audit donne priorité à la
recherche et aux références intégrales. La file de courriels regroupe ses cinq
compteurs; sa date et l'explication des envois incertains restent visibles en pied
de synthèse. Le registre garde ses détails, confirmations et rapprochements,
avec un défilement horizontal local accessible au clavier.

La vue Publications présente d'abord les prochains lots. Les accès à la rédaction,
aux lots et au calendrier occupent un rail à droite dès 60 rem de contenu disponible,
puis suivent la file en dessous. Entre 44 et 60 rem, ils occupent trois colonnes;
en dessous, ils s'empilent. Les seuils suivent aussi la taille du texte.
L'accent bleu repère le prochain lot sans
confondre son ouverture avec une autorisation de publication. Les calendriers et
les formulaires suivent la même palette et conservent les fuseaux, statuts,
confirmations et saisies non enregistrées.

Dans un dossier commanditaire, l'identité et les onglets précèdent le travail
actif. La modération, l'édition et le guide occupent un rail de suivi lorsque
le dossier dispose d'au moins 54 rem; en dessous, ce rail suit le contenu dans
l'ordre de lecture. La file reste visible à partir de 1440 px et les actions
de décision conservent leur ancrage et leurs confirmations. Les coordonnées
précèdent les explications détaillées sur la transmission du formulaire.

La densité privilégie l'espace entre les grandes sections, tout en conservant
des contrôles d'au moins 44 px dans les primitives communes. Le réglage Compact
reste propre au pilotage et ne réduit pas la typographie. Les focus clavier et
manette gardent leur contour visible; les transitions de couleur et d'ombre
n'animent pas la géométrie des zones de décision.

La recette de référence représente un écran physique de 1920 × 1080 à 125 % par
un viewport de 1536 × 864 pixels CSS. Ce viewport teste l'espace disponible;
`deviceScaleFactor` seul ne simule pas le zoom du navigateur. Les tests de texte
agrandi, mobile, thèmes sombres et contrôleur simulé complètent cette recette.
Ils ne qualifient ni l'écran Windows ni une manette Xbox physique.

## Correspondances et responsabilité

Les exemples Tailwind suivants s'utilisent dans `@apply`, avec la référence
précédente. Une correspondance CSS ne remplace pas un comportement Angular.

<!-- prettier-ignore -->
| Catégorie maison | Correspondance | Ce qui reste propriétaire |
| --- | --- | --- |
| Layout : flex, grille, alignement | `display:flex; align-items:center` → `tw:flex tw:items-center`; `min-width:0` → `tw:min-w-0` | Assemblages réutilisés dans les composants Angular; compositions métier locales. |
| Espacement et dimensions | `gap:.75rem; margin-top:1.5rem` → `tw:gap-3 tw:mt-6`; `padding:1rem` → `tw:p-4` | Valeurs spécifiques justifiées; ne pas arrondir une mesure pendant la conversion. |
| Typographie | Caption → `tw:text-admin-caption`; `white-space:pre-wrap` → `tw:whitespace-pre-wrap`; nombres tabulaires → `tw:tabular-nums` envisageable | Tokens typographiques, préférences, textes FR/EN et `clamp()` éditoriaux; poids et nombres tabulaires restent explicites dans le pilote. |
| Thèmes, surfaces et bordures | `color:var(--admin-muted)` → `tw:text-admin-muted`; `background-color:var(--admin-panel)` → `tw:bg-admin-panel` | Variables héritées, thèmes public/admin, dégradés et médias OpenG7; les raccourcis `background` restent explicites pour réinitialiser les images. |
| Contrôles et formulaires | Layout des boutons via `@apply`; Material Button/Form Field/Select si un besoin complet le justifie | API `.admin-button`, HTML sémantique, validation, erreurs et permissions. |
| États et accessibilité | Utilitaires de curseur/opacité sous les sélecteurs `:disabled`, `:hover`, `:focus-visible`; CDK A11y envisageable | Focus visible, noms accessibles, annonces, confirmation et autorisation serveur. |
| Overlays et focus | Layout Tailwind; CDK Dialog/Overlay envisageable pour les mécanismes | `<dialog>` actuel, restauration du focus, exclusions du contrôleur virtuel et contrats d'ouverture/fermeture. |
| Tableaux | `width:100%; border-collapse:collapse` → `tw:w-full tw:border-collapse`; wrapper → `tw:max-w-full tw:overflow-x-auto` | En-têtes, états, données et pagination; Material Table/Sort/Paginator seulement si retenus pour un besoin réel. |
| Animations | `transition:transform 180ms ease` → `tw:transition-[transform] tw:duration-[180ms] tw:ease-[ease]` | Keyframes du gardien et célébrations; réduction des animations et performances. |
| Impression et responsive | Variantes d'impression envisageables si leurs déclarations sont équivalentes | Mise en page imprimée et `@media (max-width: 600px)` conservés; `sm` Tailwind n'est pas équivalent à ce seuil. |

## Périmètre du pilote et suite

Le pilote porte sur les styles de badge, carte métrique et confirmation, extraits
dans leurs feuilles locales, ainsi que sur les déclarations génériques de
`admin-controls.css` et `admin-forms.css`. Sélecteurs, inputs/outputs, tokens,
états et comportements restent les contrats à préserver. Le runtime du dialogue
et le contrôleur virtuel ne font pas partie de cette conversion.

Le lot Contributions étend cette approche aux six feuilles locales de la page :
résumé, filtres, liste, détail, export et cadre de page. Les grilles de résumé
conservent leurs quatre, deux puis une colonnes aux seuils de 1020 et 860 px;
le tableau conserve sa largeur minimale de 74 rem et son défilement local.
Les dimensions spécifiques, raccourcis `background`, sélecteurs et comportements
de sélection et d'export restent explicites. La [recette Contributions](../../tests/playwright/admin-contributions-ui.spec.ts)
couvre les thèmes, ces frontières responsive, les filtres et la sélection clavier,
avec des réponses API synthétiques.

Le lot Cockpit couvre le tableau de bord, les indicateurs, les cartes système,
les états Stripe et les tendances. Les requêtes de conteneur nommées
`admin-dashboard` et `admin-cockpit`, leur ordre et leurs seuils restent en CSS
explicite. Les tracés SVG, transformations, transitions et préférences de
mouvement réduit conservent leurs règles spécifiques. Les [recettes Cockpit](../../tests/playwright/admin-cockpit.spec.ts)
et [tableau de bord](../../tests/playwright/admin-dashboard-layout.spec.ts)
vérifient les grilles, palettes, états et interactions sur des API interceptées.

Le lot Cadre admin couvre `admin-layout` et `admin-nav` : barre supérieure,
menu latéral, lien d'évitement et navigation mobile. Les seuils de 400, 480,
860/861 et 1200 px restent explicites, ainsi que l'ordre des règles du menu
replié, du mode Concentration et de l'espace réservé au contrôleur virtuel.
Les [recettes du cadre](../../tests/playwright/admin-dashboard-layout.spec.ts)
vérifient les palettes, frontières responsive et commandes clavier; les recettes
[pilotage](../../tests/playwright/admin-pilotage.spec.ts) et
[contrôleur virtuel](../../tests/playwright/admin-virtual-controller.spec.ts)
couvrent leurs dispositions particulières avec des réponses synthétiques.

Les lots Audit, Factures, Transparence et File de courriels utilisent les mêmes
utilitaires dans leurs feuilles locales. Le
tableau d'audit garde sa présentation mobile à 700 px; les factures conservent
leurs panneaux et seuils de 1080, 860 et 620 px. La transparence garde son seuil
de 900 px et son tableau de 58 rem; la file courriel conserve ses seuils de
1080, 860 et 620 px et son tableau de 78 rem. Les recettes
[Audit](../../tests/playwright/admin-audit-ui.spec.ts),
[Factures](../../tests/playwright/admin-document-resend-ui.spec.ts),
[Transparence](../../tests/playwright/admin-transparency-ui.spec.ts) et
[Courriels](../../tests/playwright/admin-email-recovery-ui.spec.ts) utilisent les
API interceptées pour vérifier palettes, responsive et interactions. Ces lots
changent la présentation; les calculs, permissions, confirmations et opérations
de paiement, publication ou livraison restent dans leurs contrats existants.

Les lots Assistant, À suivre, Configuration et Recherche globale étendent ces
utilitaires aux files, cartes et panneaux de consultation. Les filtres de
l'assistant conservent leur seuil de 640 px; À suivre garde celui de 600 px,
avec les styles de sa page extraits dans une feuille locale. Configuration
conserve ses grilles à 1350 et 700 px. Le dialogue de recherche garde ses
dimensions calculées, son seuil de 480 px et ses mécanismes de focus. Les recettes
[assistant](../../tests/playwright/admin-assistant-overview.spec.ts),
[contexte](../../tests/playwright/admin-assistant-context.spec.ts),
[À suivre](../../tests/playwright/admin-attention.spec.ts),
[configuration](../../tests/playwright/admin-setup-layout.spec.ts) et
[recherche](../../tests/playwright/admin-global-search.spec.ts) vérifient leur
présentation et leurs interactions avec les API interceptées.

Les lots Publications, Automatisation, Accès et Guide d'identité utilisent aussi
les utilitaires locaux. Les publications conservent les seuils de 600, 700 et
900 px, le calendrier et le défilement de la file; l'automatisation garde ceux
de 520, 650 et 1100 px. Les styles inline du panneau de fiabilité et de la page
d'accès sont extraits dans leurs feuilles respectives. Les variables publiques
et les fallbacks du guide d'identité restent distincts des alias admin; son
seuil de 700 px est conservé. Les recettes
[publications](../../tests/playwright/admin-publication-queue.spec.ts),
[automatisation](../../tests/playwright/admin-publication-automation.spec.ts),
[accès](../../tests/playwright/admin-access-ui.spec.ts) et
[identité](../../tests/playwright/admin-identity-setup-ui.spec.ts) couvrent les
palettes, le responsive, le focus et les confirmations avec les API simulées.
Le guide public utilise les alias `--admin-selected` et `--admin-accent` pour
son étape active et ses liens, afin de garder un contraste lisible sans le
layout admin; les thèmes administratifs continuent de fournir leurs couleurs.

La revue des surfaces restantes couvre les dossiers commanditaires, les outils
Stripe et développeur, les dépenses, la connexion, les sauvegardes, le pilotage,
les guides, les contrôleurs et les pages publiques. Les styles inline extraits
gardent leur position après les feuilles déjà référencées par le composant.
Les petits hosts de Checkout et de Contribution sont ajoutés à la fin de leurs
feuilles existantes. Les tokens publics restent distincts des alias admin.
Les recettes [commanditaires](../../tests/playwright/admin-sponsorship-progress.spec.ts),
[plateforme](../../tests/playwright/admin-platform-tailwind.spec.ts),
[pilotage](../../tests/playwright/admin-pilotage.spec.ts) et
[surfaces publiques](../../tests/playwright/funding-tailwind.spec.ts) complètent
les parcours existants avec des contrôles de palettes, responsive et focus.

Tailwind peut ajouter une déclaration de secours et une branche `@supports`
autour d'un `color-mix()` existant. L'audit distingue ces ajouts de compatibilité
de l'équivalence des règles dans la branche moderne; les tests comparent les
couleurs calculées à une sonde utilisant les expressions originales. Ces ajouts
ne justifient aucun changement des couleurs sources ou des budgets Angular.

Les quatre fondations `admin-theme.css`, `admin-appearance.css`,
`admin-typography.css` et `styles/tailwind.css` gardent leurs responsabilités de
tokens, thèmes et typographie. Deux sources restent volontairement sans
utilitaires : `admin-icon.component.ts` conserve les six déclarations
intrinsèques de son SVG; `admin-celebrations.component.css` conserve son rendu
d'animation et son mélange de couleurs natif. Leur maintien est une décision de
revue, distincte d'une surface encore à migrer.

Étendre seulement là où les utilitaires rendent la source plus claire. Conserver
du CSS explicite pour les interactions de sélecteurs, les dégradés, graphiques,
positions calculées, animations produit et règles d'impression complexes.
Éviter les chaînes de valeurs arbitraires et l'emploi systématique de `@apply`.
Les styles dynamiques issus des signaux restent des bindings typés.

`@apply` produit des déclarations CSS : moins de lignes source ne garantit aucune
réduction de bundle. Les utilitaires de poids, interligne et chiffres tabulaires
peuvent ajouter des propriétés enregistrées et leurs fallbacks dans chaque feuille
compilée; le pilote conserve ces déclarations en CSS simple. Comparer le résultat
compilé avant d'étendre une conversion. Le budget initial reste celui
d'[Angular](../../angular.json),
sans relèvement pour cette intégration. Vérifier build Angular, chargement différé,
SSR, thèmes, responsive, clavier/focus et états selon la
[matrice de validation](validation.md). La présence de cette référence ne constitue
pas une preuve de réussite de ces vérifications.

Références : [installation Angular](https://tailwindcss.com/docs/installation/framework-guides/angular),
[`@reference` et `@apply`](https://tailwindcss.com/docs/functions-and-directives),
[alias de thème](https://tailwindcss.com/docs/theme#referencing-other-variables),
[Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight),
[composants Angular](https://github.com/angular/components#readme) et
[dialogues CDK](https://github.com/angular/components/blob/main/src/cdk/dialog/dialog.md).
