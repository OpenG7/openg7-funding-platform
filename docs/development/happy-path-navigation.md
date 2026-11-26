# Navigation des happy paths de la plateforme administrative OpenG7

Repères au 25 novembre 2026. Ce guide accompagne une navigation de la plateforme
administrative avec ChatGPT : points de départ, actions successives, écrans
attendus et résultat de chaque parcours. Il peut être partagé comme fichier joint.
Consolidation après les sept chantiers, sur `632c6ac247dde08e6085bb5bbda09670afdcb548`.
Les parcours publics, Checkout et suivi privé des contributeurs sont hors périmètre.
Les contributions et dossiers nécessaires sont des préconditions déjà présentes.

L’[analyse métier et architecturale](operational-scalability-analysis.md) conserve
ces dix parcours et les relie aux capacités, preuves et possibilités de reprise.

Les parcours décrivent le fonctionnement prévu par les routes et contrats actuels.
Leur disponibilité dépend des droits, des données et des fournisseurs configurés.
Ce guide ne constitue pas une recette exécutée ni une qualification de production.
Les noms d’actions décrivent leur fonction ; les libellés entre guillemets sont
repris des guides fonctionnels.

## Texte à partager avec ChatGPT

Joindre ce guide et utiliser ce texte pour commencer directement la navigation :

> Accompagne-moi dans les dix happy paths de la plateforme administrative OpenG7
> décrits dans le fichier joint. Commence au parcours 1, à `/admin/login`, sans
> questionnaire préalable. Pour chaque étape, donne le point de départ, une seule
> action concrète, ce qui devrait apparaître et la preuve de réussite à observer.
> Attends « suivant » ou mon observation avant d'avancer. Si je nomme un parcours,
> reprends directement celui-ci. Utilise les routes et fonctions du guide sans
> inventer de bouton. Distingue observation, préparation, décision, exécution et
> preuve métier. Si une source manque ou si l'écran diffère, décris le blocage et
> le retour au parcours natif ; ne présente pas l'étape comme réussie. Reste dans
> l'administration et dans un environnement synthétique pour les mutations.
> Les outils de charge, les sondes et la préparation bornée par API ne sont pas
> des commandes disponibles dans la Salle. Ne sollicite ni secret ni donnée
> personnelle et ne déclenche aucune opération réelle.

## Repères de navigation

Les adresses sont relatives au site ouvert. La connexion commence à `/admin/login`.
Les pages métier commencent par `/admin/fundraiser`. Chaque action reste contrôlée
côté API selon le rôle du compte.

| Parcours                             | Point de départ                   | Résultat attendu                                     |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| 1 Ouvrir une session                 | `/admin/login`                    | Cockpit accessible                                   |
| 2 Suivre une contribution            | `/admin/fundraiser/contributions` | Paiement et pièces retrouvés                         |
| 3 Examiner une commandite            | `/admin/fundraiser/sponsors`      | Revue et visibilité enregistrées séparément          |
| 4 Préparer une reconnaissance        | `/admin/fundraiser/campaigns`     | Prestations suivies jusqu’à leur preuve de livraison |
| 5 Consulter une facture              | `/admin/fundraiser/invoices`      | Document et courriel retrouvés                       |
| 6 Rembourser en simulation           | Détail d’une contribution         | Remboursement confirmé et avoir associé              |
| 7 Publier une allocation             | `/admin/fundraiser/expenses`      | Affectation et avancement enregistrés                |
| 8 Prendre en charge une intervention | `/admin/fundraiser/attention`     | Dossier exact ouvert et contexte conservé            |
| 9 Gérer les accès                    | `/admin/fundraiser/access`        | Droits et sessions vérifiés                          |
| 10 Retrouver une trace               | `/admin/fundraiser/audit`         | Action et résultat retrouvés                         |

Pour naviguer les mutations, utiliser un environnement de test avec données
synthétiques et fournisseurs simulés. Ce guide n’autorise aucun remboursement,
envoi, changement d’accès ou publication de production.

## Ce que les sept chantiers apportent à la navigation

