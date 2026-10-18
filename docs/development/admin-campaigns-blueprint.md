# Blueprint — Opérations · Campagnes

Inventaire initial au **18 octobre 2026**, révision `bc593f7f`. Ce document décrit
les surfaces et les changements proposés. L'évolution appliquée de CAM-P08 et des
entrées contextuelles est précisée ci-dessous ; les autres propositions restent
à réaliser. L'analyse ne modifie aucune donnée. Voir la
[synthèse des trois surfaces](admin-operations-blueprint.md), le
[Guide](admin-guide-blueprint.md) et le
[dossier de commandite](admin-sponsorship-dossier-blueprint.md).

## Responsabilité et unité de travail

La route `/admin/fundraiser/campaigns` est une **file de suivi des prestations
promises**, issues d'achats de commandite ayant un paiement confirmé et un accord
enregistré. Une ligne correspond à une obligation précise : dossier, canal,
destination et numéro de passage. Elle ne correspond ni à une entreprise entière,
ni à un lot de publication, ni à une campagne éditoriale autonome. Il n'existe pas
ici d'action « Créer une campagne » ni de gestion d'une entité campagne. Sources :
[contrat C4][C4], [projection C5][C5].

**La page ne comporte aucun onglet.** Elle présente une liste et, en dessous, le
détail sélectionné. Ce détail contient deux colonnes : le poste de préparation
global du dossier et le contenu/la livraison de la prestation. Les volets natifs
`details` du bon sont des dépliants, pas des onglets. Les onglets cités dans les
destinations appartiennent au dossier Commandites. Sources : [C1][C1], [C2][C2],
[P1][P1].

La responsabilité principale est de rendre visibles **le prévu, le prochain
intervenant et la preuve de réalisation**. L'existant ajoute une responsabilité
secondaire : approuver la préparation complète d'un dossier depuis le détail
d'une seule prestation. Cette différence d'échelle est le principal point de
rangement à traiter.

