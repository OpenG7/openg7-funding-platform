# Blueprint fonctionnel et visuel de la plateforme OpenG7

Inventaire du 18 octobre 2026, heure de Toronto. Ce blueprint décrit les pages,
leurs zones à l'écran, les responsabilités, les onglets, les fonctionnalités
locales et les services transversaux de la plateforme Funding. Il sert de base à
une analyse des lacunes de couverture, de navigation et de responsabilité.

Référence du code : commit local `b00ad2b2`, branche `feat/admin-campaigns`.
L'inventaire couvre 26 routes publiques/localisées, 22 routes administratives et
3 routes d'outillage local, soit 51 chemins explicites en comptant les alias et
les variantes de langue. Les routes inconnues ont aussi leur traitement 404.

Le périmètre est l'application Web du dépôt, avec ses contrats API et ses
intégrations. Les applications Windows/Xbox envisagées, les sites externes et
l'interface des fournisseurs ne sont pas des pages livrées par ce Web.

- [Pages publiques et suivi privé](#zones-publiques).
- [Administration](#zones-administratives).
- [Fonctionnalités transversales et propriétaires](#fonctions-transversales).
- [Grille pour analyser les lacunes](#analyse-lacunes).
- [Vérifications et limites](#validation-blueprint).

## Lecture de la cartographie

L'arborescence utilise quatre espaces par niveau. Les mots « haut », « gauche »,
« droite », « dessous », « bas », « fixe » et « superposé » indiquent la position
relative dans la page. Un élément « dessous » suit le précédent dans le flux et
peut nécessiter un défilement. Il ne se trouve pas nécessairement dans la première
hauteur d'écran. Les seuils responsive sont propres à chaque composant.

```text
Plateforme
    Espace et route
        Position de la zone dans la page
            Mission et acteur
            Sous-zone ou onglet
                Fonctionnalité et action
                Condition d'affichage et état
                Dépendance transversale
```

Les positions décrites viennent des templates et du CSS de l'état local examiné.
Les vérifications navigateur exécutées sont précisées en fin de document ; elles
ne couvrent pas chaque combinaison de route, langue, rôle, contenu et largeur.
Les adaptateurs présents dans le dépôt ne prouvent pas leur activation en
production. Les liens de sources permettent de réexaminer chaque surface.

| Mention          | Interprétation                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Présent          | Route, composant ou comportement implémenté dans le code examiné.                                           |
| Conditionnel     | Présent, affiché ou utilisable selon session, rôle, données, configuration ou choix utilisateur.            |
| Partiel          | La capacité décrite a une limite explicitement identifiée, par exemple une conversation uniquement simulée. |
| Externe          | Navigation ou opération confiée à un fournisseur ; son interface n'est pas décrite comme une zone OpenG7.   |
| À vérifier       | Information que le code ou les validations de cette passe ne permettent pas d'établir.                      |
| Sans zone propre | Fonction partagée appelée par plusieurs écrans ou exécutée côté API.                                        |

Une fonctionnalité peut être présente et conditionnelle. L'absence d'un panneau
sur un écran initial n'établit pas son absence du produit : les outils ouverts à
la demande, les tiroirs et les sections repliables sont recensés séparément.

## Carte générale des responsabilités

```text
OpenG7 Funding
    Espace public
        Accueil et contribution
        À propos et méthode
        Transparence et allocations
        Bâtisseurs et commanditaires publics
        Écosystème, musique, boutique, support et politique
        Page introuvable
    Suivi privé du commanditaire
        Accès par lien privé et récupération
        Fiche, consentements, médias, brouillons et échanges de modération
    Administration
        Connexion et diagnostic d'identité
        Pilotage, tableau de bord, À traiter et Assistant
        Contributions, commandites, Qualité et campagnes
        Publications, lots, calendrier et automatisation
        Factures, dépenses, transparence et audit
        Courriels, configuration et accès
    Fonctions transversales
        Langues, responsive, accessibilité et rendu initial
        Session, permissions, confirmations et protection des données
        Recherche, inspection, aide, préparation et commandes
        Paiement, documents, médias, publication, courriel et traçabilité
    Frontières externes
        Stripe Checkout et événements de paiement
        Fournisseur d'identité OIDC
        Services de publication Facebook et LinkedIn
        SMTP et stockage de médias selon configuration
        Plateformes et liens éditoriaux externes
```

| Acteur                       | Responsabilité dans les parcours                                                                               | Limite                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Visiteur                     | Consulter l'information et les projections publiques, choisir un parcours.                                     | Aucun accès aux dossiers privés ou à l'administration.                       |
| Contributeur personnel       | Saisir sa contribution et ses choix de reconnaissance, payer via Checkout.                                     | Son navigateur ne confirme pas le paiement.                                  |
| Commanditaire                | Fournir identité, consentements, contenu et médias dans son suivi privé ; répondre aux demandes.               | Son paiement et ses modifications ne valent pas approbation administrative.  |
| Lecteur admin (`reader`)     | Consulter les lectures opérationnelles autorisées, rechercher et questionner l'Assistant.                      | Aucune mutation métier ; certaines lectures sont réservées à d'autres rôles. |
| Opérateur admin (`operator`) | Réaliser les actions de revue, médias, préparation, publication et reprise explicitement autorisées par l'API. | Une liste fermée d'opérations détermine ses droits.                          |
| Propriétaire admin (`owner`) | Administrer les opérations, comptes et sessions ; gérer les actions financières et privées réservées.          | Les confirmations et préconditions métier restent requises.                  |
| API et workers               | Valider les droits, enregistrer les faits et exécuter les tâches autorisées avec reprise et audit.             | Ils n'inventent ni consentement ni autorisation humaine.                     |
| Fournisseurs                 | Confirmer leurs faits externes : paiement, identité, remise ou publication.                                    | Le résultat doit être conservé et réconcilié avec l'état OpenG7.             |

Ces rôles sont des responsabilités fonctionnelles. Le dépôt ne désigne pas les
personnes de l'organisation chargées de chacun de ces postes.

La politique d'accès effective est
[admin-identity/policy.ts](../../apps/funding-api/src/admin-identity/policy.ts).
Le guard des routes admin exige une session ; il ne suffit pas à autoriser une
lecture ou une action. Voir aussi le
[contrat d'identité](../operations/admin-identity-and-alerts.md).

<a id="zones-publiques"></a>

## Zones publiques et suivi privé

Les positions décrivent les templates et les styles présents : ordre de lecture, colonnes, éléments fixes et adaptations à la largeur. Elles ne constituent pas une recette visuelle exécutée. Les rôles désignent les utilisateurs et responsabilités fonctionnelles observables; aucun propriétaire humain n'est inventé.

### Routes publiques et accès locaux

Les 13 entrées françaises sont dupliquées avec /en, soit 26 routes explicites et 12 types de pages. Les deux entrées du Fonds chargent le même composant; les slugs anglais conservent les slugs français.

| Route française                        | Route anglaise                               | Surface et accès                                           |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| /                                      | /en                                          | Accueil du Fonds, alias de la route suivante; public       |
| /fonds-des-batisseurs                  | /en/fonds-des-batisseurs                     | Fonds, contribution, chiffres et retour Checkout; public   |
| /fonds-des-batisseurs/a-propos         | /en/fonds-des-batisseurs/a-propos            | Mission, usages, équipe et principes; public               |
| /ecosystem                             | /en/ecosystem                                | Carte et catalogue de présentation des plateformes; public |
| /music                                 | /en/music                                    | Annonce musicale et aperçus; public                        |
| /boutique                              | /en/boutique                                 | Présentation de produits et boutique externe; public       |
| /batisseurs                            | /en/batisseurs                               | Répertoire des contributeurs publics consentants           |
| /commanditaires                        | /en/commanditaires                           | Répertoire public des commanditaires admissibles           |
| /fonds-des-batisseurs/transparence     | /en/fonds-des-batisseurs/transparence        | Agrégats, registre mensuel, allocations et exports publics |
| /fonds-des-batisseurs/suivi-commandite | /en/fonds-des-batisseurs/suivi-commandite    | Dossier privé accessible par token                         |
| /support                               | /en/support                                  | Référence, récupération d'accès, contact et FAQ; public    |
| /politique-utilisation-remboursement   | /en/politique-utilisation-remboursement      | Politique publique et préparation d'une demande            |
| /404                                   | /en/404                                      | Destination absente et reprise                             |
| Toute autre route                      | /en/** pour une destination anglaise absente | 404 dans la langue correspondante                          |
| /dev/stripe-setup                      | Aucune variante anglaise déclarée            | Diagnostic et guide locaux; localhost ou 127.0.0.1         |
| /dev/webhooks                          | Aucune variante anglaise déclarée            | Diagnostic et catalogue webhook locaux; même restriction   |
| /dev/api-keys                          | Aucune variante anglaise déclarée            | État des clés et guide local; même restriction             |

Les pages publiques explicites, hors suivi, sont déclarées en prerender; le suivi relève du fallback client. Les données financières et annuaires chargés dans le navigateur restent distincts du HTML initial. La restriction de hostname des outils locaux est un contrôle Web; les droits et restrictions API relèvent du serveur.

Sources : [routes Web](../../apps/funding-web/src/app/app.routes.ts), lignes 7 à 165; [modes de rendu](../../apps/funding-web/src/app/app.routes.server.ts).

### En tête public et commande musicale

**Rôle et responsabilité.** Le visiteur navigue, change de langue et rejoint la contribution. Chaque page inclut son en-tête. Le composant racine ne fournit pas de pied de page commun.

```text
Haut de chaque page publique — dans le flux, sans position fixe déclarée
    Première ligne
        Gauche → Marque Fonds des Bâtisseurs / OpenG7, retour accueil
        Droite → Bascule FR/EN puis contribution vers #support
    Deuxième ligne — pleine largeur
        Accueil → À propos → Écosystème → Musique → Boutique
        → Bâtisseurs → Commanditaires → Transparence
Superposé au viewport
    Bas à droite → Bouton musical rond, lecture/pause
Sous 760 px
    Marque et actions réduites; navigation dessous sur plusieurs lignes
    Aucun hamburger; bouton musical conservé en bas à droite
```

La grille « brand actions » puis « nav nav » s'applique aussi sur ordinateur. Avant le seuil mobile, la navigation peut défiler horizontalement; sous 760 px, elle revient à la ligne. La langue est un bouton, pas un onglet. Le changement conserve le fragment et reprend les paramètres Checkout autorisés uniquement entre entrées équivalentes du Fonds.

Le bouton audio est fixe, z-index 40, caché côté serveur et sur /admin. Il lance/pause une lecture en boucle, avec déblocage par interaction si le navigateur refuse la lecture automatique; une erreur de fichier le retire. L'arrêt manuel persiste dans l'instance. La suppression du démarrage automatique compare littéralement /music et /boutique; la normalisation ne retire pas /en, donc ce comportement anglais reste à vérifier.

Sources : [racine](../../apps/funding-web/src/app/app.component.ts), ligne 10; [header](../../apps/funding-web/src/app/features/funding/components/funding-header/funding-header.component.ts), ligne 23; [styles globaux](../../apps/funding-web/src/styles.css), lignes 115, 162 et 361; [langue](../../apps/funding-web/src/app/features/funding/components/language-toggle/language-toggle.component.ts), ligne 46; [audio](../../apps/funding-web/src/app/features/funding/components/site-music/site-music.component.ts), lignes 22 et 138; [position audio](../../apps/funding-web/src/app/features/funding/components/site-music/site-music.component.css), ligne 3.

### Accueil et Fonds des Bâtisseurs

**Rôle et responsabilité.** Le visiteur comprend le Fonds; le contributeur choisit personnel/commandite, accepte les conditions et rejoint Checkout. Les chiffres publics viennent de lectures serveur.

```text
Page centrée, maximum 1530 px
    Haut → Header public
    Dessous → Retour Checkout conditionnel
    Hero pleine largeur
        Fond illustré; titre et présentation à gauche
        Sous la copie → Progression du mois, statut et contribution
    Écosystème
        Titre/description → Grille illustrée → Phrase de fondation
    Utilité du Fonds
        Introduction et actions
        Provenance sur toute la largeur
        Quatre KPI
        Progression de campagne
        Deux colonnes
            Gauche, haut → Circuit financier en quatre étapes
            Gauche, bas → Allocation, anneau et légende
            Droite sur deux rangées → Formulaire #support
                Dessous → Résumé financier
    Bas → Footer propre, texte de mission et quatre piliers
Sous 1400 px → KPI en deux colonnes; footer en une colonne
Sous 860 px
    Provenance et KPI empilés
    Circuit → Allocation → Formulaire → Résumé
    Écosystème en deux colonnes; piliers empilés
Sous 560 px → Écosystème en une colonne
```

Hero : montant du mois, objectif, pourcentage, statut de synchronisation et barre si snapshot. Les cartes écosystème sont des articles sans action dans ce template. L'introduction propose contribution et registre. La provenance indique synchronisation/source/devise/campagne. Les KPI distinguent confirmé, frais, disponible et objectif. Circuit : reçu → confirmé → frais → disponible. L'allocation expose catégories/pourcentages, avec vide et indisponibilité distincts. Une erreur ne signifie pas zéro.

**Formulaire.**

```text
Titre
Choix personnel / entreprise, boutons avec état sélectionné
Montants prédéfinis → Montant personnalisé et validation
Si commandite
    Formats par canal
    État et récapitulatif de l'offre serveur
    Disponibilités
Consentements
    Affichage public → Si accepté, nom public requis
    Affichage du montant
    Reconnaissance du statut non caritatif
Si commandite
    Charte active et acceptation de sa version
    Acceptation explicite de l'offre
Lancement Checkout → Mention de sécurité et politique → États
```

Ces choix ne sont pas des onglets routés. Commandite peut être désactivée; les formats utilisent des listes déroulantes. L'offre distingue chargement, erreur, vérification requise, reprise indisponible et offre retenue; recharger, réinitialiser ou restaurer selon l'état. Checkout distingue chargement, simulation locale, erreur, charte/offre modifiée et vérification requise. Les presets et seuils sont dans la [configuration UI](../../apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts); l'offre serveur demeure le contrat présenté et accepté. Personnel/entreprise passe de deux à une colonne sous 1180 px; montants de quatre à deux sous 560 px.

**Retour Checkout.** Bloc dans le flux avant le hero, pas une modale : fond illustré, carte à gauche et fermeture en haut à droite. Personnel : attente/confirmation serveur, vérification active/en pause, revérifier, transparence, support et nouvelle contribution selon état. Commandite : paiement → informations → revue → publication et lien privé de suivi. Annulation/échec/expiration : explication et reprise adaptée. Sous 860 px, carte sous l'illustration; sous 560 px, actions pleine largeur. L'URL ne confirme pas le paiement.

Sources : [accueil](../../apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.html), lignes 1, 15, 69, 121, 175, 197, 280, 330, 362 et 395; [styles accueil](../../apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.css), lignes 238, 516, 657 et 713; [formulaire](../../apps/funding-web/src/app/features/funding/components/funding-contribution-form/funding-contribution-form.component.html); [styles formulaire](../../apps/funding-web/src/app/features/funding/components/funding-contribution-form/funding-contribution-form.component.css), lignes 39, 375 et 565; [retour Checkout](../../apps/funding-web/src/app/features/funding/components/funding-checkout-notice/funding-checkout-notice.component.html); [styles retour](../../apps/funding-web/src/app/features/funding/components/funding-checkout-notice/funding-checkout-notice.component.css).

### À propos du Fonds

**Rôle et responsabilité.** Le visiteur comprend mission, usages, rôle présenté de l'équipe et principes de responsabilité.

```text
Header public
Hero illustré
    Gauche → Emblème, titre, déclaration et description
    Dessous → Comprendre le Fonds / écosystème / contribuer
Mission
    Gauche → Usages du financement
    Droite → Rôle de l'équipe et contact
Fondations → Trois cartes infrastructure / transparence / impact
Responsabilité
    Gauche → Finances
    Droite → Reconnaissance et commanditaires
Prochaines étapes → Contribuer / transparence
Footer → Marque à gauche; aide et politique à droite
Sous 860 px → Grilles empilées
```

Usages : hébergement, développement, maintenance. Les fondations mènent aux plateformes, registre et bâtisseurs. Le template ne rend pas de liste dynamique des membres de l'équipe.

Sources : [À propos](../../apps/funding-web/src/app/features/funding/pages/funding-about-page/funding-about-page.component.ts), ligne 33; [styles](../../apps/funding-web/src/app/features/funding/pages/funding-about-page/funding-about-page.component.css), lignes 16, 81, 309 et 350.

### Écosystème

**Rôle et responsabilité.** Le visiteur explore plateformes, familles, relations et principes communs, puis rejoint leurs dépôts ou le Fonds.

```text
Header public
Hero
    Gauche → Titre, copie et actions plateformes / connexions / contribution
    Dessous → Statistiques éditoriales
Carte de l'écosystème
    Haut → Introduction
    Diagramme desktop, de gauche à droite
        Plateformes → Familles → Noyau central → Familles → Plateformes
Catalogue #platforms → Grille de cartes, trois colonnes
Section #architecture
    Gauche → Architecture commune
    Droite → Connexions/familles, ancre #connections
Parcours → Étapes en ligne
Développement
    Gauche → Progression, statut, date et source
    Droite → Résumé chiffré et principes
CTA puis footer → Marque / liens / copyright
Sous 1280 px
    Carte, architecture, développement et footer en une colonne
    Noyau remonté; familles et listes en trois colonnes
Sous 760 px → Groupes, plateformes, statistiques et étapes empilés
```

Chaque plateforme présente illustration, numéro, nom, famille, description et dépôt externe. Le diagramme est une représentation de contenu. Les statistiques et progressions sont éditoriales et ne prouvent pas la livraison des plateformes. Les actions locales rejoignent #platforms, #connections et la contribution; le footer propose À propos, documentation/écosystème et support.

Sources : [Écosystème](../../apps/funding-web/src/app/features/funding/pages/ecosystem-page/ecosystem-page.component.ts), lignes 51, 120, 215, 243, 287, 301, 387 et 406; [styles](../../apps/funding-web/src/app/features/funding/pages/ecosystem-page/ecosystem-page.component.css), lignes 197, 230, 369, 429 et 712.

### Musique

**Rôle et responsabilité.** Le visiteur découvre une annonce musicale et des aperçus éditoriaux.

```text
Header public
Scène illustrée, conteneur centré
    Haut → Titre, présentation et badge à venir
    Deux colonnes
        Gauche → Album, couverture, statut et quatre lignes de pistes
            Bouton explicitement désactivé
        Droite → Introduction et trois aperçus d'actualités
    Dessous → Accueil / écosystème
Aucun footer propre
Sous 940 px → Album puis actualités
Sous 720 px → Disposition interne de l'album empilée
```

Le bouton d'album ne permet pas une écoute active. Le contrôle audio flottant commun est distinct. Aucun chargement de catalogue musical ou lecture de piste par album n'est présent dans cette page.

Sources : [Musique](../../apps/funding-web/src/app/features/funding/pages/music-page/music-page.component.ts), lignes 28, 57, 88 et 114; [styles](../../apps/funding-web/src/app/features/funding/pages/music-page/music-page.component.css), lignes 143 et 373.

### Boutique

**Rôle et responsabilité.** Le visiteur filtre des produits de présentation et rejoint la boutique marchande externe.

```text
Header public
Hero illustré → Présentation et accès boutique / catalogue
Section #featured-products
    Titre → Filtres d'univers → Compteur annoncé
    Grille produits → Mention d'achat externe
Bandeau avantages
Collections
Section #northdragon-universe
    Gauche → Histoire de marque et lien
    Droite → Citation
Lien avec l'écosystème
CTA boutique externe / accueil
Footer de marque
Produits → Trois colonnes, deux sous 1160 px, une sous 520 px
Sous 760 px → Avantages, collections et histoire en une colonne
```

« Tous » et univers sont des boutons sélectionnables, pas des onglets routés; une sélection vide possède un message. Chaque produit montre image ou placeholder, univers, statut, titre, description et prix facultatif, calculé depuis des unités mineures avec devise. La carte devient un lien seulement si une URL est disponible. Les collections et CTA ouvrent NorthDragon. La page ne traite ni panier, ni livraison, ni commande ou paiement marchand local. Avantages : quatre puis deux colonnes; collections : trois puis deux, avant l'empilement mobile.

Sources : [Boutique](../../apps/funding-web/src/app/features/funding/pages/boutique-page/boutique-page.component.ts), lignes 47, 95, 167, 180, 215, 243, 253 et 275; [styles](../../apps/funding-web/src/app/features/funding/pages/boutique-page/boutique-page.component.css), lignes 175, 262, 293, 412 et 423; [carte produit](../../apps/funding-web/src/app/features/funding/components/boutique-product-card/boutique-product-card.component.ts), ligne 19.

### Répertoire des Bâtisseurs

**Rôle et responsabilité.** Le visiteur consulte des fiches publiques consentantes. Le nombre de fiches est distinct du nombre de paiements et des totaux financiers.

```text
Header public
Hero → Titre/copie à gauche, contribuer / transparence
Corps à deux colonnes
    Gauche, large → Répertoire
        Titre → Actualiser → États → Liste
        Ligne → Initiales à gauche / nom et type au centre / montant à droite
        Bas → Pagination et total
    Droite, 19 rem → Résumé
        Nombre de fiches et reconnaissance
        Transparence / commanditaires / aide
Aucun footer propre
Sous 860 px → Répertoire puis résumé; montant sous l'identité
```

Actualiser, réessayer et pagination par 12 sont disponibles. Vide réel, page hors plage et source indisponible sont distincts; retour première page possible. Un noscript est présent. Les données sont exposées uniquement pour la source database. Aucun profil individuel de bâtisseur n'est routé.

Sources : [Bâtisseurs](../../apps/funding-web/src/app/features/funding/pages/builders-page/builders-page.component.html); [contrôleur](../../apps/funding-web/src/app/features/funding/pages/builders-page/builders-page.component.ts), lignes 42 et 89; [styles](../../apps/funding-web/src/app/features/funding/pages/builders-page/builders-page.component.css), lignes 135 et 338.

### Répertoire public des commanditaires

**Rôle et responsabilité.** Le visiteur consulte les commanditaires exposables. Le commanditaire peut démarrer une contribution ou rejoindre son suivi privé. Paiement, revue et publication sont distincts.

```text
Header public
Hero → Titre/copie
    Devenir commanditaire → Accueil ?intent=sponsorship#support
    Suivre sa commandite → Suivi privé
Corps centré, maximum 1200 px
    Gauche, large → Annuaire
        Titre/copie à gauche; actualiser à droite
        Résumé approuvés / publiés → États et plage affichée
        Cartes
            Haut pleine largeur → Photo et crédit éventuels
            Gauche → Logo ou initiales
            Droite → Identité, montant et résumé
            Dessous → Cibles/canaux, publication et site externes si présents
        Pagination
    Droite → Visibilité, revue, publication et politique
        Puis transparence / bâtisseurs / support
Aucun footer propre
Sous 880 px → Annuaire puis sidebar
```

Les états distinguent chargement, erreur/retry, source indisponible, vide initial et page hors plage. Une réponse ancienne sans métadonnées de pagination est gérée. Les images disposent d'un repli à l'échec; les liens externes ont les attributs de sécurité du template. Aucune fiche publique individuelle n'est déclarée dans les routes.

Sources : [commanditaires](../../apps/funding-web/src/app/features/funding/pages/sponsors-page/sponsors-page.component.html), lignes 1, 44, 124, 218, 232 et 261; [styles](../../apps/funding-web/src/app/features/funding/pages/sponsors-page/sponsors-page.component.css), lignes 109, 172 et 256.

### Transparence publique

**Rôle et responsabilité.** Le visiteur examine agrégats, provenance et limites, consulte les allocations publiées et exporte les données publiques.

```text
Header public
Hero illustré
    Gauche → Titre/copie
    Actions → Registre / JSON / contribuer
Bandeau statut
    Gauche → Chargement, prêt, erreur ou snapshot périmé
    Droite → Actualiser / réessayer
    Dessous → Date snapshot / vérification / source / devise
Quatre KPI
Campagne du mois UTC, pleine largeur
Grille à deux colonnes
    Rangée 1 → Registre gauche / allocations droite
    Rangée 2 → Méthode gauche / rapports droite
    Rangée 3 → Confidentialité gauche / plateformes droite
Bandeau contribution
Footer → Marque / liens / copyright
Sous 900 px
    Grille principale empilée dans l'ordre de lecture
    KPI et provenance en deux colonnes
Sous 540 px
    Statut et CTA empilés; KPI maintenus en deux colonnes
```

Le composant de rapports utilise display contents : méthode et rapports sont deux cellules distinctes de la grille parente.

Le registre #public-registry contient des **agrégats mensuels**, sans transaction nominative : période « toutes » ou mois; filtres tous/contributions/frais/remboursements; table période/type/montant et devise. Les lignes à zéro sont filtrées. Période absente, liste vide et absence de source sont distinguées. Ces filtres sont des boutons, pas des onglets. Période et type sont partageables par paramètres d'URL.

Les allocations montrent projet, montant/devise, description publique, résultat attendu, progression, date de publication et preuve facultative avec source/date. Les rapports offrent CSV, JSON, copie du lien et retour de copie; export désactivé si non autorisé par l'état. La méthode explique formule, versements et limites. La campagne distingue reçu/objectif/reste et mois indisponible. La qualité des frais distingue confirmé et provisoire/manquant.

Sources : [Transparence](../../apps/funding-web/src/app/features/funding/pages/funding-transparency-page/funding-transparency-page.component.ts), lignes 47, 110, 194, 232, 284 et 448; [styles](../../apps/funding-web/src/app/features/funding/pages/funding-transparency-page/funding-transparency-page.component.css), lignes 133, 157, 217 et 241; [registre](../../apps/funding-web/src/app/features/funding/components/funding-transparency-registry/funding-transparency-registry.component.html); [lignes du registre](../../apps/funding-web/src/app/features/funding/components/funding-transparency-registry/funding-transparency-registry.component.ts), ligne 45; [allocations](../../apps/funding-web/src/app/features/funding/components/funding-transparency-allocations/funding-transparency-allocations.component.html); [méthode et rapports](../../apps/funding-web/src/app/features/funding/components/funding-transparency-reports/funding-transparency-reports.component.html); [placement des rapports](../../apps/funding-web/src/app/features/funding/components/funding-transparency-reports/funding-transparency-reports.component.css), ligne 2.

### Suivi privé du commanditaire

**Rôle et responsabilité.** Le commanditaire accède à son dossier par lien privé, complète informations et médias, observe états et engagements puis utilise les corrections/recours permis. Ce parcours n'accorde pas un rôle administrateur.

```text
Header public
Bandeau titre/introduction, adapté en cas de perte d'accès
Corps centré
    Accès / chargement / indisponibilité et reprise
    Si dossier accessible
        Prochaine étape, message à gauche; compléter / actualiser à droite
        Deux colonnes
            Gauche, 1,8 fraction → Formulaire et médias
            Droite, 1 fraction → Résumé, étapes, offre, obligations et preuves
        Dessous, pleine largeur → Modération, correction et recours
Aucun footer propre ni onglet routé
Sous 980 px → Formulaire puis récapitulatif
Sous 600 px → Champs et grilles médias empilés
```

Le token initial est lu dans l'URL, conservé en mémoire et, si possible, en session navigateur, puis retiré de la barre d'adresse. L'absence ou l'expiration d'accès propose la récupération par courriel. Une indisponibilité peut conserver le dossier précédent et afficher une erreur de rafraîchissement.

Le formulaire comporte identité entreprise/contact, courriel, site et message; l'ancien logo URL est visible seulement s'il existe. Il gère requis, erreurs associées et sommaire d'erreurs cliquable. L'édition dépend de l'admissibilité; un dossier approuvé demande de commencer explicitement la modification et permet annuler. Une correction éditoriale peut être activée depuis la modération.

Les brouillons restent distincts de la soumission : sauvegarde automatique, restauration, abandon, reprise, conflit et rechargement. L'envoi distingue occupé, enregistré, erreur et résultat non confirmé. Un brouillon ne signifie pas réception d'une version en revue.

**Médias et droits.**

```text
À l'intérieur de la colonne formulaire
    Titre, limites et compteur
    Description alternative
    Droits d'usage avant import
    Ajouter/remplacer logo et ajouter plusieurs photos
    Statut des opérations
    Préférence photo et correction
    Grille
        Tentatives d'upload et erreurs individualisées
        Médias existants
            Aperçu, type, revue et dimensions
            Droits d'usage, retrait et suppression autorisée
            Proposition comme photo préférée
```

Le gestionnaire applique restrictions d'upload, nombre et revue. Le logo approuvé n'offre pas le même remplacement que le logo non approuvé. Les droits distinguent canaux, cibles, transformations autorisées, crédit, restrictions, preuve si requise et confirmation explicite. Une préférence n'est pas une approbation administrative. Historique à confirmer, retrait, erreur et reprise possèdent leurs états.

**Résumé et engagements.** La colonne droite présente référence, montant/devise, date de revue et étapes paiement/informations/revue/publication. Le libellé général de publication annonce actuellement un statut inconnu; les preuves structurées sont séparées. L'offre figée distingue historique qualifié et besoin de confirmation. Les obligations montrent canal, format, état, blocage, passage/preuve, échéance, retard, durée, début observé et première date de complétion possible. Les preuves indiquent provenance, date, cible/canal, visibilité observée et lien externe.

**Modération et recours.** La section inférieure présente décisions, niveau, sujet, motif, explication destinée au commanditaire, version de politique et revue indépendante éventuelle. Corriger est disponible selon autorisation. La reconsidération exige explication et confirmation avec soumettre/annuler; demande ouverte et absence d'approbation automatique sont explicites. Chargement, erreur/retry, vide et demande reçue sont prévus. Les états financiers incluent attente, échec, expiration, remboursement, litige, confirmé et inconnu, séparément de la revue/publication.

Sources : [template suivi](../../apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.html), lignes 1, 65, 96, 143 et 145; [styles suivi](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-followup.css), lignes 73 et 340; [contrôleur](../../apps/funding-web/src/app/features/funding/services/sponsorship-followup-controller.ts), lignes 37, 57 et 94; [token navigateur](../../apps/funding-web/src/app/features/funding/services/sponsorship-followup-browser.ts), lignes 16 et 48; [formulaire](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-followup-form.component.html); [médias](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-followup-media.component.html); [droits médias](../../apps/funding-web/src/app/features/funding/components/sponsor-media-usage/sponsor-media-usage-editor.component.html); [résumé et preuves](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-followup-status.component.html); [modération et recours](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-moderation-followup.component.html).

### Support

**Rôle et responsabilité.** Le contributeur retrouve une référence publique; le commanditaire récupère son lien privé; le visiteur contacte le support ou rejoint la participation technique.

```text
Header public
Hero illustré → Titre, présentation et raccourcis d'aide
Aide à deux colonnes
    Gauche → Recherche de référence publique
        Résultat et prochaine action
        Accordéon récupération de référence par courriel
    Droite → Aide commandite
        Lien suivi et récupération du lien privé par courriel
Contact pleine largeur
    Gauche → Explication/confidentialité; droite → Courriel et politique
FAQ → Quatre accordéons
Participation technique → Plateformes / bug / idée / code
Footer → Marque / liens / copyright
Sous 760 px → Aide et contact empilés
Sous 420 px → Actions techniques et données résultat en une colonne
```

La recherche expose référence, type, statut, montant public ou masqué, date et prochaine action; elle n'affiche pas les informations privées du dossier. Les actions orientent vers récupération d'accès ou contact. La récupération de référence est dans un accordéon sous la recherche, celle de commandite dans son propre composant. Validation, envoi, acceptation et erreur sont distincts.

Les FAQ concernent attente, courriel absent, facture et remboursement, avec liens utiles. Les cartes techniques ouvrent plateformes, bug, idée et contribution au code; une note réserve les données privées au contact adapté. Le contact utilise mailto.

Sources : [Support](../../apps/funding-web/src/app/features/funding/pages/support-page/support-page.component.html), lignes 1, 64, 83, 223, 287, 304, 331, 385 et 450; [styles](../../apps/funding-web/src/app/features/funding/pages/support-page/support-page.component.css), lignes 109, 151 et 235; [récupération commanditaire](../../apps/funding-web/src/app/features/funding/components/sponsorship-followup/sponsorship-access-recovery.component.ts), ligne 23.

### Politique utilisation et remboursement

**Rôle et responsabilité.** Le contributeur comprend les conditions et prépare une demande par courriel. Cette page ne déclenche pas de remboursement Stripe.

```text
Header public
Si charte active → Charte avant le hero et le titre principal
Hero illustré
    Titre, présentation, version et date
    Demander / retrouver référence / imprimer si disponible
Deux colonnes
    Gauche → Résumé et table des matières, sticky à 1,5 rem du haut
    Droite → Procédure, étapes, confidentialité et courriel préparé
        Puis sections numérotées
        Puis contact, version, support et retour en haut
Aucun footer propre
Sous 860 px → Résumé/sommaire puis contenu
Sous 860 px ou hauteur < 740 px → Sidebar non sticky
Impression → Styles dédiés aux éléments d'action/navigation
```

Les sections couvrent contributions, paiements, remboursements, litiges, commandites, visibilité et confidentialité. Le sommaire place le focus sur la section. L'impression dépend du navigateur. La révision éditoriale est définie séparément de l'éligibilité financière.

Sources : [Politique](../../apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.html), lignes 1, 19, 78, 135, 187 et 215; [sections](../../apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.ts), ligne 63; [révision](../../apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.metadata.ts); [styles](../../apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.css), lignes 115, 124, 220 et 257.

### Destination absente

**Rôle et responsabilité.** Le visiteur comprend qu'une destination n'existe pas et rejoint une page utile dans la bonne langue.

```text
Header public
Bloc central, maximum 48 rem
    Grand code 404 → Titre → Explication
    Accueil / aide côte à côte avec retour à la ligne
Aucun footer propre
Mobile → Même ordre, dimensions fluides
```

La page définit noindex, follow. Le statut HTTP dépend aussi du serveur/hébergement; le composant seul ne l'établit pas.

Sources : [404](../../apps/funding-web/src/app/features/funding/pages/not-found-page/not-found-page.component.ts), ligne 25; [styles](../../apps/funding-web/src/app/features/funding/pages/not-found-page/not-found-page.component.css), ligne 7.

### Shell des trois outils de développement locaux

**Rôle et responsabilité.** Le développeur consulte le diagnostic local et des guides Stripe. Ces surfaces n'utilisent pas le header public et ne constituent pas le shell de l'administration authentifiée.

```text
Desktop
    Gauche, fixe, largeur 15 rem → Sidebar locale
        Marque → Navigation financement → Stripe Setup / Webhooks / Clés API
        Aide → Identité de présentation en bas
    Droite, marge gauche 16 rem → Espace de travail
        Haut → Fil d'Ariane gauche; icônes et identité droite
        Hero illustré → Contenu de l'outil
Responsive
    Sidebar replacée dans le flux au-dessus
    Groupes de liens et masquage de certaines sections
    Empilement aux seuils propres à l'outil
Superposé → Audio global possible, car ces routes ne sont pas /admin
```

Les icônes sécurité/documentation/notifications n'ont pas de gestionnaire dans ces templates. L'identité affichée est un contenu de présentation, sans preuve de session. Les textes sont français dans le code, sans routes anglaises déclarées.

Sources : [shell Setup](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-page.component.html), lignes 1 à 69; [styles Setup](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-page.component.css), lignes 11, 19 et 154; [shell Webhooks](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-page.component.html), lignes 1 à 63; [shell Clés API](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-page.component.html).

### Stripe Setup local

**Rôle et responsabilité.** Le développeur observe l'état local, suit les étapes et copie des commandes ou ouvre des ressources. Les libellés ne prouvent pas un changement réel de configuration.

```text
Dans l'espace de travail local
    Hero /dev/stripe-setup
    Progression des étapes
    Grille haute à deux colonnes
        Rangée 1 → Connexion gauche / mode droite
        Rangée 2 → Clés API gauche / versements droite
    Grille basse à deux colonnes
        Webhook gauche / checklist sécurité droite
        Rangée suivante → Actions rapides
    Guide développeur → Étapes et détails de commandes/liens
    Footer → Documentation, support, dernière vérification, erreur éventuelle
Sous 1100 px → Grilles et footer empilés
Sous 900 px → Sidebar au-dessus et contenu sans marge gauche
Sous 760 px → Topbar/actions/hero et choix de mode empilés
```

La progression distingue complet, actif et bloqué; les étapes cochées manuellement sont stockées dans le navigateur. Les cartes mêlent diagnostic et contenus statiques : identité de compte, identifiants d'exemple, banque et certains textes. Le choix de mode ne change qu'un signal; « activer les paiements » émet ce changement d'affichage. « Enregistrer » copie une commande de démarrage; « tester l'endpoint » copie une commande Stripe CLI. Ces actions ne sont pas une activation live, un enregistrement de secrets ou un test exécuté.

Les actions effectives ouvrent Stripe/documentation/support, copient exemples/endpoints et relisent le diagnostic. Celui-ci provient du GET API /dev/stripe-setup-status. À l'échec, état de secours et erreur au footer.

Sources : [template Setup](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-page.component.html), lignes 70 à 151; [contrôleur](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-page.component.ts), lignes 76 à 130; [compte](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-account-panels.component.html); [diagnostic/actions](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-diagnostic-panels.component.html); [guide](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-steps.component.html); [styles compte](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-account-panels.component.css); [styles diagnostic](../../apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-diagnostic-panels.component.css); [lecture API](../../apps/funding-web/src/app/features/funding/services/stripe-setup-dev.service.ts).

### Webhooks local

**Rôle et responsabilité.** Le développeur consulte configuration, événements, commandes et recommandations; ce n'est pas une console de rejeu financier.

```text
Dans l'espace de travail local
    Hero /dev/webhooks
    Quatre cartes
        API / secret configuré ou manquant / source transparence / vérification
    Grille à deux colonnes
        Rangée 1 → Endpoint gauche / catalogue événements droite
        Rangée 2 → Commandes gauche / checklist sécurité droite
    Bas → Journal de diagnostics
Sous 1200 px → Statut en deux colonnes; lignes de diagnostic empilées
Sous 900 px
    Sidebar au-dessus
    Cartes et grille en une colonne; topbar et hero empilés
```

Les actions copient endpoint/commandes, ouvrent Stripe et revalident l'API. Événements et diagnostics proviennent de constantes de présentation : actualiser ne les transforme pas en historique réel. Une erreur relit l'état de secours et pose loadError; ce signal ne possède pas de message dédié visible dans le template principal.

Sources : [Webhooks](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-page.component.html), lignes 64, 81, 83 et 119; [contrôleur](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-page.component.ts), ligne 43; [styles](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-page.component.css), lignes 245 et 269; [statut](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-status.component.html); [endpoint](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-endpoint-panel.component.html); [diagnostics](../../apps/funding-web/src/app/features/funding/pages/webhooks-page/webhooks-diagnostics-panel.component.html).

### Clés API locales

**Rôle et responsabilité.** Le développeur observe la présence déclarée des clés et consulte rotation, permissions et exemples. Les valeurs privées ne sont pas des champs d'édition.

```text
Dans l'espace de travail local
    Hero /dev/api-keys
    Quatre cartes → Publiable / secrète / webhook / environnement
    Grille à deux colonnes
        Rangée 1 → Rotation gauche / permissions droite
        Rangée 2 → Commandes gauche / checklist sécurité droite
    Bas → Audit de présentation
        Titre gauche / revalider droite
        Lignes du catalogue
Sous 1500 px → Sidebar dans le flux; contenu sans marge gauche
Sous 1200 px → Cartes en deux colonnes; audit empilé
Sous 900 px → Cartes, grille, topbar et hero empilés
Sous 700 px
    Navigation condensée aux outils Stripe
    Actions de topbar et certaines sections sidebar masquées
```

« Copier la commande » copie un exemple. Rotation, permissions, commandes et audit sont un catalogue statique. Revalider actualise l'état de configuration local; cela ne réalise ni rotation ni journal d'audit réel. En échec, retour au statut de secours; loadError existe sans message dédié dans le template principal.

Sources : [Clés API](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-page.component.html); [contrôleur](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-page.component.ts), lignes 49 à 78; [catalogue](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-catalog.ts), lignes 37 à 70; [styles](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-page.component.css), lignes 236, 337, 401 et 412; [cartes](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-key-cards.component.html); [styles cartes](../../apps/funding-web/src/app/features/funding/pages/api-keys-page/api-key-cards.component.css), lignes 8 et 71.

<a id="zones-administratives"></a>

## Zones administratives

Les surfaces administratives ci-dessous sont présentes dans l’état examiné. Leur placement est décrit par les templates et les règles CSS : « haut » et « bas » suivent l’ordre du contenu ; « gauche » et « droite » désignent les colonnes lorsqu’elles sont actives. Les éléments conditionnels dépendent d’une sélection, d’un rôle, d’une configuration ou d’un état serveur. Une interface présente dans le code ne prouve pas l’activation d’un fournisseur externe.

### Carte des routes administratives

Le guard commun restaure une session, puis redirige vers la connexion avec une URL de retour en cas d’échec. Il ne définit pas le rôle autorisé pour chaque opération. Les droits réels sont vérifiés par l’API ; un lien masqué ou un bouton actif ne suffit pas à les établir.

| URL                                         | Zone responsable                            | Entrée et protection                                    |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `/admin/login`                              | Connexion administrative                    | Sans guard de session                                   |
| `/admin/oidc-setup`                         | Guide public de préparation de l’identité   | Sans guard de session                                   |
| `/admin/fundraiser`                         | Cockpit de supervision                      | Session requise                                         |
| `/admin/fundraiser/attention`               | File des tâches à traiter                   | Session requise                                         |
| `/admin/fundraiser/pilotage`                | Décisions et commandes de pilotage          | Session requise                                         |
| `/admin/fundraiser/assistant`               | Assistant et file opérationnelle globale    | Session requise                                         |
| `/admin/fundraiser/contributions`           | Contributions et reprise Stripe             | Session requise                                         |
| `/admin/fundraiser/sponsors`                | Registre et dossier commanditaire           | Session requise                                         |
| `/admin/fundraiser/sponsors/quality`        | Inventaire d’adoption et audit historique   | Session requise ; contenu propriétaire conditionnel     |
| `/admin/fundraiser/campaigns`               | Prestations promises et suivi de livraison  | Session requise                                         |
| `/admin/fundraiser/invoices`                | Factures, avoirs et transmission            | Session requise                                         |
| `/admin/fundraiser/publications`            | Accueil des espaces de publication          | Session requise                                         |
| `/admin/fundraiser/publications/drafts`     | Brouillons de publication                   | Session requise                                         |
| `/admin/fundraiser/publications/batches`    | Lots de publication                         | Session requise                                         |
| `/admin/fundraiser/publications/calendar`   | Créneaux éditoriaux                         | Session requise                                         |
| `/admin/fundraiser/publications/automation` | Livraisons, flux et fiabilité de l’automate | Session requise                                         |
| `/admin/fundraiser/expenses`                | Dépenses et allocations                     | Session requise                                         |
| `/admin/fundraiser/transparency`            | Contrôle des données de transparence        | Session requise                                         |
| `/admin/fundraiser/audit`                   | Journal administratif                       | Session requise                                         |
| `/admin/fundraiser/email-queue`             | File courriel et réconciliation             | Session requise                                         |
| `/admin/fundraiser/setup`                   | Configuration et état des services          | Session requise ; lectures privées contrôlées par l’API |
| `/admin/fundraiser/access`                  | Comptes et sessions administratives         | Session requise ; API propriétaire                      |

Le paramètre `sponsorshipId` ouvre un contexte dossier sur Assistant ; il ne crée pas une route distincte. Les paramètres de sélection des autres pages ciblent des objets existants. Les sous-espaces Publications partagent un composant pour conserver les éditions locales entre leurs routes. Le matcher accepte uniquement accueil, `drafts`, `batches` et `calendar` ; `automation` possède sa propre entrée.

Source : [routes administratives](../../apps/funding-web/src/app/admin.routes.ts), notamment l. 8, 29 et 129.

### Shell administratif et navigation

Responsabilité : fournir le cadre des pages protégées, la navigation, la recherche et les surfaces transversales de lecture ou de confirmation. Il ne charge pas directement les données financières propres à chaque page. Les rôles nominatifs sont lecteur, opérateur et propriétaire ; le mode token local conserve une identité partagée distincte.

```text
Écran bureau
    Gauche → Navigation latérale
        Haut → Marque G7 et titre du fonds, lien cockpit
        Milieu → Groupes de navigation
            Pilotage → Poste de pilotage, cockpit, à traiter, assistant
            Opérations → Contributions, commanditaires, qualité, campagnes, publications
            Finance → Factures, dépenses, transparence
            Système → Courriels, audit, configuration
            Compteurs → Nombre d’actions projetées par domaine
        Bas → Identité et rôle
            Accès et sessions si propriétaire
            Indication lecture seule si lecteur
            État d’échec de déconnexion si nécessaire
            Déconnexion, retour au site public
    Droite → Espace de travail
        Haut → Barre globale
            Gauche → Réduire ou rétablir la navigation
            Centre → Recherche globale
            Droite → Nouveau passage et compteur de dossiers
                     Activité des contributions
                     Assistant, langue, indicateur identité
        Sous la barre → Déclencheurs Guide et contrôleur
        Centre → Contenu de la route
        Superpositions conditionnelles → Inspecteur, confirmation, modération
    Variante contrôleur → Rail droit et commandes basses si fournis par la page
    Variante simulateur → Dock dédié si sandbox disponible et simulateur ouvert
```

La navigation mesure 15 rem par défaut et 14 rem sous 1200 px. Elle est sticky et défilable dès 861 px. Le contenu principal est centré, avec une largeur maximale de 100 rem par défaut. La barre globale reste dans le flux de la page. À 860 px ou moins, la navigation devient un bandeau supérieur avec menu repliable et l’espace de travail passe dessous. À 480 px ou moins, la recherche prend une ligne complète et Nouveau passage devient pleine largeur. Le lien Qualité est masqué hors propriétaire dans la navigation ; cette condition de présentation ne définit pas le contrôle API de la route.

Nouveau passage ne montre un nombre confirmé que si la file est disponible, complète et sans source manquante ; sinon il affiche un tiret et une description d’indisponibilité. Les compteurs latéraux agrègent des tâches, pas des paiements.

Sources : [template du shell](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.ts) (l. 62), [styles du shell](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.css) (l. 78, 204 et 212), [navigation](../../apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.ts), [styles de navigation](../../apps/funding-web/src/app/features/funding/components/admin-nav/admin-nav.component.css) (l. 111).

### Connexion administrative

Route : `/admin/login`. Responsabilité : découvrir le mode d’authentification et ouvrir une session, puis rejoindre la destination administrative autorisée. Acteur : personne non connectée ou dont la session a expiré.

```text
Centre de l’écran → Carte de connexion
    Haut → OpenG7 à gauche, choix de langue à droite
    Dessous → Titre Accès admin et explication du mode
    Corps conditionnel
        OIDC → Explication et lien de connexion au fournisseur
        Token local → Champ secret et bouton Se connecter
    Sous le formulaire → Session expirée ou connexion refusée
    Bas → Guide de configuration de l’identité, retour au fonds
```

La carte est centrée verticalement et limitée à 28 rem ; elle conserve une marge sur petit écran. États : découverte du mode, chargement de connexion, refus, erreur de configuration, expiration. Une session déjà restaurée rejoint directement la destination administrative. Le formulaire token et le lien OIDC sont des branches distinctes ; le code de cette page n’autorise pas un mode token en production.

Sources : [page connexion](../../apps/funding-web/src/app/features/funding/pages/admin-login-page/admin-login-page.component.ts) (l. 21), [styles connexion](../../apps/funding-web/src/app/features/funding/pages/admin-login-page/admin-login-page.component.css) (l. 3).

### Guide de préparation de l’identité

Route : `/admin/oidc-setup`. Responsabilité : expliquer la préparation OIDC sans exiger une session. Le guide peut aussi être intégré à Configuration avec les observations privées retournées par l’API.

```text
Haut → Marque, titre et introduction à gauche ; langue à droite
Dessous → Explication de la portée du guide public
Corps → Guide identité
    En-tête → Titre et état de configuration observé
    Résumé conditionnel → Mode, issuer, callback, paramètres présents ou absents
    Navigation → Étapes ordonnées
    Étape active → Position, titre, observation, instructions
        Exemples de callback et noms de variables selon l’étape
        Précédent et suivant
    Bas → Accordéon de toutes les étapes
          Liens guide public, accès administratifs, runbook
Pied de page → Retour connexion et connexion pour vérifier
```

Sans statut injecté, le guide signale que la configuration n’est pas observée. Les indicateurs de présence ne révèlent pas les secrets et ne valident pas à eux seuls une connexion MFA complète. La mise en page suit une colonne de contenu centrée et des en-têtes qui se replient.

Sources : [page du guide](../../apps/funding-web/src/app/features/funding/pages/admin-identity-setup-page/admin-identity-setup-page.component.html), [organisme identité](../../apps/funding-web/src/app/features/funding/components/admin-identity-setup/admin-identity-setup.component.html).

### Cockpit de supervision

Route : `/admin/fundraiser`. Responsabilité : réunir l’état du financement, les priorités opérationnelles et la santé des systèmes. Acteurs : administrateurs authentifiés selon les lectures autorisées par l’API ; les liens conduisent aux espaces qui possèdent les actions.

```text
Haut → Titre et sous-titre à gauche ; actualisation et pilotage à droite
Dessous → Parcours de la plateforme
Dessous → États généraux de chargement, erreur, refus ou indisponibilité
Dessous → Métriques du cockpit
Zone de travail
    Gauche → À traiter, version compacte
    Droite → Progression du dossier courant
Dessous → Période et date de mise à jour
Synthèses
    Gauche → Revues commanditaires, compteurs, lien dossiers
    Droite → Publications, compteurs, lien publications
Détails
    Gauche → Contributions récentes, montant et statut, lien contribution
    Droite → Événements Stripe en échec ou en cours, dernière erreur, configuration
Dessous → Célébrations conditionnées aux données fraîches
Zone secondaire → Assistant contextuel et activité administrative
Bas → Santé des systèmes
```

Les blocs démarrent en une colonne. Les requêtes de conteneur créent deux colonnes pour synthèses/détails dès 60 rem, pour le travail dès 64 rem, puis jusqu’à quatre colonnes secondaires à 84 rem. Un échec peut signaler un snapshot ancien ; une donnée indisponible ne devient pas un zéro. La santé d’un service et le succès d’un parcours métier sont des informations distinctes.

Sources : [template cockpit](../../apps/funding-web/src/app/features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.html), [styles cockpit](../../apps/funding-web/src/app/features/funding/pages/admin-dashboard-page/admin-dashboard-page.component.css) (l. 185, 225 et 233).

### File des tâches à traiter

Route : `/admin/fundraiser/attention`. Responsabilité : exposer les tâches déterministes et leurs destinations, sans transformer cette liste en moteur de mutation. Acteurs : administrateurs disposant de la lecture opérationnelle.

```text
Haut → Titre de page
Panneau À traiter
    En-tête → Titre, aide, actualiser
    Résumé → Compteurs projetés
    Filtres → Type, priorité, échéance
    État → Chargement, erreur, refus, indisponibilité
    Résultat → Nombre filtré, état vide
    Liste verticale
        Chaque tâche → Priorité, type, raison, référence, canal ou événement
                       Date d’échéance ou réception si disponible
                       Ouvrir l’espace responsable
                       Inspecter Stripe pour les incidents concernés
    Bas → Date du résultat et pagination
```

Le même organisme existe en variante compacte dans le cockpit, avec moins de filtres et un lien vers cette page. Les destinations conservent un retour à la file. La liste présente des liens et des inspections ; la décision métier reste dans l’espace cible. Les éléments et commandes se replient selon la largeur disponible.

Sources : [page à traiter](../../apps/funding-web/src/app/features/funding/pages/admin-attention-page/admin-attention-page.component.ts), [panneau de file](../../apps/funding-web/src/app/features/funding/components/admin-attention/admin-attention-panel.component.html), [liste de tâches](../../apps/funding-web/src/app/features/funding/components/admin-attention/admin-attention-list.component.ts).

### Poste de pilotage

Route : `/admin/fundraiser/pilotage`. Responsabilité : examiner une décision à la fois, en montrer les conséquences et exécuter les commandes permises avec confirmation et reçu. Les domaines réels sont publications, commanditaires, courriels, factures, contributions, projets et opérations. Le mode de saisie clavier ou manette ne modifie pas les droits.

```text
Haut → Contexte du fonds, domaine et titre
    Droite → Programme éditorial, guide, apparence, concentration
Dessous → Filtres de domaine avec compteurs
Dessous → Décisions en attente, décisions traitées, détails ouverts
Dessous → Annonces, session, erreurs, reçu et résultat incertain
Zone centrale
    Gauche → Décision sélectionnée
        Type, identité, destination, date, commanditaires concernés
        Visuel et contenu de prévisualisation
        Situation, proposition, conséquence
        Actions de modération si applicables
    Droite → File des décisions suivantes et pagination
    Variante Opérations → État des flux et pause ou reprise autorisée
Dessous → État de l’automate, calendrier, réglages, état du contrôleur
Bas → Aide clavier et commandes contextuelles
Tiroirs → Programme, apparence, détails, édition, confirmation,
          calendrier, réglages, aide et diagnostic d’incident
```

Les commandes peuvent être refusées, en attente de confirmation, accomplies ou incertaines. Un résultat incertain propose de vérifier le reçu et, selon droits, d’ouvrir l’incident ; il ne doit pas être rejoué aveuglément. Les décisions liées aux publications ou commanditaires exposent la modération du sujet exact.

La décision et la file sont côte à côte lorsque le conteneur atteint 54 rem ; sinon elles s’empilent. Le mode concentration masque navigation, barre globale et plusieurs informations secondaires ; la file suivante peut être réouverte. Les commandes contextuelles occupent une zone réservée : deck bas à partir de 1280 × 650 et rail droit à partir de 1440 × 700, avec variantes compactes en dessous. Les dimensions sont des conditions CSS, pas une exigence de périphérique physique.

Sources : [template pilotage](../../apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-page.component.html) (l. 91, 260, 321 et 618), [domaines](../../apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-page.component.ts) (l. 216), [styles pilotage](../../apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-page.component.css) (l. 658 et 839), [placement des contrôleurs](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.css) (l. 389 et 417).

### Assistant global

Route : `/admin/fundraiser/assistant`, sans `sponsorshipId`. Responsabilité : regrouper les recommandations, parcourir la file et préparer des brouillons admissibles. La lecture reste distincte de l’envoi, de l’approbation et de la publication. Les capacités conversationnelles dépendent du mode retourné par le serveur.

```text
Haut → Titre et introduction à gauche ; actualiser à droite
Dessous → Accordéon Poser une question
    Chargement du mode, désactivation ou formulaire question
    Réponse et état de requête
Dessous → État de lecture globale
Dessous → Catégories de travail
Tableau de travail
    Recommandations prioritaires si aucun filtre ciblé
    File parcourable
        Filtres catégorie, priorité et groupes de courriels
        Nombre de résultats
        Éléments, priorité, raison, champs manquants, examiner
        Pagination et date
Bas → Accordéon de synthèse optionnelle
Tiroir droit → Détail de l’élément sélectionné
    Type, titre, montant éventuel, raison, priorité, champs manquants
    Référence courriel ou canal selon le sujet
    Ouvrir la page responsable
    Préparer un brouillon si permis et applicable
    Résultat de préparation ou absence de proposition
```

États : chargement, prêt, données anciennes après échec, refus, indisponibilité, vide, sujet résolu, erreur de détail ou de préparation. Les textes distinguent la conversation désactivée et le mode mock ; cette surface ne prouve pas qu’un fournisseur IA externe soit configuré. Les blocs suivent une colonne principale de 78 rem maximum ; les sous-composants adaptent recommandations et file au conteneur. Le détail utilise le tiroir partagé, plein écran en largeur sous 600 px.

Sources : [page Assistant](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.html) (l. 71), [question](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-question.component.html), [file de l’Assistant](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-queue.component.html), [styles Assistant](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.css).

### Assistant contextuel du dossier

Entrée : `/admin/fundraiser/assistant?sponsorshipId=…`. Responsabilité : expliquer un dossier, ses faits et sa prochaine étape, puis préparer des éléments de travail. L’aide dossier est située dans cet espace, et non dans une colonne permanente du dossier commanditaire.

```text
Haut → Titre Assistant ; retour au dossier
Corps large
    Gauche, deux parts → Assistant contextuel
        En-tête et actualisation
        Référence du dossier
        Faits repliables → Paiement, remboursement, revue, visibilité,
                          consentement, médias, canaux promis et couverts
        Champs manquants
        Prochaine étape et accès à sa page responsable
        Préparations selon droits → Relance, note, publication
        Brouillon et, pour une relance, destinataire non modifiable,
            sujet et message éditables, révision avant envoi
        Question et réponse si conversation disponible
        États de travail et erreurs
    Droite, une part → Aide pas à pas du dossier
        Progression chargée sans répéter la synthèse
        Étape, raison et blocages
        Liens vers la bonne rubrique
        Éditer identité ou ouvrir l’accès selon droits
        Précédent, suivant, étape recommandée
Dialogue de relance → Destinataire et contenu exact, annuler ou confirmer
Après mise en file → Résultat et lien vers le message courriel
```

À partir de 1100 px, les deux colonnes valent `2fr / 1fr` ; en dessous, l’aide suit le contenu principal. La largeur maximale de cette variante est 112 rem. Préparer une relance ne l’envoie pas : un formulaire puis une confirmation distincte précèdent la demande serveur. Une réponse absente, une indisponibilité ou un état de brouillon ne valent pas livraison.

Sources : [variante dossier](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.html) (l. 1), [placement responsive](../../apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-page.component.css) (l. 59), [contexte](../../apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context.component.html), [aide dossier](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-guide.component.html).

### Contributions

Route : `/admin/fundraiser/contributions`. Responsabilité : consulter les contributions, accéder à leur suivi, exporter les données autorisées et préparer une reprise Stripe bornée. L’export privé et le backfill conservent leurs droits et confirmations propres.

```text
Haut → Titre ; actualiser et Export CSV
Dessous → État de lecture
Dessous → Résumé des contributions
Dessous → Recherche et filtres type, paiement, visibilité publique
Dessous → Surface d’export avec nombre, confirmation et erreur éventuelle
Si contribution sélectionnée → Détail avant la liste
    Informations de contribution et suivi du paiement
Liste → Contributions sélectionnables, états et date de mise à jour
Bas → Reprise Stripe
    Indication de droits requis ou périmètre préparatoire
    Périodes prédéfinies, dates début et fin, limite de 1 à 100
    Aperçu avant exécution
    Cible compte/projet et mode test ou live retournés par l’API
    Compteurs et avertissements de limites ou frais manquants
    Renouvellement d’aperçu expiré et exécution confirmée si permise
```

Les états séparent lecture en cours, erreur, sélection, export, aperçu, opération en cours, résultat terminé, interrompu ou incertain. Le détail sélectionné n’est pas une colonne latérale dans ce template. Les filtres et contrôles se replient sur les petites largeurs. Un retour Checkout ne devient pas une confirmation de paiement par cette page.

Sources : [page contributions](../../apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-page.component.html), [reprise Stripe](../../apps/funding-web/src/app/features/funding/components/admin-stripe-backfill/admin-stripe-backfill.component.html).

### Registre des commanditaires

Route : `/admin/fundraiser/sponsors`, sans sélection. Responsabilité : trouver les dossiers et rendre visibles les différences entre paiement, revue et publication. La gestion d’un dossier appartient à l’espace sélectionné.

```text
Haut → Fil d’Ariane
    Gauche → Titre et introduction
    Droite → Actualiser et accès au site public
Dessous → Résumé revue en attente, dossiers visibles et actifs
Registre pleine largeur
    En-tête → Nombre de résultats et aide
    Filtres → Recherche, revue, publication et paiement, réinitialiser
    Résultats → Lignes sélectionnables, états propres à chaque dossier
    Bas → Pagination et taille de page
```

États : chargement, erreur avec actualisation, absence de commandites, aucun résultat après filtrage. La présence d’un dossier dans le registre ne le rend pas visible publiquement. Une sélection remplace le contexte de page par l’espace dossier ci-dessous ; le titre et le résumé sont alors cachés.

Sources : [page commanditaires](../../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.html) (l. 1), [panneau registre](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsors-list-panel.component.ts) (l. 34), [styles de l’espace](../../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-workspace.css).

### Dossier commanditaire et ses cinq onglets

Entrée : même route avec `sponsorshipId`. Responsabilité : gérer le dossier exact, ses pièces, engagements, décisions et conséquences. Les contrôles de présentation distinguent lecture, gestion et actions propriétaire ; l’API garde la décision d’autorisation.

```text
Écran >= 1440 px
    Gauche, 14 rem → Registre compact sticky et défilable
    Droite → Dossier sélectionné
Écran < 1440 px
    Registre caché ; dossier sur la largeur disponible
Dossier, du haut vers le bas
    Barre d’outils
        Retour toutes les commandites, note interne, interventions
        Assistant contextuel, modifier le dossier
        Accès au suivi si propriétaire
        Actualiser, dossier précédent et suivant
    En-tête entreprise
        Identité, montant, référence et états
        Déclencheur de modération si gestion permise
        Détails repliables
    Alertes de paiement et conflit de version
    Panneau Accès au suivi, si ouvert
    Navigation → Aperçu | Fiche et médias | Publication | Finances | Historique
    Prochaine étape compacte
    Contenu de l’onglet
    Actions de décision selon onglet, état et droits
```

À 600 px ou moins, la barre outils devient une grille de deux colonnes et les contrôles acceptent plusieurs lignes. Le dossier conserve son défilement normal ; le registre compact est la partie sticky sur grand écran. L’assistant et l’aide contextuelle se trouvent sur la route Assistant avec `sponsorshipId`.

Les cinq libellés visibles et leurs correspondances sont les suivants. Les valeurs `media` et `refund` sont des alias internes qui activent respectivement Fiche et médias et Finances ; elles n’ajoutent pas deux onglets.

| Onglet          | ID            | Responsabilité et sous-zones dans l’ordre                                                                                                                                    |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aperçu          | `overview`    | Synthèse de progression ; incidents Stripe s’ils existent ; paiement et références ; liens fiche/finances ; message du commanditaire ; note interne et son éditeur en tiroir |
| Fiche et médias | `identity`    | Coordonnées et complétude ; état de soumission ; modification et accès selon droits ; logo ; préférence média ; espace de revue des médias                                   |
| Publication     | `publication` | Préparation ; prestations et responsabilité ; fiche site ; canaux sociaux ; engagements ; paramètres de fiche et déclaration historique ; revue des livraisons en tiroir     |
| Finances        | `billing`     | Montant remboursé confirmé ; factures et avoirs ; échecs courriels ; historique des remboursements ; formulaire remboursement propriétaire lorsqu’ouvert                     |
| Historique      | `audit`       | Historique du dossier, actions et inspection détaillée                                                                                                                       |

Les actions finales de revue et remboursement apparaissent selon la rubrique : retour en attente, refus, approbation et remboursement. Les panneaux de refus/remboursement incluent brouillon, raison, validation, annulation et confirmation. L’onglet Publication et l’Historique ne réaffichent pas ce groupe d’actions générique. Les alertes de paiement et versions peuvent bloquer de nouvelles décisions. Le mode lecteur signale la consultation seule.

La barre des décisions est **sticky en bas** du viewport pendant le défilement
de son conteneur, à `max(0.5rem, env(safe-area-inset-bottom))`, avec `z-index: 5`.
Elle peut donc rester visible au-dessus du contenu, y compris sur mobile ; elle
ne doit pas être interprétée comme un simple footer après tout le dossier.
Source : [styles des décisions](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-decision-actions.component.css).

Sources : [template dossier](../../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-page.component.html) (l. 117, 219, 294 et 322), [navigation des cinq onglets](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-detail-tabs.component.ts) (l. 66), [styles dossier](../../apps/funding-web/src/app/features/funding/pages/admin-sponsors-page/admin-sponsors-workspace.css) (l. 14 et 163), [aperçu](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-detail-overview.component.ts), [fiche](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-detail-identity.component.html), [médias](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-detail-media.component.ts).

### Publication dans le dossier commanditaire

Responsabilité locale : expliquer la livraison des prestations de ce commanditaire et gérer séparément sa fiche publique. Les prestations promises, la préparation, l’autorisation d’envoi, la preuve et la visibilité courante sont des dimensions distinctes.

```text
Haut → Titre du parcours Publication
Dessous → Reçu de préparation
    Paiement et offre acceptée
    Résumé du travail préparé
    Pilote des problèmes et liens vers les sources à compléter
    Contenu exact et détails repliables
    Portée de l’approbation et confirmation
    Estampille, historique et confirmations
Tableau des livraisons
    État de chargement, erreur, actualisation et notification
    Compteur et barre de complétude
    Résumé des prestations, raison et prochaine responsabilité
    Lien Campagnes pour les prestations du dossier
    Grille des destinations
        Carte site → Visible, privé ou à vérifier
            Blocages et liens vers les bonnes rubriques
            Voir la fiche publique si visible
            Paramètres, publier ou masquer selon admissibilité et droits
        Cartes sociales → Canal Facebook ou LinkedIn et cible OpenG7 ou OpenG20
            Statut, simulation, pause, date ou prochaine possibilité
            Erreur éventuelle et URL publique
            Revoir, modifier le créneau, préparer ou ouvrir les détails
    Avis lorsque les prestations sociales sont absentes ou non qualifiées
Dessous → Engagements du dossier
    Offre acceptée et obligations courantes
    Échéances et durée de chaque prestation
    Qualification historique si admissible
    Ajustement ou dispense avec motif et confirmation
    Audit historique du dossier
Bas du parcours → Lien vers le moteur et rappel d’autorisation
Après le parcours → Paramètres avancés de fiche, repliables
    Adresse publique, résumé, aperçu
    Sous-accordéon déclaration historique
        Destination, statut manuel, canaux, URL, notes, enregistrer
Superposition → Tiroir de revue ou édition de livraison
```

La qualification historique peut saisir canal, cible, quantité, format, exigences de nom/présentation/logo, échéance/durée, preuve, motif et confirmation. Les ajustements portent notamment sur la destination, le format ou une dispense ; ils ne réécrivent pas silencieusement l’offre acceptée. Un résultat incertain bloque la répétition jusqu’à réconciliation.

Les cartes se répartissent selon l’espace disponible ; les commandes et données passent sur plusieurs lignes dans les petites largeurs. Le suivi manuel conserve une déclaration : le seul choix d’un statut publié ne constitue pas une preuve automatique qualifiée. Le lien Campagnes fournit la vue de prestation et de preuve ; le lien moteur fournit la vue d’exécution.

Sources : [parcours de publication dossier](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-publication.component.html) (l. 10, 83, 115 et 411), [paramètres fiche et déclaration](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-publication-panel.component.html), [engagements](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-commitments.component.html) (l. 90, 185 et 466), [reçu](../../apps/funding-web/src/app/features/funding/components/admin-preparation/admin-preparation-receipt.component.html).

### Qualité des commandites

Route : `/admin/fundraiser/sponsors/quality`. Responsabilité : séparer l’inventaire et le contrôle historique du travail courant sur un dossier. Le contenu est conditionné au propriétaire ; un autre rôle voit un message de droits requis. Cette page ne contient pas d’onglets ni d’éditeur des conditions commerciales.

```text
Haut → Titre, description et retour registre ou dossier
Bloc inventaire d’adoption
    Taille de page 25 ou 50
    Charger l’aperçu
    Résultats → Référence, classification, compteurs d’obligations,
                preuves qualifiées et déclarations historiques
    Lien vers chaque dossier et page suivante
Bloc audit historique du portefeuille
    Portée et explication
    Charger, filtrer
    Compteurs globaux et constats
    Liste des preuves
        Canal, cible, date, identité de preuve
        Lien vers le dossier concerné
        Constats, exigences observées, dernière revue
        Examiner la preuve
    Formulaire de revue sélectionnée
        Conclusion, raison, case de confirmation, enregistrer
    Résultat incertain → Vérification contrôlée
```

Les états distinguent chargement, erreur, absence de résultats, revue enregistrée et résultat incertain. Le même audit existe en portée dossier, avec un lien vers cette page ; les liens de retour conservent le contexte sans confondre inventaire et qualification commerciale. Les blocs s’empilent ; les contrôles se replient sur plusieurs lignes.

Sources : [page Qualité](../../apps/funding-web/src/app/features/funding/pages/admin-sponsors-quality-page/admin-sponsors-quality-page.component.ts), [inventaire](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-adoption.component.html), [audit historique](../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-historical-audit.component.html).

### Campagnes et prestations promises

Route : `/admin/fundraiser/campaigns`. Responsabilité : parcourir les prestations promises et examiner leur préparation, échéance, livraison et preuve. La page est un registre de prestations ; le template n’expose pas un éditeur général de campagnes marketing.

```text
Haut → Titre et introduction à gauche ; actualiser à droite
Dessous → Note de portée
Contexte éventuel → Dossier ou prestation ciblé ; afficher tout
Filtres → Recherche, canal, cible, état, tri, direction, appliquer
Registre
    En-tête → Nombre de prestations, dossiers de la page, regroupement par dossier
    Colonnes → Prestation promise, cible, préparation, état, échéance, preuve
    Lignes sélectionnables, regroupées par dossier si demandé
    Bas → Pagination
Sous le registre → Détail de la prestation sélectionnée
    En-tête → Entreprise, référence, canal, cible, numéro de passage
              Lien vers l’espace propriétaire de l’objet
    Gauche → Préparation du dossier intégrée
    Droite → Dates et format
        Prochaine étape, raison et responsabilité
        Lien livraison lorsque présente
        Contenu proposé ou absence de contenu
        Rappel de la portée d’autorisation
        Preuve, provenance, visibilité et lien admissible
```

Il n’y a pas d’onglets propres à cette page. Le détail se trouve sous la liste, et non dans un tiroir droit. États : destination invalide, chargement, erreur technique, refus, liste vide, aucune sélection, préparation conditionnelle, blocage, incertitude, erreur, livraison complète, preuve absente ou disponible.

Le détail utilise deux colonnes au-dessus de 1100 px et une seule en dessous. Les lignes deviennent trois colonnes sous 1100 px et deux sous 640 px, avec libellés mobiles. Les filtres ont trois colonnes par défaut, deux sous 640 px et une rangée étendue dès 1500 px.

Sources : [template Campagnes](../../apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-page.component.html) (l. 80, 190 et 428), [styles Campagnes](../../apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-page.component.css) (l. 376, 385 et 407).

### Accueil des publications

Route : `/admin/fundraiser/publications`. Responsabilité : orienter le travail entre brouillons, lots et calendrier, à partir d’une file commune. Ces trois espaces sont des routes ; ce ne sont pas trois panneaux d’un `tablist`.

```text
Haut → Titre et aide à gauche ; automate et actualiser à droite
Dessous → Objet ciblé éventuel et état manquant
Dessous → Chargement, erreur et notification d’action
Corps
    Zone principale → File de publication et accès aux lots
    Zone d’orientation → Brouillons, lots, calendrier
```

Sous 44 rem de conteneur, les trois liens s’empilent. Dès 44 rem, ils forment trois colonnes ; dès 60 rem, la file est à gauche et ces liens reviennent en colonne dans une zone droite de 18 rem. Sous 900 px, l’en-tête s’empile. Les vues route partagées maintiennent les éditions locales jusqu’à changement de contexte ou validation.

Sources : [page Publications](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.html) (l. 1 et 131), [styles Publications](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.css) (l. 146 et 152).

### Brouillons de publication

Route : `/admin/fundraiser/publications/drafts`. Responsabilité : préparer, éditer et revoir le contenu d’une reconnaissance avant sa mise en lot ou sa préparation d’envoi.

```text
Haut → Retour accueil publications
Dessous → Titre et aide ; Préparer, automate, actualiser
Corps → Panneau brouillons
    Si préparation ouverte → Commanditaires admissibles et sélection
    Liste et sélection des brouillons
    Brouillon → Identité commanditaire, état, contenu
        Actions de modération
        Édition du titre et du corps
        Options secondaires de publication
        Actions de revue, approbation, lot et préparation d’envoi
    États → Chargement, erreur, dates invalides, aucun brouillon, notification
```

Les formulaires et leurs options suivent l’espace disponible ; les commandes se replient et les vues masquées restent dans le composant partagé. Une approbation de brouillon n’est pas assimilée à une livraison externe réussie. La publication programmée et son autorisation sont suivies dans l’espace automate.

Sources : [entrée Brouillons](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.html) (l. 36 et 183), [panneau Brouillons](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-drafts-panel.component.html) (l. 38, 98, 154 et 289).

### Lots de publication

Route : `/admin/fundraiser/publications/batches`. Responsabilité : regrouper les brouillons et leur contexte d’exécution sans confondre lot préparé et envoi autorisé.

```text
Haut → Retour accueil ; titre ; Nouveau lot, automate, actualiser
Corps → Formulaire de nouveau lot lorsqu’ouvert
Dessous → Calendrier des lots et sélection
Tiroir droit → Lot sélectionné
    Identité, état, contenus et contexte
    Horaire ou créneau associé
    Actions et préparation d’envoi
    Options secondaires et résultats
```

États : chargement, erreur, absence de lot et erreur du détail. Le tiroir partagé devient pleine largeur sous 600 px ; le calendrier et les formulaires adaptent leurs colonnes. Le lien de préparation d’envoi conduit au contexte d’automatisation, où l’autorisation exacte est contrôlée.

Sources : [entrée Lots](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.html) (l. 57 et 206), [panneau Lots](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-batches-panel.component.html) (l. 6, 44, 51 et 170).

### Calendrier et créneaux éditoriaux

Route : `/admin/fundraiser/publications/calendar`. Responsabilité : gérer les créneaux éditoriaux, leur capacité et les objets de publication associés. Le calendrier de l’automate constitue une autre projection, centrée sur les livraisons.

```text
Haut → Retour accueil ; titre ; Nouveau créneau, automate, actualiser
Corps → Formulaire de créneau lorsqu’ouvert
Dessous → Calendrier des créneaux
Tiroir droit → Créneau sélectionné
    Identité, date et état
    Contenus, brouillons ou lots associés
    Paramètres, capacité et actions
    Préparer l’envoi lorsque disponible
```

États : chargement, erreur, date invalide, aucun créneau et erreur du détail. Le tiroir suit les dimensions communes et devient pleine largeur sous 600 px. La réservation d’un créneau ne suffit pas à approuver le contenu ni à confirmer sa publication.

Sources : [entrée Calendrier](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/admin-publications-page.component.html) (l. 76 et 230), [panneau Créneaux](../../apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-slots-panel.component.html) (l. 12, 87, 94 et 261).

### Automatisation des publications

Route : `/admin/fundraiser/publications/automation`. Responsabilité : gérer les livraisons exactes, leur autorisation, les flux et la résolution des incidents. L’état fournisseur, les preuves de livraison et les réglages globaux restent séparés.

```text
Haut → Retour publications
Dessous → Titre et aide à gauche ; calendrier et pause globale à droite
Dessous → Erreurs, notifications et contexte dossier ou livraison
Résumé → À revoir, programmées, exceptions, publiées sur la période affichée
Zone de travail large
    Gauche → Livraisons
        Vues → Revue | Programmées | Calendrier | Exceptions | Historique
            Tous ajouté seulement dans un contexte ciblé
        Filtre de flux et nouvelle livraison
        Liste de travaux ou calendrier de livraisons
    Droite → Réglages de l’automate et des flux
Sous cette zone → File des sources et pagination
Bas → Fiabilité, incidents et réconciliation
Tiroir droit de livraison
    État, sujet et modération
    Blocages contenu, média, revue, paiement ou incertitude
    Aperçu exact, sources et crédits requis
    Édition de contenu, format, média, destination et horaire
    Revue du commanditaire si applicable
    Actions d’autorisation ou résolution avec confirmations
```

Les vues sont des boutons filtrants avec `aria-pressed`, pas des sous-routes. La vue Tous est conditionnelle à `sponsorshipId` ou `deliveryId`. La zone des livraisons et les réglages sont empilés par défaut, puis passent en deux colonnes `1.75fr / minmax(18rem,1fr)` dès 68 rem de conteneur. Les compteurs passent de deux à quatre colonnes à 42 rem. Le tiroir partage le comportement mobile commun.

États : lecture en cours, erreur globale, objet ciblé absent, liste vide, simulation mock, livraison en revue, programmée, publiée, rejetée, annulée, échouée ou incertaine selon réponse serveur. Une modification de l’objet exact peut révoquer son autorisation ; un résultat fournisseur ambigu demande réconciliation avant nouvelle tentative. Les paramètres visibles ne prouvent pas qu’un compte externe réel est connecté.

Sources : [page Automatisation](../../apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-page.component.html), [vues conditionnelles](../../apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-page.component.ts) (l. 182), [styles Automatisation](../../apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-page.component.css) (l. 186 et 194), [tiroir Livraison](../../apps/funding-web/src/app/features/funding/components/admin-publications/publication-delivery-drawer.component.html).

### Factures et avoirs

Route : `/admin/fundraiser/invoices`. Responsabilité : consulter les documents émis et suivre leur transmission. Les documents financiers gardent leur snapshot d’émission ; renvoyer un document ne le réécrit pas.

```text
Haut → Titre à gauche
    Droite → Générer les factures manquantes, actualiser
Dessous → Contribution ciblée, chargement, erreur et résultat de génération
Résumé → Nombre de factures, total facturé, total crédité,
         courriels en échec, dernière mise à jour
Corps large
    Gauche → Liste de factures et sélection
    Droite → Détail de la facture
        Numéro, identité et actions aperçu ou PDF
        Données du document et lignes comptables
        Avoirs liés et téléchargement
        État courriel et renvoi de chaque document
        Destinataire corrigé et confirmation selon action
```

La disposition devient deux colonnes dès 60 rem de conteneur, avec liste plus étroite à gauche ; sinon le détail suit la liste. États : chargement, lecture échouée, dernier état connu signalé ancien, aucune sélection, génération ou renvoi en cours, succès/échec serveur. Une session révoquée efface le contexte privé.

La présentation `canManage` exclut le lecteur mais ne distingue pas toutes les mutations propriétaire. Ainsi, le bouton de génération peut être présenté à un opérateur alors que le contrat d’identité réserve le backfill au propriétaire. L’autorisation réelle doit être lue dans l’API ; ce décalage de présentation reste un point d’analyse, pas une preuve de contournement.

Sources : [page Factures](../../apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoices-page.component.ts) (l. 55, 70, 178 et 240), [styles Factures](../../apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoices-page.component.css) (l. 76), [détail documentaire](../../apps/funding-web/src/app/features/funding/pages/admin-invoices-page/admin-invoice-detail.component.html).

### Dépenses et allocations

Route : `/admin/fundraiser/expenses`. Responsabilité : tenir les allocations, leur description publique, leur avancement et leurs preuves. Le statut de visibilité et l’avancement de réalisation sont des champs distincts. Les mutations restent soumises aux droits propriétaire de l’API.

```text
Haut → Titre et actualiser
Dessous → Chargement, erreur et conflit de version
Résumé → Total, publiées, brouillons, montant publié
Espace de travail large
    Gauche → Registre
        Titre, recherche et filtre de statut
        Cartes d’allocation avec champs éditables et actions
        Inspection de la preuve
    Droite → Création d’une allocation
Champs de création ou édition
    Projet ou fournisseur, montant CAD, statut
    Date de publication si applicable
    Description publique et résultat attendu
    Avancement prévu, en cours ou livré
    URL, source et date de preuve publique
```

Les quatre métriques se répartissent progressivement selon le conteneur. Le registre et la création passent en deux colonnes avec un panneau droit de 21 rem dès 66 rem ; sinon la création suit le registre. États : aucune entrée, aucun résultat, lecture en cours, échec, mutation en cours et conflit. Les formulaires existent sans condition générale de rôle dans ce template ; l’API demeure la frontière d’autorisation. La publication d’une allocation exige sa confirmation métier.

Sources : [page Dépenses](../../apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-page.component.ts) (l. 54 et 115), [champs d’allocation](../../apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expense-form-fields.component.html), [styles Dépenses](../../apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-page.component.css) (l. 107, 119 et 129).

### Contrôle de la transparence

Route : `/admin/fundraiser/transparency`. Responsabilité : inspecter la projection qui alimente la transparence publique. Cette page présente des données ; elle n’offre pas un formulaire d’édition des dépenses.

```text
Haut → Titre et explication de la vue privée à gauche ; actualiser à droite
Dessous → Chargement ou erreur
Résumé → Agrégats publics et résumé des allocations
Dessous → Snapshot public et date de mise à jour
Bas → Allocations publiées
    Tableau et montants
    État sans dépense publique
```

Le contenu est centré à 78 rem maximum ; les cartes se répartissent selon les composants. La liste d’allocations utilise une région de défilement pour préserver les colonnes sur les petites largeurs. L’absence de données due à une erreur ne doit pas être interprétée comme une absence de financement.

Sources : [page Transparence](../../apps/funding-web/src/app/features/funding/pages/admin-transparency-page/admin-transparency-page.component.html), [résumé](../../apps/funding-web/src/app/features/funding/pages/admin-transparency-page/admin-transparency-summary.component.html), [snapshot](../../apps/funding-web/src/app/features/funding/pages/admin-transparency-page/admin-transparency-snapshot.component.html), [allocations publiées](../../apps/funding-web/src/app/features/funding/pages/admin-transparency-page/admin-transparency-allocations.component.html).

### Journal administratif

Route : `/admin/fundraiser/audit`. Responsabilité : rendre consultables les actions administratives et leur contexte, puis ouvrir leur inspection. La page ne modifie pas les faits financiers.

```text
Haut → Titre à gauche ; actualiser à droite
Panneau journal
    En-tête → Symbole, titre et compteur à gauche ; recherche à droite
    État → Chargement ou erreur
    Tableau → Action et résumé | acteur et entité | date
        Action sélectionnée → Inspecteur commun
    État vide → Journal vide ou aucun résultat ; effacer la recherche
    Bas → Date de mise à jour et pagination
```

Le contenu est centré à 78 rem. À 700 px ou moins, les styles adaptent la présentation des colonnes pour conserver le contexte lisible. La pagination ne s’affiche que si plusieurs pages sont disponibles. L’inspecteur reste un tiroir distinct de la liste.

Sources : [template Audit](../../apps/funding-web/src/app/features/funding/pages/admin-audit-page/admin-audit-page.component.html), [styles Audit](../../apps/funding-web/src/app/features/funding/pages/admin-audit-page/admin-audit-page.component.css) (l. 261).

### File courriel

Route : `/admin/fundraiser/email-queue`. Responsabilité : suivre les transmissions et résoudre les erreurs sans créer un nouveau fait métier à chaque reprise. Les destinataires restent des données privées.

```text
Haut → Titre et actualiser
Dessous → Contexte ciblé, chargement, erreur ou données anciennes signalées
Résumé → Compteurs de la file
Filtres → Statut et recherche destinataire, sujet ou modèle
Messages
    Identité du message, destinataire, sujet ou type et état
    Détails des tentatives et erreur sûre
    Inspection et reprise lorsque permise
    Résultat de reprise
    Si résultat incertain → Preuve puis décision envoyé ou non envoyé
```

Le filtre propose tous, incertain, échec, en file, envoi et envoyé. La reprise standard est désactivée pour les états envoyé, incertain et en cours d’envoi. L’incertitude appelle une décision explicite de réconciliation. Les listes et contrôles se replient dans une colonne principale de 88 rem maximum. Une session révoquée retire les données et confirmations privées ; un échec technique peut conserver un dernier état connu explicitement signalé.

Sources : [page Courriels](../../apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-page.component.ts) (l. 48), [filtres](../../apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-filters.component.html), [messages et réconciliation](../../apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-messages.component.html) (l. 98 et 118).

### Configuration et état des services

Route : `/admin/fundraiser/setup`. Responsabilité : exposer configuration observée, disponibilité, actions préparatoires et diagnostic d’exploitation. Le lien existe dans la navigation générale ; les lectures privées de configuration sont contrôlées par l’API et restent réservées au propriétaire selon le contrat d’identité.

```text
Haut → Titre et introduction ; Guide et Actualiser
Dessous → Chargement, erreur de lecture ou droits
Dessous → Environnement et date de mise à jour
Navigation par ancres → Vue générale, identité, services, configuration,
                        sauvegardes, activité
Dessous → Readiness et inspection des systèmes
Dessous → Recommandation de prochaine action
Dessous → Guide identité avec observations privées
Espace de travail large
    Gauche → Services
        Stripe et détails de configuration observée
        SMTP et expéditeur
            Adresse de test, demande de test, suivi et résultat
            Lien message en file si disponible
        File d’envoi et reprises
        Base de données
        Stockage média
    Droite → Checklist et nombre de points complets
              Activité administrative et lien Audit
Dessous → Sauvegardes
    État service, dernière réussite, disponibilité
    Guide d’activation si non configuré
    Demande de sauvegarde et suivi du reçu selon disponibilité
    Historique, détails de preuve, guide de récupération
Bas → Configuration de l’environnement
Tiroir → Visite guidée, précédent, suivant ou terminer
```

Cette navigation fait défiler des sections ; ce ne sont pas six onglets qui masquent les autres sections. L’espace services/checklist devient deux colonnes dès 68 rem de conteneur, sinon s’empile. États : chargement, erreur, accès refusé, service non configuré, dégradé ou disponible, test courriel en cours, sauvegarde en file/en cours/réussie/échouée/inconnue, résultat incertain et données anciennes. Le guide de récupération n’exécute pas à lui seul une restauration. Une observation de configuration ou un test de santé ne remplace pas un parcours fournisseur complet.

Sources : [template Configuration](../../apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-page.component.html), [services](../../apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-services.component.html), [sauvegardes](../../apps/funding-web/src/app/features/funding/components/admin-backups/admin-backups.component.html), [styles Configuration](../../apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-page.component.css) (l. 100).

### Comptes et sessions administratives

Route : `/admin/fundraiser/access`. Responsabilité : gérer les comptes nominatifs et révoquer leurs sessions. L’API exige le propriétaire ; l’absence de lien pour les autres rôles ne constitue pas cette sécurité.

```text
Haut → Retour cockpit
Dessous → Titre et aide
Dessous → Erreur et chargement
Espace large
    Gauche → Comptes et sélection
    Droite → Éditeur de compte
        Nouveau compte
        Subject, non modifiable après création
        Nom affiché, rôle, désactivation
        Case de confirmation et enregistrer
Dessous → Sessions des comptes
    Identité et date de chaque session
    Révoquer
    Confirmation locale de la session visée, annuler ou révoquer
```

Les comptes et l’éditeur sont côte à côte dès 60 rem de conteneur, sinon empilés. La révocation utilise une zone de confirmation dans la page, avec retour de focus ; elle n’est pas décrite comme un tiroir. La modification d’un compte ferme ses sessions et le dernier propriétaire actif reste protégé par l’API. États : lecture ou mutation en cours, erreur, refus métier, confirmation non cochée, session expirée/révoquée et reconnexion.

Sources : [page Accès](../../apps/funding-web/src/app/features/funding/pages/admin-access-page/admin-access-page.component.ts) (l. 41), [éditeur](../../apps/funding-web/src/app/features/funding/pages/admin-access-page/admin-access-editor.component.html), [sessions et confirmation](../../apps/funding-web/src/app/features/funding/pages/admin-access-page/admin-access-sessions.component.html), [styles Accès](../../apps/funding-web/src/app/features/funding/pages/admin-access-page/admin-access-page.component.css) (l. 40).

### Guide administratif transversal

Responsabilité : expliquer les pages et les parcours, montrer les repères existants et conserver une progression de lecture. Le guide global appartient au shell ; l’aide dossier et la visite Configuration ont leurs propres contenus locaux.

```text
Shell, sous la barre globale → Ouvrir le guide
Carte ouverte → Fixée à droite, en haut ou en bas selon placement choisi
    Barre → Fermer, déplacer, page courante
    Choix de mode
        Découverte → Lire, choisir, vérifier pour la page courante
            Montrer le repère, précédent, suivant, recommencer, pause, reprise
        Parcours paiement → Explication du parcours de contribution
        Passage automatique → Préparation et progression conditionnelles
        Explorer les parcours → Six parcours de commandite
            Accord → Source, proposition, qualification et confirmation
            Préparation → Prestations, préparation, brouillon
            Autorisation → Contenu exact, horaire et décision
            Livraison → État, responsabilité et preuve
            Fiche site → Présentation, aperçu et visibilité
            Historique → Déclaration et enregistrement des métadonnées
    Bas → Confidentialité, stockage de progression, effacer
```

La carte est repliée par défaut. Ouverte, elle est fixée à 6 rem du haut et 1,25 rem du bord droit par défaut ; le placement bas utilise une variable adaptée aux contrôleurs. Sa hauteur est limitée et son contenu défile. Sur téléphone, elle prend presque toute la largeur et conserve une marge. Le catalogue de découverte référence chaque page protégée, dont Qualité et les sous-espaces Publications. Montrer un repère de lecture ne clique pas une action sensible ; les préparations ou confirmations conservent les droits métier.

Sources : [template Guide](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.html), [styles Guide](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.css) (l. 13, 33 et 205), [catalogue de pages](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.ts), [six parcours](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.catalog.ts).

### Recherche, inspection et panneaux partagés

Ces surfaces sont transversales au shell et conservent le contexte de leur déclencheur. Elles ne constituent pas des routes supplémentaires.

```text
Recherche globale → Bouton de barre supérieure ou Ctrl/⌘ K
    Dialogue centré
        Titre, fermeture, saisie et aide
        États et couverture partielle
        Résultats regroupés par contribution
            Dossier, contribution, facture, publications liées
            Aperçu de facture
        Pagination
Inspecteur → Tiroir droit
    Référence et états de lecture
    Champs, historique, facture, média ou preuve selon le sujet
    Lien vers la page propriétaire et retour
Confirmation globale → Tiroir droit
    Cible, conséquence, annuler ou confirmer
Modération → Déclencheur local puis panneau de décision
    Snapshot exact, motifs, niveau et mesure
    Raison privée distincte de l’explication commanditaire
    Confirmation et résultat serveur
Contrôleur → Déclencheur sous barre globale
    Menu, choix du contrôleur, édition et guide
    Simulateur et scénarios uniquement si sandbox disponible
```

La recherche est centrée et limitée à 46 rem avec défilement. Les tiroirs communs sont fixés à droite, hauts de 100dvh, larges de 40 rem ou 92vw ; la variante large atteint 90 rem ou 98vw. Sous 600 px, le tiroir prend toute la largeur. Son en-tête est sticky et un footer fixe peut être demandé. Les erreurs distinguent selon le composant chargement, droits insuffisants, objet absent, indisponibilité, contenu modifié et résultat incertain. La présence de ces surfaces permet de décrire le placement et les responsabilités ; elle ne remplace pas les contrôles API ni les preuves d’exécution.

Sources : [recherche](../../apps/funding-web/src/app/features/funding/components/admin-search/admin-global-search.component.html), [styles recherche](../../apps/funding-web/src/app/features/funding/components/admin-search/admin-global-search.component.css) (l. 24), [inspecteur](../../apps/funding-web/src/app/features/funding/components/admin-inspector/admin-inspector.component.html), [tiroir partagé](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-drawer.component.css), [confirmation](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-confirmation.component.ts), [feature modération](../../apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-feature.component.html), [panneau modération](../../apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-panel.component.html), [contrôleur](../../apps/funding-web/src/app/features/funding/components/admin-controller/admin-controller.component.html).

<a id="fonctions-transversales"></a>

## Fonctionnalités transversales et propriétaires

Les pages précédentes sont les points d'entrée visuels. Les fonctions ci-dessous
relient plusieurs espaces. Une même fonction conserve son propriétaire même
lorsqu'elle est accessible depuis plusieurs boutons.

### Présentation et assistance partagées

Le [service SEO](../../apps/funding-web/src/app/features/funding/services/funding-seo.service.ts)
possède les titres, métadonnées et URL canoniques des pages publiques, sans zone
visible propre. La page introuvable applique aussi son traitement d'indexation.

| Fonction                             | Position et consommateurs                                                                                                | Propriétaire technique                                                                                                                                                                                                          | Responsabilité et états                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Langue FR/EN                         | En-tête public et barre supérieure admin ; textes de toutes les pages.                                                   | [FundingI18nService](../../apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts), catalogues `src/assets/i18n/`.                                                                                          | Locale publique par route, préférence admin conservée dans le navigateur, catalogues spécialisés chargés par les features. Les slugs publics anglais conservent les noms français sous `/en`.                                                                                                                                                                                                                |
| Structure responsive                 | Grilles et ordre de lecture de chaque page ; navigation admin en colonne ou en haut.                                     | CSS des pages, [layout admin](../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.css), styles partagés.                                                                             | Les seuils varient ; les cartes, tableaux et zones fixes doivent se lire avec les conditions relevées dans leur page.                                                                                                                                                                                                                                                                                        |
| Rendu initial et routes inconnues    | Avant interaction sur les pages pré-rendues ; page 404 au centre du shell public.                                        | [Routes serveur](../../apps/funding-web/src/app/app.routes.server.ts), [routes Web](../../apps/funding-web/src/app/app.routes.ts), [nginx.conf](../../apps/funding-web/nginx.conf).                                             | 25 routes statiques pré-rendues dans le build de cette passe. Le suivi privé et les routes admin hors diagnostic utilisent le rendu client. Le statut HTTP des URL inconnues dépend également du serveur Web.                                                                                                                                                                                                |
| Accessibilité                        | Liens d'évitement, focus, noms accessibles, annonces d'état, contrôles et dialogues.                                     | Composants Web ; [primitives admin](../../apps/funding-web/src/app/features/funding/components/admin-ui/).                                                                                                                      | Responsabilité partagée : ordre DOM, restauration du focus, clavier et affichage responsive. La réussite de tests ciblés ne qualifie pas toutes les pages.                                                                                                                                                                                                                                                   |
| Recherche globale admin              | Déclencheur dans la barre supérieure ; dialogue centré superposé.                                                        | [Recherche](../../apps/funding-web/src/app/features/funding/components/admin-search/admin-global-search.component.ts), API de recherche.                                                                                        | Regrouper contribution, commandite, facture et publications, paginer, ouvrir une page ou un aperçu. États initial, chargement, vide, erreur, interdit, limité et indisponible.                                                                                                                                                                                                                               |
| Inspection admin                     | Tiroir superposé ouvert depuis une liste, un lien ou la recherche.                                                       | [Inspecteur](../../apps/funding-web/src/app/features/funding/components/admin-inspector/admin-inspector.component.ts), [tiroir](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-drawer.component.ts). | Aperçu facture/PDF, média, preuve ou historique ; retour au contexte et accès à la page complète. Distinguer absent, interdit et indisponible.                                                                                                                                                                                                                                                               |
| Confirmations sensibles              | Tiroir superposé prioritaire sur le contexte courant.                                                                    | [Confirmation](../../apps/funding-web/src/app/features/funding/components/admin-ui/admin-confirmation.component.ts), service de confirmation et validation API de chaque action.                                                | Afficher action et cible, accepter ou annuler ; conserver les contrôles de rôle, version et confirmation côté serveur. L'ouverture ne déclenche pas l'action.                                                                                                                                                                                                                                                |
| Guide transversal                    | Déclencheur sous la barre supérieure ; guide ouvert flottant à droite, en haut ou en bas selon mode.                     | [AdminGuidance](../../apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.ts), catalogue de parcours.                                                                                  | Navigation guidée, repères, progression, préparation et retour au contexte ; une visite d'étape ne confirme pas son accomplissement métier.                                                                                                                                                                                                                                                                  |
| Assistant contextuel et conversation | Page Assistant ; contexte principal à gauche et aide à droite sur grand écran lorsqu'un dossier est sélectionné.         | [Contexte API](../../apps/funding-api/src/admin-assistant/context.service.ts), [outils](../../apps/funding-api/src/admin-assistant/tool-registry.ts), [configuration](../../apps/funding-api/src/admin-assistant/config.ts).    | Les faits et recommandations déterministes sont distincts de la conversation optionnelle. Les fournisseurs de conversation implémentés sont `disabled` et `mock` ; aucun LLM externe n'est raccordé. Les outils de requête sont en lecture seule. Les propositions passent par un endpoint séparé, sans sauvegarde ni envoi. L'action métier éventuellement ouverte ensuite conserve sa confirmation propre. |
| Préparation privée assistée          | Outils de préparation du dossier, du guide et des vérifications de lot ; détails ouverts à la demande.                   | [PreparationAssistanceService](../../apps/funding-api/src/preparation-assistance/service.ts), contrôleurs de préparation Web.                                                                                                   | Préparer et faire relire des suggestions privées ; ce service n'a pas de port Stripe, courriel, publication ou modèle externe. Son accès est contrôlé par la politique API.                                                                                                                                                                                                                                  |
| Pilotage clavier et manette          | Page Pilotage, commandes contextuelles, surfaces radiale/deck et manette virtuelle conditionnelle.                       | [Runbook de pilotage](../operations/admin-pilotage.md), [commandes du domaine](../../packages/funding-core/src/admin-pilotage.ts), services Web et API pilotage.                                                                | Normaliser les intentions, respecter panneau prioritaire, retour au neutre, rôle, cible/version, confirmation et reçu. Le résultat incertain demande réconciliation. Une simulation ne qualifie pas une manette physique.                                                                                                                                                                                    |
| Activité des contributions           | Barre supérieure admin : bouton d'activité, notifications dans l'espace réservé de l'en-tête, détail privé à la demande. | [ContributionActivityComponent](../../apps/funding-web/src/app/features/funding/components/contribution-activity/contribution-activity.component.ts), service d'activité.                                                       | Présenter les faits confirmés, historique et cartouche privée ; les notifications restent masquées lorsqu'un dialogue est ouvert. Le marqueur de présentation propre à l'acteur ne modifie pas le dossier.                                                                                                                                                                                                   |
| Musique du site                      | Bouton fixe en bas à droite du Web public.                                                                               | [SiteMusicComponent](../../apps/funding-web/src/app/features/funding/components/site-music/site-music.component.ts).                                                                                                            | Lecture/pause et politique navigateur ; une erreur audio rend le contrôle indisponible et le masque. Désactivé sur les routes admin. Le bouton est une surcouche, pas un élément du pied de page.                                                                                                                                                                                                            |

### Données métier et effets externes

| Fonction                           | Position et consommateurs                                                                        | Propriétaire technique                                                                                                                                                                                                                  | Responsabilité et frontière                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session et identité                | Connexion, diagnostic OIDC, barre admin et page Accès ; toutes lectures privées administratives. | [Session Web](../../apps/funding-web/src/app/features/funding/services/funding-admin-session.ts), [identité API](../../apps/funding-api/src/admin-identity.ts).                                                                         | OIDC et MFA vérifiés côté fournisseur/API, sessions révocables ; mode token local distinct. Le suivi commanditaire utilise son lien/token privé distinct. Expiration ou révocation retire le contexte privé et mène à la reconnexion.                                              |
| Autorisations                      | Visibilité des liens et actions dans les pages ; contrôle sans zone propre à l'API.              | [Politique de rôles](../../apps/funding-api/src/admin-identity/policy.ts) et validations de chaque endpoint.                                                                                                                            | Le rôle et la présentation sont deux contrôles distincts. Les lectures de configuration, accès, destinataire de renvoi et plusieurs inventaires sont réservées au propriétaire.                                                                                                    |
| Contrats et règles partagés        | Sans zone propre ; formulaires, projections, API et workers.                                     | [funding-core](../../packages/funding-core/src/index.ts), [funding-models](../../packages/funding-models/src/index.ts), [funding-ui](../../packages/funding-ui/src/index.ts), [funding-i18n](../../packages/funding-i18n/src/index.ts). | Règles et calculs purs, types/états, primitives visuelles et conventions de locales ; les packages n'accèdent pas à Stripe ou PostgreSQL et ne possèdent pas les pages.                                                                                                            |
| Contribution et Checkout           | Formulaire public, offre commanditaire, redirection Stripe externe ; lecture du retour.          | Contrat [checkout](../../packages/funding-core/src/checkout.ts), API Funding et adaptateur Stripe.                                                                                                                                      | Valider montant entier en unités mineures, devise, type et consentements, figer l'offre puis créer Checkout. La redirection de succès reste informative.                                                                                                                           |
| Confirmation du paiement           | Statuts publics/privés, totaux et listes admin ; réception sans zone Web propre.                 | API webhook, normalisation et persistance ; Stripe est autoritaire pour le fait de paiement.                                                                                                                                            | Signature, déduplication, répétition/retard/ordre, enrichissement des frais. Aucun clic ou état navigateur ne crée le fait payé.                                                                                                                                                   |
| Journal, frais et transparence     | Totaux publics, contributions/dépenses et page Transparence admin.                               | API/persistance et règles [financières](financial-rules.md).                                                                                                                                                                            | Devise explicite, faits confirmés et estimations distingués, journal traçable, projection publique filtrée. Une erreur de chargement ne signifie pas un montant nul.                                                                                                               |
| Factures, avoirs et remboursements | Factures, Finances du dossier, inspections et confirmations.                                     | API documents, stockage/PDF, file courriel et adaptateur Stripe pour le remboursement.                                                                                                                                                  | Snapshot émis stable ; remboursement processeur, avoir et envoi documentaire sont des faits distincts. Les actions financières réservées exigent droits, cible et confirmation.                                                                                                    |
| Engagements et prestations         | Campagnes, résumé de l'onglet Publication, préparation et contrôle Qualité.                      | Contrats [engagements](../../packages/funding-core/src/sponsorship-commitments.ts) et [preuves](../../packages/funding-core/src/sponsorship-fulfilment.ts), services API.                                                               | Offre figée, qualification de l'historique, obligations, échéances et preuves ; un statut visible ou déclaré ne constitue pas automatiquement une prestation acquittée.                                                                                                            |
| Médias et droits d'usage           | Suivi privé, Fiche et médias, revue en lots et composition de publication.                       | Contrats médias, stockage privé/public et services API.                                                                                                                                                                                 | Contrôler fichier, référence, usage, consentement, revue et version avant exposition. L'analyse technique Sharp est implémentée ; vision/OCR sont `not_configured` dans la composition actuelle du [worker](../../apps/funding-api/src/sponsor-media-analysis/worker.ts).          |
| Modération                         | Outil du dossier et panneau transversal ; échanges privés du suivi commanditaire.                | Services de modération et [règles commandites](sponsorship-rules.md).                                                                                                                                                                   | Version exacte, motifs, note interne distincte du message externe, décisions indépendantes lorsqu'exigées, corrections et réexamen. Une correction ne rétablit pas seule la publication.                                                                                           |
| Visibilité du site                 | Annuaire public et cartes ; décision dans l'onglet Publication du dossier.                       | API de visibilité et projection publique.                                                                                                                                                                                               | Paiement, revue, consentement, éligibilité média et décision de visibilité restent séparés. Une approbation sociale ne rend pas automatiquement la fiche publique.                                                                                                                 |
| Publication éditoriale et sociale  | Publications/drafts, lots, calendrier, automatisation et suivi du dossier.                       | [Adaptateurs de publication sociale](../../apps/funding-api/src/social-publication.service.ts), [fournisseur d'automatisation](../../apps/funding-api/src/publication-automation/provider.ts), workers et politiques.                   | Des adaptateurs HTTP Facebook et LinkedIn existent avec modes désactivé/simulé/réel. Autorisation du contenu exact et des sources, destination, média, mode et horaire avant envoi ; issue ambiguë mise en quarantaine et réconciliée. Configuration active à vérifier séparément. |
| Courriels et récupération d'accès  | Support, suivi privé, outils dossier, File courriel et Configuration.                            | API et file persistante ; SMTP selon configuration.                                                                                                                                                                                     | Enqueue logique idempotente, reprise bornée, destinataire vérifié, correction/renvoi confirmés lorsque requis. Succès d'enqueue, tentative et remise fournisseur restent distincts.                                                                                                |
| Audit, reçus et historique         | Page Audit, Historique du dossier, inspections et reçus d'opérations.                            | API/persistance, contrats [audit](../../packages/funding-core/src/admin-audit.ts) et commandes.                                                                                                                                         | Acteur, action, cible, date, résultat et corrélation ; pas de secret ni corps privé inutile. Réconcilier une issue incertaine avant nouvelle tentative.                                                                                                                            |
| Exploitation et sauvegardes        | Diagnostics et outils conditionnels de Configuration ; reste sans zone publique.                 | API d'exploitation, stockage et scripts propriétaires.                                                                                                                                                                                  | Les contrôles d'interface ne prouvent pas une sauvegarde restaurable, une configuration active ou une qualification de production. Les opérations réelles conservent leur autorisation séparée.                                                                                    |

### Frontières entre les dimensions d'un dossier

| Dimension               | Fait attendu                                                                    | Surfaces principales                                                  |
| ----------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Paiement                | Confirmation processeur conservée côté serveur.                                 | Accueil/retour, suivi privé, Contributions, Finances.                 |
| Offre et engagements    | Termes acceptés et obligations qualifiées.                                      | Contribution entreprise, préparation, Campagnes, Qualité.             |
| Consentement et droits  | Choix explicites et droits d'usage conservés.                                   | Formulaire et suivi privé, Fiche et médias, contrôles de publication. |
| Revue                   | Décision administrative sur la version du contenu examiné.                      | Dossier, modération, À traiter et pilotage.                           |
| Visibilité Web          | Décision de projection dans l'annuaire public.                                  | Publication du dossier, Commanditaires publics.                       |
| Autorisation éditoriale | Approbation d'un contenu/d'une destination/d'un horaire exacts.                 | Publications et automatisation.                                       |
| Livraison et preuve     | Résultat externe confirmé ou preuve qualifiée, avec issue incertaine explicite. | Campagnes, Publication du dossier, calendrier et incidents.           |
| Communication           | Message en file, tenté ou remis, avec son propre statut.                        | File courriel, outils de suivi, notifications.                        |

Ces dimensions évoluent séparément. Leur présence simultanée dans une carte ou
un en-tête n'autorise pas à en déduire automatiquement les autres états.

<a id="analyse-lacunes"></a>

## Utilisation pour une analyse des lacunes

L'analyse suivante peut citer la route, la zone et sa position pour chaque constat.
Un défaut de comportement démontré, une fonction absente, une amélioration de
présentation et une information à vérifier sont quatre résultats différents.

```text
Analyse le blueprint fonctionnel et visuel OpenG7 ci-dessus.

Pour chaque lacune proposée, donne :
    1. La page, la route, la zone, l'onglet et la position concernés.
    2. Le rôle et le besoin utilisateur affectés.
    3. Le comportement décrit et le problème précis que tu en déduis.
    4. La preuve dans le blueprint et les points à vérifier dans le code ou l'UI.
    5. L'impact, la priorité et un critère de réception concret.
    6. Le propriétaire existant à faire évoluer et les consommateurs concernés.

Examine :
    Couverture des parcours et responsabilités sans propriétaire identifié.
    Découverte des fonctions, profondeur de navigation et libellés des onglets.
    Cohérence des zones, priorité des actions et densité à l'écran.
    Différences mobile/ordinateur, surcouches, clavier et gestion du focus.
    Vide, chargement, erreur, accès refusé, données partielles et résultat incertain.
    Doublons de responsabilité et usages des fonctions transversales.
    Séparation des faits financiers, consentements, revue et publication.
    Cohérence entre affichage des droits et autorisation serveur.

N'invente pas de fonctionnalité livrée, de résultat de test ou de configuration
de production. Une absence dans cet inventaire est une question à vérifier avant
de devenir un défaut certain du produit. Préserve les frontières et invariants
du produit dans les améliorations proposées.
```

<a id="validation-blueprint"></a>

## Vérifications et limites de cet état

Les changements applicatifs inventoriés sont enregistrés dans `b00ad2b2`. Les
vérifications de cette passe ont été exécutées le 18 octobre 2026, heure de
Toronto. Les tests Node, le build Angular final et le lint ont aussi été exécutés
sous Node 22.23.3, avec Yarn 4.9.4.

| Vérification                                                          | Résultat et portée                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn test`                                                           | 7 210 tests recensés : 7 202 réussis, 8 ignorés, aucun échec. Compilation TypeScript incluse.                                                                                                                                                      |
| `yarn lint`                                                           | Aucun échec ; un avertissement préexistant de directive ESLint inutile dans `scripts/smoke-public.mjs`.                                                                                                                                            |
| `yarn workspace @openg7/funding-web build --configuration production` | Réussi, 25 routes pré-rendues. Avertissement de taille : bundle initial 898,39 ko pour un budget d'avertissement de 800 ko.                                                                                                                        |
| Compilation des tests admin UI et TypeScript global sans émission     | Réussie ; cela vérifie les types, pas l'exécution des scénarios.                                                                                                                                                                                   |
| `node scripts/check-e2e-selection.mjs`                                | Réussi : 22 routes admin, 18 garanties, 150 fichiers sélectionnés. Le registre inclut Qualité et son scénario de lecture réelle.                                                                                                                   |
| Parcours Playwright ciblés sur le Web compilé                         | 29 réussis : Assistant contextuel, retour dossier, campagnes, Qualité et rôles, paramètres de publication, modération, outils optionnels, seuil 1439/1440 px et dispositions mobile/ordinateur, FR/EN. API interceptées avec données synthétiques. |
| Inspection de captures                                                | Dossier commanditaire en 1536 px et 390 px, Assistant contextuel en 1536 px. Les autres positions restent établies par les templates et CSS indiqués.                                                                                              |
| Format et documentation                                               | Prettier ciblé, `node scripts/check-project-standards.mjs`, `node scripts/check-agent-docs.mjs`, liens locaux du blueprint et `git diff --check`.                                                                                                  |

La sélection des 29 cas navigateur peut être reproduite depuis la racine :

```powershell
node node_modules/@playwright/test/cli.js test `
    --config tests/playwright-admin-ui.config.mjs `
    admin-sponsorship-progress.spec.ts admin-campaigns.spec.ts admin-assistant-context.spec.ts `
    --grep 'sponsorship quality|publication settings|publication benefit|header moderation|context composition|exact Assistant|dedicated workspace|campaigns show|campaign deep link|publication bridge keeps one detailed|dossier composition|1439/1440|readers retain|optional access|leaving the Assistant'
```

Le scénario d'acceptation réel enrichi pour Qualité est compilé et découvert,
sans nouvelle exécution Docker/API/PostgreSQL dans cette passe. Les validations
décrites ne qualifient pas une configuration de production, un envoi SMTP réel,
une publication sociale réelle ou une manette physique. Aucun déploiement ni
appel à un fournisseur réel n'a été effectué pour ce blueprint.