Les dix parcours restent les références. Les chantiers améliorent leur suivi et
leurs contrôles ; ils n'ajoutent pas sept nouvelles étapes obligatoires.

| Chantier                       | Où l'observer                                                 | Résultat à vérifier et limite                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Corrélation de la commandite | Salle, avec le dossier exact sélectionné                      | Paiement, accord, prestations, préparation, autorisations et preuves reliés au même dossier ; consultation en lecture seule                           |
| 2 Priorisation par exception   | Assistant et Salle, à périmètre comparable                    | Motifs propriétaires cohérents et responsabilité humaine ou plateforme explicite ; une exécution autorisée en attente n'est pas une nouvelle décision |
| 3 Flux et mesure humaine       | Panneau de flux de la Salle                                   | Population, période, provenance et limites visibles ; mesure humaine volontaire et locale, sans gain de temps présumé                                 |
| 4 Préparation répétitive       | Aperçu à la demande dans le portefeuille administratif        | Prochaines préparations privées manquantes, sélection versionnée, brouillons existants préservés ; examen et diffusion restent séparés                |
| 5 Charge contrôlée             | Recette technique isolée, hors navigation Web                 | Latences, concurrence et pool mesurés ; les grandes files restent coûteuses, aucun volume journalier certifié                                         |
| 6 Assurance opérationnelle     | Recette technique et CI optionnelle, hors navigation Web      | Épisodes et réconciliation synthétiques, ressources jetables nettoyées ; aucune mesure de disponibilité de production                                 |
| 7 Autonomie encadrée           | Appel API explicitement choisi, hors parcours des boutons Web | Un dossier, plafond de brouillons, expiration et reçus natifs ; aucune décision de publication ou de remboursement                                    |