**Évolution appliquée** : le volet exact **Détails de l'accord et traçabilité**
est conservé seulement ici, dans CAM-P08. Le bon reçoit `detailsMode="inline"` ;
Commandites utilise `hidden` et le Guide `campaigns` avec une commande de navigation.
Les autres volets et décisions du bon ne changent pas. Le [contrat d'entrée contextuelle](../technical/admin-campaigns.md#entree-contextuelle-et-details-de-laccord)
borne la liste par dossier et, si connu, par obligation exacte avant pagination.
Une sélection du même dossier est reprise ; sans sélection, un résultat unique
est choisi, plusieurs résultats demandent un choix et zéro reste explicite.

Légende des effets : **L** lecture serveur ; **N** navigation ; **I** interaction
locale sans décision métier ; **P** préparation privée persistée ; **D** décision
persistée. Une lecture, un dépliant ou un changement de sélection ne confirme
aucun paiement, ne qualifie aucun accord et n'autorise aucune publication.

## Blueprint de la page sans onglet

Les identifiants `CAM-Z…` et `CAM-A…` sont des repères documentaires ; ils ne
remplacent pas les hooks `data-og7` existants.

```text
Coquille administrative commune
└── Campagnes — aucun onglet
    ├── En-tête et note de périmètre
    ├── Filtres de la file → Appliquer
    ├── Liste d'obligations
    │   ├── Total global / dossiers sur la page / regroupement local
    │   ├── Lignes par prestation ou état de lecture
    │   └── Pagination des prestations
    └── Détail de l'obligation sélectionnée
        ├── Identité de la prestation → dossier propriétaire
        ├── Poste de préparation → DOSSIER ENTIER
        │   ├── Bon / offre / contrôles / assistance / contenu exact
        │   └── Approbation du dossier / trace / historique
        └── Contenu et livraison → OBLIGATION SÉLECTIONNÉE
            ├── Faits promis et programmation
            ├── Prochaine étape → livraison propriétaire
            ├── Aperçu de contenu actuel
            └── Preuve qualifiée → publication livrée
```

<!-- prettier-ignore -->
| Zone | Contenu présent et responsabilité | Périmètre réel | Propriétaire / équivalent | Sources |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| CAM-Z00 · Coquille administrative | Menu, recherche globale, nouveau passage, activité des contributions, Assistant, langue, Guide, manette ; héberge aussi confirmation, inspecteur et panneau de modération. | Transversal à l'administration, pas propre aux campagnes. | `AdminLayoutComponent` et ses composants déjà partagés. Inventaire commun dans les autres blueprints. | [C0][C0] |
| CAM-Z01 · En-tête | « Engagements commanditaires », « Campagnes », explication de la page, Actualiser. Donne la mission et l'accès à une lecture récente. | Ensemble de la sélection appliquée. | Page Campagnes. | [C1][C1] |
| CAM-Z02 · Note de périmètre | Explique le tri sur les préparations approuvées à jour et la présence des prestations à venir sous réserve d'approbation. | Règle de lecture de la file ; aucune autorisation implicite. | Page Campagnes ; règle serveur de préparation. | [C1][C1], [C5][C5] |
| CAM-Z03 · Formulaire de filtres | Recherche de commanditaire/référence, canal, destination, état de livraison, tri, ordre et Appliquer. La saisie reste un brouillon local jusqu'à la soumission. | Ensemble des prestations côté serveur, avant pagination. | Page + façade `AdminCampaignsStore` + contrat de requête partagé. | [C1][C1], [C2][C2], [C4][C4], [S1][S1] |
| CAM-Z04 · En-tête de liste | Titre « Publications promises », total de prestations de la requête, nombre de dossiers distincts sur la page et case Regrouper par dossier. | Le total est global à la requête ; le compte des dossiers et le regroupement sont locaux à la page. | Page Campagnes ; fonction de regroupement existante. | [C1][C1], [C2][C2], [C3][C3] |
| CAM-Z05 · Résultat / état de lecture | Chargement, erreur, refus, indisponibilité, vide ou lignes. Le contenu précédent est retiré pendant une nouvelle lecture. | Lecture privée et état de transport, distincts de l'état métier d'une prestation. | Store et façade ; rendu local. | [C1][C1], [S1][S1], [S2][S2] |
| CAM-Z06 · Groupes de dossiers | Nom de l'entreprise, référence et séries de lignes contiguës d'un même dossier. Le regroupement conserve l'ordre du serveur. | Présentation de la page courante ; un même dossier peut former plusieurs groupes si le tri intercale d'autres dossiers. | `groupCampaignRows`, pas un groupe métier persistant. | [C3][C3] |
| CAM-Z07 · Ligne de prestation | Canal, passage/quantité, destination, état de préparation du dossier, état du workflow, échéance et présence de preuve. Nom/référence sont répétés si le regroupement est désactivé. | **Obligation**, avec une information **dossier** embarquée pour la préparation. | Projection API, aucun calcul d'admissibilité financier dans le Web. | [C1][C1], [C4][C4], [C5][C5] |
| CAM-Z08 · Pagination | Numéro de page, nombre total de pages, Précédente et Suivante. | Prestations paginées ; pas pagination des dossiers. | Page + pagination de la réponse API. | [C1][C1], [C5][C5] |
| CAM-Z09 · Sélection absente | Invite à sélectionner une prestation. Aucun détail n'est chargé avant sélection. | Obligation sélectionnée ou absence de sélection. | Page Campagnes. | [C1][C1] |
| CAM-Z10 · En-tête du détail | Référence, entreprise, canal, destination, passage et Ouvrir le dossier de publication. | Identité de la prestation sélectionnée et accès au dossier entier. | Page ; destination propriétaire Commandites → Publication. | [C1][C1], [C2][C2] |
| CAM-Z11 · Poste de préparation | Explication, Actualiser et bon complet : montant/paiement, offre, résumé, contrôles, assistance, contenu exact, détails, décision et historique. | **Ensemble du dossier**, pas uniquement la prestation sélectionnée. | `AdminSponsorshipPreparationComponent` déjà réutilisé par Dossier → Publication ; sous-composants du reçu et du pilote partagés avec le Guide. | [P1][P1], [P2][P2], [P3][P3] |
| CAM-Z12 · Faits du contenu et de la livraison | Date du paiement, format promis, échéance, horaire programmé avec heure de Toronto. | Obligation sélectionnée ; paiement issu du dossier. | Projection Campagnes ; aucune saisie de date ni programmation ici. | [C1][C1], [C2][C2], [C5][C5] |
| CAM-Z13 · Prochaine étape | Motif du workflow, responsable administrateur/plateforme/personne et éventuellement Examiner la livraison. | Prochaine intervention de l'obligation. | Contrat de workflow partagé, textes de publication programmée réutilisés ; destination Publications → Automatisation. | [C1][C1], [C2][C2], [C4][C4] |
| CAM-Z14 · Aperçu de contenu | Titre et corps associés à ce passage, sinon invitation à ouvrir le dossier. | Lecture d'un contenu lié à l'obligation ; pas éditeur ni preuve. | Projection Campagnes ; édition dans les écrans propriétaires. | [C1][C1], [C5][C5] |
| CAM-Z15 · Note d'autorisation | Rappelle que préparation approuvée, contenu exact, destination et programmation ont des autorisations distinctes. | Règle de sécurité éditoriale transversale. | Règles commandites ; textes locaux de la page. | [C1][C1], [R1][R1] |
| CAM-Z16 · Preuve de livraison | Date attestée, provenance, visibilité actuelle et lien sûr de publication lorsqu'il existe ; sinon absence de preuve ou dispense. | Preuve qualifiée pour **cette obligation exacte**. Une dispense ne devient pas une livraison. | Qualification API déjà partagée ; panneau de lecture propre à Campagnes. | [C1][C1], [C2][C2], [C5][C5], [C6][C6] |
| CAM-Z17 · Contexte d'ouverture — évolution appliquée | Repère du dossier/prestation ciblés, accès à toutes les campagnes et état d'URL invalide. | La liste ciblée ne doit jamais devenir silencieusement une liste globale ; absence de prestation signalée. | Page, validation des identifiants et filtre API avant pagination. | [C1][C1], [C2][C2], [S1][S1], [C7][C7] |

### Actions de la liste et du détail

Tous les rôles administratifs peuvent consulter la file, sous réserve de droits
effectifs côté API. Les conditions ci-dessous sont celles du Web et ne remplacent
pas ces droits.

<!-- prettier-ignore -->
| Action | Déclencheur et responsabilité | Effet / condition | Destination ou donnée propriétaire | Sources |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| CAM-A01 · Actualiser la page | Bouton de l'en-tête ; relire la requête **appliquée**, sans appliquer les saisies encore en brouillon. | L ; désactivé pendant `idle/loading`. | `GET /api/admin/campaigns`, même requête et sélection si encore présente. | [C1][C1], [S1][S1] |
| CAM-A02 · Saisir la recherche | Modifier le texte de recherche, maximum 120 caractères. | I ; aucune requête immédiate. | Brouillon de filtres local, jamais URL ni stockage navigateur. | [C1][C1], [C2][C2] |
| CAM-A03 · Choisir un canal | Tous, site Web, Facebook ou LinkedIn. | I ; en attente d'Appliquer. | Brouillon local. | [C1][C1], [C2][C2] |
| CAM-A04 · Choisir une destination | Toutes, OpenG7 ou OpenG20. | I ; en attente d'Appliquer. | Brouillon local. | [C1][C1], [C2][C2] |
| CAM-A05 · Choisir un état | Tous, à venir, action requise, bloquée, en échec, à réconcilier ou livrée. | I ; filtre de workflow, pas filtre d'approbation de préparation. | Brouillon local ; valeurs du contrat. | [C1][C1], [C4][C4] |
| CAM-A06 · Choisir le tri | Préparation approuvée, date de paiement ou échéance promise. | I ; valeur initiale préparation approuvée. | Brouillon local, tri global fourni ensuite par l'API. | [C1][C1], [C6][C6] |
| CAM-A07 · Choisir l'ordre | Croissant ou décroissant. | I ; initial décroissant, donc préparations actuellement approuvées en premier. Échéances absentes toujours en dernier. | Brouillon local + comparateur serveur. | [C2][C2], [C6][C6] |
| CAM-A08 · Appliquer / Entrée dans le formulaire | Soumettre recherche, filtres, tri et ordre. | L ; recommence à la page 1, taille 25 ; recherche nettoyée. | Façade/store puis API. Aucun bouton Effacer dédié. | [C1][C1], [C2][C2], [S1][S1] |
| CAM-A09 · Regrouper par dossier | Activer/désactiver la case. | I ; ne relance ni requête ni tri ; état local perdu en quittant la page. | Fonction de regroupement des seules lignes reçues. | [C1][C1], [C3][C3] |
| CAM-A10 · Sélectionner une ligne | Clic ou activation native clavier du bouton de ligne. | I puis L pour le **bon du dossier** ; la ligne doit appartenir à la réponse courante. | ID d'obligation dans le store ; `GET /admin/sponsorships/preparation` et résumé d'assistance si permis. Aucun effet de publication. | [C1][C1], [S1][S1], [P1][P1] |
| CAM-A11 · Page précédente | Reculer d'une page. | L ; seulement si `hasPreviousPage`. Conserve la requête appliquée. | Pagination de l'API. | [C1][C1], [C2][C2] |
| CAM-A12 · Page suivante | Avancer d'une page. | L ; seulement si `hasNextPage`. | Pagination de l'API ; sélection retirée si elle n'est plus dans la réponse. | [C1][C1], [S2][S2] |
| CAM-A13 · Réessayer la lecture | Bouton des états `error/unavailable`. | L ; même requête ; absent en état `forbidden`. | API Campagnes ; ne rejoue aucune commande métier. | [C1][C1], [S1][S1] |
| CAM-A14 · Ouvrir le dossier de publication | Lien dans l'en-tête du détail. | N ; URL administrative validée ou repli construit à partir du dossier. | `/admin/fundraiser/sponsors?sponsorshipId=…&tab=publication`. | [C1][C1], [C2][C2] |
| CAM-A15 · Examiner la livraison | Lien de la prochaine étape, seulement si `workflow.deliveryId` existe. | N ; ne réconcilie, ne publie et ne relance rien. | `/admin/fundraiser/publications/automation?sponsorshipId=…&deliveryId=…`. | [C1][C1], [C2][C2] |
| CAM-A16 · Consulter la publication livrée | Lien dans la preuve. | N ; preuve qualifiée présente et URL `http/https` sans identifiants ; nouvel onglet annoncé, `noopener noreferrer`. | URL externe conservée dans la preuve. Une preuve peut exister sans lien ouvrable. | [C1][C1], [C2][C2], [C6][C6] |
| CAM-A17 · Revenir à toutes les campagnes — évolution appliquée | Retirer explicitement le contexte de dossier/prestation, notamment après URL invalide ou résultat vide. | N/L ; réinitialiser la requête et la sélection ciblées ; ne qualifie ni ne crée une obligation. | Route Campagnes sans identifiants et API non ciblée. | [C1][C1], [C2][C2], [S1][S1] |

La preuve de livraison est un **attribut de chaque prestation**, pas une ligne
autonome ni une action « Envoyer une preuve ». Aucun formulaire de contenu,
programmation, publication, masquage, dispense, remboursement ou import n'est
présent dans ces zones. Leurs liens ouvrent les écrans propriétaires concernés.

## Poste partagé embarqué dans le détail

Le [bon de préparation partagé du dossier](admin-sponsorship-dossier-blueprint.md#bon-de-preparation-partage)
est la référence commune. L'inventaire ci-dessous précise son effet **dans
Campagnes** et les points où l'échelle change. Les actions restent celles des
composants existants ; le rangement ne demande pas un nouveau moteur métier.

### Sous-zones et six contrôles habituels

<!-- prettier-ignore -->
| Repère | Zone / responsabilité | Portée et limites | Sources |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| CAM-P01 | Chargement du bon, traductions, Actualiser, message d'erreur. Obtenir un reçu serveur récent. | Lecture séparée de la liste ; erreur de bon ne transforme pas la liste en vide. | [P1][P1] |
| CAM-P02 | Référence/version/statut, montant et état de paiement, offre et avantages acceptés, quantités, canaux/destinations et échéances. Situer le dossier et l'accord. | Tous les engagements du dossier, même en cliquant un unique passage. Le montant n'est pas un coût affecté à la ligne. | [P2][P2], [P5][P5] |
| CAM-P03 | Résumé des destinations, état des autorisations et état des brouillons. Donner un aperçu de préparation. | État agrégé du bon, pas autorisation indépendante par prestation. | [P2][P2], [P3][P3] |
| CAM-P04 | Progression, liste des contrôles, explication du contrôle choisi, raisons repliées. Identifier le blocage et sa source. | Sélection locale ; compteur issu des contrôles/autorités applicables. Blocages complémentaires possibles hors compteur. | [P4][P4], [P6][P6], [P7][P7] |
| CAM-P05 | Résumé de l'assistance à l'accord : attente/traitement/résultat/revue/péremption/erreur, détails repliés et commandes contextuelles. | Propriétaire uniquement ; lecture d'un résumé, pas du texte de source ou des brouillons de revue. Un résultat d'assistance ne complète aucun contrôle. | [P8][P8], [P9][P9], [P10][P10] |
| CAM-P06 | Actions contextuelles. Exposer la destination propriétaire ou la confirmation d'approbation ; détails, historique et retour. | Mêmes descripteurs que les boutons clavier/manette ; action liée au dossier, contrôle et version courants. | [P4][P4], [P8][P8] |
| CAM-P07 | Relire le contenu exact : textes, version, mention de divulgation et lien source de chaque brouillon. | Ensemble des brouillons du reçu, distinct de l'aperçu d'une obligation dans CAM-Z14. | [P2][P2], [P3][P3] |
| CAM-P08 | Détails de l'accord et traçabilité : confirmation du paiement, version/clauses de l'offre, formats/délais/durées/éléments requis, états des brouillons, bilan et version complète. | **Évolution appliquée** : lecture complète réservée à Campagnes (`inline`), repliée initialement ; volet absent de Commandites (`hidden`) et remplacé par une navigation dans le Guide (`campaigns`). Sa portée reste le dossier entier. | [P2][P2] |
| CAM-P09 | Approbation de préparation : portée, lecture seule, éventuelle revue requise, bouton, estampille, trace et historique des accords. | Décision versionnée sur **tout le bon**, jamais autorisation de publier ce passage. | [P1][P1], [P2][P2], [P5][P5] |

<!-- prettier-ignore -->
| Contrôle habituel | Responsabilité réelle | Action principale / destination si un traitement est requis | Sources |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `payment_confirmed` · Paiement confirmé | Constater un fait de paiement ; signaler absence, remboursement ou litige. | Examiner la source fournie par le bon ; aucun bouton permettant de déclarer payé. | [P5][P5], [P6][P6], [P11][P11] |
| `accepted_offer` · Publications promises | Vérifier l'existence et l'intégrité de l'offre figée et des engagements enregistrés. | Dossier → Publication → `#dossier-agreement` ; assistance Source/Revue si propriétaire. | [P5][P5], [P6][P6], [P11][P11] |
| `content_prepared` · Présentation et contenus | Vérifier l'admissibilité globale et les brouillons ; agrège aussi des blocages d'autres domaines. | Selon cause : Profil → identité `#dossier-identity`, Profil → médias `#dossier-media`, Publication → `#dossier-publication` ; premier lien propriétaire fourni par le bon. | [P5][P5], [P6][P6], [P11][P11] |
| `public_consent` · Consentement public | Constater le consentement actuel du commanditaire. | Examiner la source du dossier ; aucun consentement déduit de l'achat ou de la lecture. | [P5][P5], [P6][P6], [P11][P11] |
| `sponsor_review` · Revue du commanditaire | Vérifier l'approbation administrative du commanditaire. | Dossier → Vue d'ensemble → `#dossier-review` ; la sélection ne constitue pas une revue. | [P5][P5], [P6][P6], [P11][P11] |
| `moderation_review` · Modération | Vérifier l'autorité éditoriale applicable à la version courante. | Dossier → Vue d'ensemble → `#dossier-review`, puis surface de modération propriétaire. | [P5][P5], [P6][P6], [P11][P11] |

Les six contrôles ne sont pas six onglets. Le total n'est pas une constante : les
éléments `not_required` sont exclus, un reçu de lot du Guide peut ajouter
`dossier_examined`, et des blocages complémentaires peuvent avoir leur propre
entrée sans augmenter le compteur. Le reçu du dossier embarqué dans Campagnes
n'exige pas de passage automatique. Sources : [P5][P5], [P6][P6], [R2][R2].

Les destinations internes `tab=identity` et `tab=media` conduisent toutes deux à
l'onglet visible **Profil**, avec des repères distincts pour identité et médias.
Elles ne créent pas deux onglets supplémentaires. Source : [onglets du dossier][P15].

### Actions du poste, des dépliants et de la confirmation

<!-- prettier-ignore -->
| Action | Responsabilité et effet | Condition / propriétaire | Sources |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| CAM-PA01 · Actualiser le bon | L ; relire le reçu et le résumé d'assistance, distinct d'Actualiser la liste. | Pas pendant lecture/approbation du bon. API Préparation / Assistance. | [P1][P1] |
| CAM-PA02 · Choisir un contrôle | I ; afficher son explication ; flèches Haut/Bas, Début/Fin déplacent aussi la sélection et le focus. | Contrôle présent dans la projection ; aucune mutation. | [P4][P4], [P14][P14] |
| CAM-PA03 · Déplier Pourquoi / détails de l'assistance | I ; lire les raisons, l'état et les limites de l'assistance. | Sections présentes pour le contrôle sélectionné ; propriétaire pour l'assistance. | [P7][P7] |
| CAM-PA04 · Actualiser l'assistance en erreur | L ; relire uniquement le résumé. | Assistance permise, non occupée, erreur affichée ; pas relance d'analyse. | [P7][P7], [P9][P9] |
| CAM-PA05 · Actions | I ; ouvrir le contrôleur contextuel et placer le focus sur une commande disponible. | Non occupé ; priorité de panneau et retour au neutre partagés. | [P4][P4] |
| CAM-PA06 · Examiner / Documenter l'accord / Compléter la présentation / Traiter la modération | N ; l'action principale est calculée selon le contrôle sélectionné. | URL propriétaire sûre disponible ; ne valide aucun contrôle par elle-même. | [P8][P8], [P11][P11] |
| CAM-PA07 · Examiner le résultat de l'assistance | N ; rejoindre la revue des prestations. | Propriétaire, résumé du bon courant, résultat réussi disponible et action permise. Destination `tab=publication#dossier-assistance-review`. | [P8][P8], [P10][P10], [P11][P11] |
| CAM-PA08 · Voir la source de l'assistance | N ; rejoindre la source d'origine. | Propriétaire, source versionnée disponible. Destination `tab=publication#dossier-assistance-source`. | [P8][P8], [P10][P10], [P11][P11] |
| CAM-PA09 · Relancer l'assistance | P ; créer explicitement un nouveau traitement privé de la source, avec versions et requestId. | Propriétaire, source disponible, capacité serveur, aucun job actif/commande en cours. Ne qualifie pas l'accord et n'approuve rien. | [P8][P8], [P9][P9], [P10][P10] |
| CAM-PA10 · Détails | I ; déplier CAM-P08 et focaliser son résumé. | Reçu présent, commande non occupée. | [P3][P3], [P8][P8] |
| CAM-PA11 · Historique | I ; déplier l'historique d'approbation ; si absent, revenir au reçu. | Historique affiché seulement s'il contient des entrées ; action ne crée pas d'accord. | [P2][P2], [P3][P3], [P8][P8] |
| CAM-PA12 · Retour / Échap du contrôleur | I ; fermer les actions et rendre le focus à Actions. | Contrôleur ouvert ; aucun abandon de données métier. | [P4][P4], [P8][P8] |
| CAM-PA13 · Relire le contenu | I ; ouvrir/fermer le dépliant des textes exacts. | Reçu présent ; explique aussi l'absence de brouillon. | [P2][P2] |
| CAM-PA14 · Ouvrir la source d'un brouillon | N ; consulter son écran propriétaire. | Lien administratif validé présent pour le brouillon. | [P2][P2], [P3][P3] |
| CAM-PA15 · Ouvrir/fermer détails, trace ou historique | I ; consulter clauses, version complète, acteur/date/référence d'audit ou accords précédents. | Dépliant correspondant présent ; lecture seule. | [P2][P2] |
| CAM-PA16 · Approuver la préparation | Ouvrir la confirmation transversale ; **aucune décision tant qu'elle n'est pas acceptée**. Accessible par bouton du reçu et action contextuelle lorsque prête. | Opérateur/propriétaire ; `canApprove` serveur, pas déjà approuvée, pas de chargement/approbation/incertitude/erreur de configuration. Bouton masqué si déjà approuvée. | [P1][P1], [P2][P2], [P8][P8], [R3][R3] |
| CAM-PA17 · Annuler la confirmation | I ; refuser la demande, sans POST. Une navigation annule aussi la confirmation. | Dialogue partagé ; une seule décision en attente. | [P12][P12] |
| CAM-PA18 · Confirmer l'approbation | D ; envoyer contributionId, version attendue, requestId et confirmation explicite ; attendre le reçu serveur puis actualiser les données administratives. | API revérifie rôle, préconditions et version ; décision auditée. N'autorise ni envoi ni visibilité publique. | [P1][P1], [P13][P13], [R2][R2], [R3][R3] |

Les raccourcis de manette sont des accès aux mêmes intentions, pas des actions
métier supplémentaires. Un changement de contrôle, de dossier, de version ou de
révision de l'assistance ferme les actions et invalide le geste antérieur. La
confirmation conserve sa propre priorité ; maintenir une touche ne vaut pas une
deuxième acceptation. Source : [P4][P4], [R2][R2].

## Contrat, store et états observables

<!-- prettier-ignore -->
| Aspect | Existant vérifié dans le code | Conséquence pour le blueprint | Sources |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Sélection des données | Source : commandites avec `paid_at`, engagement actif, offre identifiée et obligations correspondantes. La projection conserve les lignes livrées/dispensées et les faits historiques après remboursement. | Les dossiers anciens sans offre ni obligations ne produisent aucune ligne. Paiement confirmé ne suffit pas seul. | [C5][C5] |
| À venir et approbations | Préparations non approuvées incluses ; dernière approbation comparée à la version courante. Le tri préparation est global avant pagination. | Une préparation périmée devient à réexaminer, mais sa prestation reste visible. | [C5][C5], [C6][C6] |
| Preuve | Qualification partagée, ID d'obligation + canal + destination. Visibilité actuelle distincte. | Une URL, une simulation ou un statut ancien publié ne suffisent pas à déclarer livré. | [C6][C6], [R1][R1] |
| Contenu | Brouillon social explicitement lié à l'obligation ; brouillon Web associé au premier passage encore ouvert du couple canal/destination. | Le détail n'est pas une archive exhaustive du texte effectivement livré ; prestation livrée peut avoir preuve et aucun aperçu actuel. | [C5][C5] |
| Lecture API | GET privé/no-store, contrôle d'accès serveur, snapshot PostgreSQL cohérent. Paramètres invalides/répétés/inconnus : 400 ; source indisponible : 503 ; autres méthodes : 405. | Ne jamais confondre refus/indisponibilité et absence de prestations. Aucune commande sur cet endpoint. | [C6][C6], [C7][C7] |
| Taille de page | API accepte 25/50/100 ; UI applique toujours 25 et n'expose aucun sélecteur. | Ne pas dessiner un contrôle absent. | [C2][C2], [C6][C6] |
| Mémoire de navigation | Requête appliquée, page et sélection en mémoire NgRx ; brouillon des filtres et regroupement locaux à la page. | Retour dans la même session : relecture de la même requête, sélection restaurée seulement si encore présente. Rechargement navigateur : valeurs initiales. | [S1][S1], [S2][S2], [C2][C2] |
| Entrée contextuelle — évolution appliquée | URL avec `sponsorshipId` UUID et éventuellement `obligationId` UUID, lequel exige le dossier. L'API filtre le parent et l'obligation avant pagination. | Reprendre la sélection du même parent ou choisir l'unique prestation ; laisser choisir si plusieurs. ID absent ou non rattaché : zéro résultat, jamais un passage arbitraire ; URL invalide : pas de lecture globale par repli. | [C2][C2], [S1][S1], [C7][C7] |
| Invalidation | Mutation administrative confirmée : invalidation puis lecture immédiate si page active, lecture à la prochaine ouverture sinon. | L'approbation ne réordonne pas la liste optimistement ; la réponse serveur fait foi. | [S1][S1], [S2][S2] |
| Changement de session | Compte/session/rôle différent : purge requête, sélection et données, même hors page. Annulation et générations empêchent l'ancienne réponse de réapparaître. | Aucune persistance privée navigateur ni restauration d'une autre identité. | [S1][S1], [S2][S2] |

<!-- prettier-ignore -->
| État | Ce que la personne voit et peut faire | Limite / frontière à conserver | Sources |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `idle/loading` | Chargement annoncé, liste occupée, Actualiser désactivé ; détail sans donnée sélectionnée accessible. | Le store retire les résultats précédents ; une lecture n'est pas une préparation automatique. | [C1][C1], [S2][S2] |
| `ready`, lignes présentes | Liste sélectionnable, pagination, détail si sélection valide. | Aucun préchargement de bon pour chaque passage ; le bon est chargé pour la sélection. | [C1][C1], [P1][P1] |
| `ready`, aucun item | « Aucune prestation dans cette sélection » ; invitation générale à modifier les filtres ou attendre paiement/engagements. | Aucun diagnostic séparé historique/filtre/page hors bornes ; pagination actuellement absente. | [C1][C1], [C5][C5] |
| `error` | Message général et Réessayer. | Données et sélection retirées ; 400 est également rendu comme erreur générique. | [C1][C1], [S1][S1], [S2][S2] |
| `unavailable` | Message d'indisponibilité et Réessayer. | Le 503 ne devient pas une fausse liste vide. | [C7][C7], [S1][S1] |
| `forbidden` | Message de refus, pas de bouton Réessayer dans la zone d'erreur. | 403 ne déconnecte pas automatiquement. Le bouton Actualiser de l'en-tête n'est pas masqué ; l'API reste autoritaire. | [C1][C1], [S1][S1] |
| 401 de lecture Campagnes | Purge et retour à la connexion avec URL de retour et marqueur de session expirée. | Un ancien 401 d'une requête dépassée ne doit pas invalider la nouvelle session. | [S1][S1] |
| Bon en lecture / erreur | Indicateur local, erreur sûre ; actualisation du bon. | La traduction, la configuration DB, les droits, la version obsolète et le résultat incertain possèdent leurs erreurs ; approbation bloquée selon le cas. | [P1][P1], [R2][R2] |
| Approbation en cours / issue incertaine | Commandes désactivées ; reçu relu sans rejouer aveuglément la décision. | Le résultat serveur et la version attendue gouvernent la décision ; incertitude bloque une nouvelle approbation jusqu'à relecture réussie. | [P1][P1] |
| Assistance | Attente/traitement/résultat/revue/périmé/erreur/timeout ; actualisation ou relance selon capacité. | Résumé propriétaire seulement ; polling limité à un traitement actif, suspendu visuellement quand le document est masqué. | [P7][P7], [P9][P9], [P10][P10] |
| SSR / sortie de route | Pas de lecture navigateur sur le serveur ; sortie annule la lecture Campagnes. | Aucun paiement, décision ou envoi déclenché au rendu. La mémoire de navigation reste limitée à la session courante. | [C2][C2], [S1][S1] |

## Zones à plusieurs périmètres et équivalents transversaux

Ce sont des **propositions de rangement**, pas des fonctionnalités déjà livrées.
L'objectif est de clarifier le lieu d'action en conservant les contrats et
composants métier éprouvés.

<!-- prettier-ignore -->
| Constat | Pourquoi plusieurs périmètres se rencontrent | Découpage proposé | Réutilisation réelle / élément à créer |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAM-Z11 : reçu complet du dossier dans une fiche de passage | Finance, accord, identité/média, revue, modération, assistance, autorisation, historique et approbation globale occupent le détail d'une obligation. | Campagnes garde un résumé du bon + bloqueurs utiles et accès au poste de préparation. Une décision globale doit annoncer explicitement le dossier et tous les canaux concernés. | **Existe** : `AdminSponsorshipPreparationComponent`, reçu, pilote et contrôleur contextuel. **À créer si retenu** : présentation compacte typée du bon / coquille de poste commun ; ne pas recréer un moteur de préparation. |
| CAM-Z12–16 : « Contenu et livraison » réunit contrat, travail éditorial, workflow et attestation | Échéance promise, état programmé, texte en préparation et preuve qualifiée répondent à des questions différentes. | Sous-zones « Promesse », « Travail en cours », « Livraison et preuve », chacune avec son prochain lien propriétaire. | **Existe** : contrats de workflow, progression et qualification des preuves. **N'existe pas encore comme widget neutre démontré** : carte universelle de preuve ou résumé unifié ; extraire seulement à partir de réutilisations réelles. |
| CAM-P04 : « Présentation et contenus » | Le serveur agrège dans `content_prepared` tous les blocages hors examen du lot, y compris consentement, paiement, accord et modération. | Exposer les causes avec leurs propriétaires ; nommer le statut agrégé sans faire croire qu'un simple texte manquant est le seul problème. Ne pas déplacer des préconditions de sécurité dans la seule UI. | **Existe** : projection du pilote, blockers et navigation par cause. **À décider** : scission du libellé/présentation ; changement éventuel de contrat séparé et testé. |
| CAM-P07 et CAM-Z14 : deux présentations du contenu | Le bon relit tous les textes exacts ; Campagnes affiche le contenu d'un passage. | Garder un aperçu clairement nommé « Contenu associé à cette prestation » et un lien vers la relecture versionnée globale. | **Existe** : reçu de relecture exact. **À créer éventuellement** : aperçu compact réutilisable ; pas un second éditeur. |
| CAM-P09 : deux entrées Approuver | Bouton du reçu et commande contextuelle aboutissent à la même confirmation ; la proximité avec une ligne peut suggérer une portée limitée. | Conserver une seule intention et une confirmation transversale explicitant « préparation du dossier », version et portée. Les deux accès peuvent rester si leurs rôles sont clairs. | **Existe** : `AdminConfirmationService`, composant de confirmation et même méthode `confirmAndApprove`. Ne pas créer une deuxième approbation. |
| CAM-Z00 : Guide et préparation globale dans plusieurs points d'entrée | Coquille, Guide, dossier et Campagnes exposent parfois la même préparation avec des navigateurs différents. | Guide explique ou accompagne ; dossier possède les corrections ; Campagnes suit les obligations. Le poste partagé peut être présenté dans une coquille cohérente sans absorber tous les formulaires. | **Existe** : composants communs de reçu/pilote, services de retour/confirmation, inspecteur. **À concevoir** : contrat d'ouverture/retour incluant une origine Campagnes et sa prestation. L'inspecteur n'est pas supposé être un remplacement automatique sans audit de ses capacités. |

## Écarts distincts et priorités proposées

<!-- prettier-ignore -->
| Priorité / écart | Preuve actuelle | Proposition concrète et critère de recette |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 · Vide non explicatif pour l'historique** | [C5][C5] exclut l'historique sans offre/obligations ; [C1][C1] propose un message générique. | Afficher, séparément des prestations, un signal « Dossiers payés dont les engagements restent à qualifier » avec nombre et lien de traitement propriétaire. **Recette** : zéro prestation + historique à qualifier n'affiche pas un vide inexpliqué ; aucune obligation n'est inventée à partir du barème actuel ; qualification réservée au propriétaire. |
| **P1 · Page devenue hors bornes sans issue locale** | [C5][C5] conserve `query.page` et peut renvoyer `items=[]`, `hasPreviousPage=true` après diminution du résultat ; [C1][C1] masque toute pagination dans cette branche. | Conserver la pagination et proposer page 1/précédente, ou réconcilier explicitement la page. **Recette** : depuis page 2, réduction du résultat à moins de 26 lignes puis Actualiser permet de rejoindre les lignes restantes sans devoir deviner qu'Appliquer réinitialise la page. |
| **P1 · Portée dossier masquée par la sélection d'un passage** | [C1][C1] passe seulement `contributionId` au poste complet ; [P1][P1] approuve la version globale. | Nommer l'échelle des zones et résumer la préparation dans Campagnes avant accès au poste partagé. **Recette** : deux passages d'un même dossier montrent la même version/approbation sans suggérer deux accords indépendants ; la confirmation nomme la portée globale. |
| **P1 · Retour d'assistance incomplet depuis Campagnes** | [P3][P3] tente de mémoriser l'origine ; [P11][P11] refuse, hors reçu de lot, toute origine autre que `/admin/fundraiser/sponsors`. | Étendre le contrat de retour aux identifiants sûrs de Campagnes, sans copier texte ou critères privés dans l'URL. **Recette** : Campagnes → source/revue → retour au poste restaure prestation, contrôle et focus, relit le bon et conserve les filtres appliqués. Le simple retour manuel actuel n'est pas cette fonctionnalité. |
| **P1 · Causes étrangères rangées sous Présentation** | [P5][P5] calcule `contentBlockers` sur tous les blocages hors `dossier_not_examined` ; [P6][P6] donne `content_prepared` au parcours présentation. | Présenter les causes par responsabilité et pointer le bon formulaire, en préservant l'admissibilité globale. **Recette** : un manque de consentement ne propose pas uniquement de réécrire une présentation ; aucun contrôle n'est complété par un clic de consultation. |
| **P2 · « Regrouper par dossier » suggère un regroupement global** | [C3][C3] réunit seulement les séries contiguës de la page pour respecter le tri. | Nommer et expliquer la portée de présentation ou proposer un mode explicitement distinct de tri/groupement global. **Recette** : des échéances intercalées conservent l'ordre attendu ; compte des dossiers de la page et total de prestations restent distingués. |
| **P2 · Contenu associé et preuve confondables** | [C5][C5] peut ne plus associer le brouillon Web à un passage clôturé ; [C1][C1] affiche séparément aperçu et preuve. | Nommer aperçu actuel vs contenu livré, et garder la preuve au premier plan pour une prestation soldée. **Recette** : une obligation livrée avec preuve mais sans brouillon actuel ne ressemble pas à une livraison incomplète. |
| **P2 · Filtres saisis et filtres appliqués difficiles à distinguer** | [C2][C2] conserve les saisies locales, Actualiser relit le store ; le regroupement est local. | Ajouter un repère « modifications à appliquer » et un retour aux critères initiaux si utile. **Recette** : le total ne paraît pas correspondre à une saisie qui n'a pas encore été appliquée ; ne pas persister des données privées pour résoudre ce problème. |

## Limites de l'analyse et recette du rangement

Ce relevé repose sur les composants, contrats, clients, store et handlers cités.
Il n'inclut ni manipulation de base, qualification d'accord, approbation,
publication ni relance réelle. Les évolutions appliquées sont identifiées ; les
autres refontes restent des propositions.
La maquette d'inspiration ne prouve pas l'existence d'un onglet, d'une progression
IA ou d'une action supplémentaire.

Lors d'une implémentation ultérieure, vérifier le parcours clavier/focus et
mobile, les deux langues, la séparation lecture/préparation/décision, les rôles
lecteur/opérateur/propriétaire, les réponses tardives après changement de session,
la relecture après mutation et les versions périmées. Réutiliser les scénarios
[UI Campagnes][T1], [store][T2] et [parcours API réel][T3] selon les changements ;
ils sont des références de couverture, pas des validations réexécutées pour ce
document. La [matrice de validation](validation.md) reste propriétaire des
commandes à lancer.

## Sources exactes

- [C0 · Coquille administrative][C0].
- [C1 · Template Campagnes][C1] ; [C2 · orchestration de page][C2] ; [C3 · regroupement][C3].
- [C4 · Contrat partagé][C4] ; [C5 · projection/snapshot API][C5] ; [C6 · requête/tri/preuve][C6] ; [C7 · handler HTTP][C7].
- [S1 · Façade NgRx/API][S1] ; [S2 · reducer, actions et sélecteurs][S2] ; [S3 · client HTTP authentifié][S3].
- [P1 · Hôte du bon de dossier][P1] ; [P2 · template du reçu][P2] ; [P3 · orchestration du reçu][P3] ; [P4 · pilote et gestion des entrées][P4].
- [P5 · Projection serveur de préparation][P5] ; [P6 · projection de présentation des contrôles][P6] ; [P7 · détail d'un contrôle][P7].
- [P8 · Descripteurs des actions contextuelles][P8] ; [P9 · lecture/relance du résumé d'assistance][P9] ; [P10 · capacités/actions d'assistance partagées][P10].
- [P11 · Destinations et origine de retour][P11] ; [P12 · confirmation transversale][P12] ; [P13 · API préparation du dossier][P13] ; [P14 · liste et clavier des contrôles][P14].
- [R1 · Règles commandites][R1] ; [R2 · runbook de pilotage][R2] ; [R3 · politique des rôles API][R3] ; [R4 · guide technique Campagnes][R4].

[C0]: ../../apps/funding-web/src/app/features/funding/components/admin-layout/admin-layout.component.ts
[C1]: ../../apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-page.component.html
[C2]: ../../apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-page.component.ts
[C3]: ../../apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-controller.ts
[C4]: ../../packages/funding-core/src/admin-campaigns.ts
[C5]: ../../apps/funding-api/src/admin-campaigns.service.ts
[C6]: ../../apps/funding-api/src/admin-campaigns-query.ts
[C7]: ../../apps/funding-api/src/admin-campaigns.http.ts
[S1]: ../../apps/funding-web/src/app/features/funding/services/admin-campaigns-store.service.ts
[S2]: ../../apps/funding-web/src/app/features/funding/services/admin-campaigns.store.ts
[S3]: ../../apps/funding-web/src/app/features/funding/services/funding-admin-campaigns.client.ts
[P1]: ../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-preparation.component.ts
[P2]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/admin-preparation-receipt.component.html
[P3]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/admin-preparation-receipt.component.ts
[P4]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.component.ts
[P5]: ../../apps/funding-api/src/admin-preparation.projection.ts
[P6]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.projection.ts
[P7]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-issue-detail.component.ts
[P8]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-context-actions.ts
[P9]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-assistance-summary.controller.ts
[P10]: ../../packages/funding-core/src/preparation-assistance-summary.ts
[P11]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-navigation.ts
[P12]: ../../apps/funding-web/src/app/features/funding/services/admin-confirmation.service.ts
[P13]: ../../apps/funding-api/src/admin-dossier-preparation.http.ts
[P14]: ../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-issue-list.component.ts
[P15]: ../../apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-detail-tabs.component.ts
[R1]: sponsorship-rules.md
[R2]: ../operations/admin-pilotage.md#preparation-pilot
[R3]: ../../apps/funding-api/src/admin-identity/policy.ts
[R4]: ../technical/admin-campaigns.md
[T1]: ../../tests/playwright/admin-campaigns.spec.ts
[T2]: ../../tests/admin-campaigns-store.test.mjs
[T3]: ../../tests/identity/admin-campaigns-journey.spec.ts
