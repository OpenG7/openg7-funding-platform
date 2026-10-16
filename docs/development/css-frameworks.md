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
par `@reference` dans les feuilles locales; elle n'est pas importée par
`src/styles.css`. Aucun Preflight ni feuille globale d'utilitaires n'est émis.
Cela conserve les sélecteurs existants et le chargement différé des styles admin.

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