Les contrats et preuves datées restent dans la
[Salle et ses capacités](../technical/engine-room.md), les
[mesures de charge](publication-performance.md#admin-controlled-load),
l'[assurance isolée](../operations/admin-identity-and-alerts.md#isolated-operational-assurance)
et la [préparation privée bornée](../technical/admin-automatic-runs.md#bounded-private-preparation).
La présence du code ne prouve pas son activation dans l'environnement visité.

## 1 Ouvrir une session administrative

**Départ :** `/admin/login`, compte nominatif déjà provisionné avec les droits
requis et fournisseur d’identité configuré.

1. Démarrer la connexion auprès du fournisseur d’identité.
2. Effectuer l’authentification et le second facteur requis par l’environnement.
3. Revenir sur `/admin/fundraiser` ou sur la page protégée initialement demandée.
4. Lire le cockpit, puis ouvrir « À traiter » ou une rubrique métier.
5. En fin de navigation, se déconnecter de la session OpenG7.

**À l’écran :** cockpit et commandes adaptées aux droits du compte.

**Résultat :** session administrative utilisable. Chaque action reste contrôlée
côté API. La déconnexion OpenG7 ne ferme pas la session globale du fournisseur.

## 2 Suivre une contribution reçue

**Départ :** session administrative et paiement synthétique nouvellement confirmé.

1. Consulter la notification globale de contribution reçue lorsqu’elle apparaît.
2. Ouvrir `/admin/fundraiser/contributions` et retrouver la contribution.
3. Examiner son montant, sa devise, sa référence et son statut confirmé.
4. Suivre les liens vers les pièces et, pour une entreprise, vers son dossier.
5. Consulter `/admin/fundraiser/email-queue` pour les messages associés.
6. Pour la commandite, lire l’état de préparation privée et ses prochaines étapes.

**À l’écran :** faits financiers, états de notification et préparation privée.
Courriel, toast et SMS ont des états indépendants ; le SMS décrit un simulateur,
sans attester d’envoi téléphonique réel.

**Résultat :** l’administrateur retrouve le paiement et les éléments à traiter.
Une notification reçue ou une cartouche préparée n’approuve aucune publication.

## 3 Examiner une commandite et décider de sa visibilité

**Départ :** `/admin/fundraiser/sponsors`, dossier payé et soumis, droits de revue.

1. Ouvrir le dossier et lire paiement, accord, texte, consentements et médias.
2. Examiner la version soumise et les droits d’usage des fichiers.
3. Enregistrer la décision appropriée sur le contenu examiné.
4. Vérifier séparément la décision de visibilité de la fiche Web.
5. Relire dans le dossier la décision de visibilité enregistrée et les conditions publiques applicables.

**À l’écran :** statut de revue, explications et état de visibilité distinct.

**Résultat :** dossier examiné et décision tracée. Une approbation sociale peut
coexister avec une fiche Web maintenue privée. Les notes internes ne deviennent
pas le texte public.

## 4 Préparer une reconnaissance et suivre sa livraison

**Départ :** `/admin/fundraiser/campaigns`, nommé « Prestations de services »,
avec un dossier admissible et les droits nécessaires.

1. Retrouver l’accord et les prestations promises du dossier.
2. Lire leur préparation, les éléments disponibles et les conditions restantes.
3. Ouvrir `/admin/fundraiser/publications`, puis l’espace approprié :
   `drafts` pour rédaction et validation, `batches` pour les lots,
   `calendar` pour les créneaux éditoriaux.
4. Pour le parcours automatisé, ouvrir `publications/automation`, examiner la
   préparation et le contenu final de la destination concernée.
5. Vérifier texte, sources de reconnaissance, média, destination, mode et horaire,
   puis autoriser explicitement cette version avec confirmation.
6. Dans l’environnement simulé configuré, laisser le moteur traiter l’échéance.
7. Relire le résultat et la preuve associée à la prestation exacte.

**À l’écran :** brouillon, programmation, autorisation et livraison sont des
étapes identifiables. Les calendriers présentent les événements dans le fuseau
America/Toronto. Un collectif attend le nombre de dossiers requis.

**En arrière-plan :** le moteur revalide l’admissibilité avant envoi. Les flux,
le worker et le fournisseur doivent être activés pour le mode choisi.

**Résultat de navigation simulée :** tentative et résultat simulés retrouvés,
sans prestation déclarée livrée réellement. La réussite métier exige une livraison
confirmée avec une preuve qualifiée pour la prestation exacte ; cette qualification
réelle reste hors de la navigation synthétique. Une préparation approuvée ou un
statut social renseigné manuellement ne suffisent pas à établir cette livraison.

### Lire ce même dossier dans la Salle

1. Depuis **Prestations de services**, ouvrir le lien vers la Salle pour le
   dossier choisi. Sa route est `/admin/fundraiser/engine-room` ; le lien conserve
   `sponsorshipId`. Une ouverture globale sans sélection ne présente pas un cycle
   individuel fictif.
2. Lire **Cycle de reconnaissance de la commandite**. Vérifier que paiement,
   accord, prestations et preuves se rapportent à cette même commandite. Pour
   une livraison collective, sélectionner le participant exact à observer.
3. Lire les motifs, la responsabilité et la prochaine action native. Un résultat
   incertain reste à réconcilier ; une attente normale ne crée pas une nouvelle
   autorisation à donner.
4. Examiner les flux dans le même périmètre : obligations ouvertes, sorties
   qualifiées, dispenses, période et sources. L'âge d'une obligation ne mesure
   pas le temps de travail humain, et une absence d'échantillon n'est pas zéro.
5. Suivre le lien d'intervention vers le propriétaire si nécessaire, puis revenir
   au même dossier. La consultation de la Salle ne prépare ni n'approuve rien.

Le [contrat du cycle](../technical/engine-room.md#cycle-de-reconnaissance-par-commandite)
précise la couverture partielle et les preuves admissibles. Les missions distantes
Preflight se consultent dans leur espace propriétaire ; ouvrir la Salle ne les
interroge pas.

### Variantes à parcourir sans inventer une réussite

Ces variantes servent à revoir les angles du parcours 4 sur des fixtures
synthétiques déjà préparées, sans altérer une donnée réelle pour provoquer un cas.

| Variante                               | Ce qui doit rester visible                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Plusieurs passages du même canal       | Ordinal et obligation exacts ; un passage préparé ne solde pas les suivants                 |
| Livraison collective                   | Participants exacts ; le résultat d'un autre participant n'est pas la preuve de ce dossier  |
| Durée Web non attestée                 | Condition restante explicite ; visibilité courante distincte d'une durée prouvée            |
| Dispense                               | Décompte séparé, sans la compter comme une livraison                                        |
| Accord historique non qualifié         | Qualification inconnue, sans appliquer rétroactivement l'offre actuelle                     |
| Simulation                             | Nature simulée conservée, sans preuve de réalisation réelle                                 |
| Consentement retiré ou contenu modifié | Prérequis et version relus ; ancienne préparation ou autorisation insuffisante              |
| Résultat incertain                     | Blocage et lien de réconciliation ; aucune relance automatique                              |
| Source indisponible ou page suivante   | Donnée inconnue ou couverture partielle, sans réutiliser un ancien succès comme état actuel |

## 5 Consulter une facture et suivre son courriel

**Départ :** `/admin/fundraiser/invoices`, commandite confirmée avec facture émise.

1. Retrouver la facture liée au paiement et ouvrir son détail.
2. Consulter ou télécharger le PDF et vérifier montant, devise et référence.
3. Lire le statut de son courriel dans la file.
4. Si un renvoi est nécessaire et autorisé dans l’environnement de test,
   vérifier le destinataire présenté et confirmer l’action.
5. Suivre le message concerné dans `/admin/fundraiser/email-queue`.

**À l’écran :** document stable et livraison du message suivie séparément.

**Résultat :** facture retrouvée et envoi observable. Le renvoi ne recrée ni
paiement ni facture ; l’acceptation SMTP n’atteste pas la lecture du courriel.

## 6 Rembourser une contribution de test

**Départ :** paiement confirmé en environnement isolé, rôle habilité et montant
remboursable. Ce parcours décrit une simulation, sans remboursement réel.

1. Ouvrir la contribution et consulter son historique financier.
2. Choisir un remboursement partiel ou total, dans la limite disponible.
3. Renseigner la raison et vérifier montant, devise et cible de la confirmation.
4. Confirmer l’action de test et attendre le résultat serveur confirmé par Stripe
   ou son fournisseur simulé.
5. Retrouver le remboursement et l’avoir rattaché à la facture concernée.
6. Lire le statut du courriel et les agrégats actualisés.
7. Pour une commandite, vérifier la réévaluation de l’admissibilité des envois.

**À l’écran :** résultat du remboursement, avoir et historique conservé.

**Résultat :** compensation traçable, montant restant cohérent et absence de
doublon financier. L’avoir ne remplace pas la confirmation du remboursement.

## 7 Publier une affectation et son avancement

**Départ :** `/admin/fundraiser/expenses`, compte propriétaire et données
synthétiques. Les lecteurs et opérateurs consultent ce registre en lecture seule.

1. Créer une allocation avec les champs requis, le montant et la devise.
2. Décrire l’affectation prévue, le résultat attendu et l’avancement déclaré.
3. Ajouter les références publiques admissibles disponibles.
4. Relire le contenu et confirmer explicitement sa publication de test.
5. Attendre la réponse serveur et retrouver l’entrée dans le registre.
6. Relire le statut et les références dans le registre administratif, puis consulter `/admin/fundraiser/transparency` pour le contexte financier.

**À l’écran :** état de publication et état d’avancement distincts, références
publiques lorsqu’elles sont admissibles.

**Résultat :** utilisation prévue du fonds visible publiquement. Cette opération
ne déclenche aucun paiement fournisseur et ne modifie pas les transactions Stripe.

## 8 Prendre en charge une intervention

**Départ :** `/admin/fundraiser/attention`, avec une intervention disponible.

1. Lire la file et identifier l’intervention à examiner.
2. Ouvrir `/admin/fundraiser/assistant` pour la synthèse des mêmes interventions.
3. Filtrer par catégorie et priorité, puis utiliser « Examiner » sur un élément.
4. Lire son motif et ouvrir le dossier métier exact.
5. Effectuer l’action autorisée dans le parcours métier, avec sa confirmation.
6. Revenir à l’Assistant pour retrouver les filtres et la sélection.

**À l’écran :** catégories, compteurs, priorité, détail et lien vers le dossier.

**Résultat :** intervention prise en charge dans son contexte. Une proposition
préparée par l’Assistant reste privée ; elle n’envoie ni n’enregistre de décision
métier. Le traitement réel reste dans la page métier concernée.

## 9 Gérer les accès et les sessions

**Départ :** `/admin/fundraiser/access`, compte propriétaire et identité de test.

1. Consulter les personnes et leurs rôles.
2. Pour une identité déjà préparée chez le fournisseur, renseigner son identifiant
   vérifié et choisir le rôle approprié dans l’administration.
3. Relire et confirmer le changement, puis vérifier l’état enregistré.
4. Consulter les sessions et sélectionner une session de test à révoquer.
5. Confirmer la révocation et relire le résultat.

**À l’écran :** personnes, rôles, états et sessions accessibles au propriétaire.

**Résultat :** droits administratifs enregistrés et révocation prise en compte.
Modifier un compte ferme ses sessions ; le dernier propriétaire actif ne peut
pas être rétrogradé ou désactivé. Le mot de passe et le second facteur restent
administrés chez le fournisseur d’identité.

## 10 Retrouver une action dans l’audit

**Départ :** `/admin/fundraiser/audit`, compte autorisé et action de test réalisée.

1. Ouvrir le registre d’audit.
2. Retrouver la trace correspondant à l’action et à sa cible.
3. Lire l’acteur, la date, le résultat et la corrélation disponibles.
4. Rapprocher la trace de l’état actuel du dossier métier concerné.

**À l’écran :** historique administratif et résultat enregistré.

**Résultat :** décision ou opération retrouvée avec son contexte. La trace d’une
préparation ou d’une tentative ne vaut pas confirmation d’un paiement ou d’une
livraison externe.

## Consigner une revue avec ChatGPT

Après chaque parcours, conserver une note courte : numéro du parcours, étape
atteinte, résultat observé, preuve ou trace admissible et blocage éventuel. Utiliser
des alias de fixtures pour les dossiers ; ne copier ni coordonnées, ni texte
privé, ni token. Une navigation terminée et une réussite métier restent deux
constats distincts. Le temps humain est inconnu tant qu'il n'a pas été mesuré
volontairement sur une référence comparable.

La qualification locale des sept chantiers est documentée dans les références
propriétaires, avec leurs révisions et leurs limites. La consolidation de ce guide
est documentaire : elle ne réexécute pas ces recettes et ne certifie aucun
fournisseur, accès OIDC déployé ou environnement de production.

## Références dans le dépôt

| Sujet                      | Référence                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Navigation administrative  | [Routes admin](../../apps/funding-web/src/app/admin.routes.ts)                                    |
| Identité et droits         | [Accès administratifs](../operations/admin-identity-and-alerts.md)                                |
| Contributions reçues       | [Notifications et préparation](../operations/contribution-activity.md)                            |
| Revue et médias            | [Modération](../operations/sponsorship-moderation.md), [règles commandites](sponsorship-rules.md) |
| Prestations promises       | [Prestations de services](../technical/admin-campaigns.md)                                        |
| Édition et calendriers     | [Publications](../admin-publication-queue.md)                                                     |
| Envoi autorisé             | [Moteur de publication](../operations/publication-automation.md)                                  |
| Interventions              | [Assistant et file de traitement](../admin-assistant-overview.md)                                 |
| Finances et allocations    | [Transparence](../funding-transparency.md), [règles financières](financial-rules.md)              |
| Factures et remboursements | [Confirmation et recettes financières](../payment-trust-validation.md)                            |

Les références fonctionnelles peuvent décrire aussi leurs consommateurs publics ;
les étapes de navigation de ce guide restent dans la plateforme administrative.
