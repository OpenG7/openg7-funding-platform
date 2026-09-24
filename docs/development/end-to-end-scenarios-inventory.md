# Inventaire des scénarios de bout en bout

Inventaire conservé à la demande de l’utilisateur le 22 septembre 2026, à partir
du code de la révision `2e52f6bf8e48985cf8026f1c80f52887957cf6ee` (PR #146).
Les numéros 1 à 71 reprennent la réponse de référence de la conversation et
permettent de désigner les scénarios lors des prochains travaux.

Il complète le parcours **50 $ CAD → notifications → cartouche privée** décrit
dans le [guide des contributions reçues](../operations/contribution-activity.md).
Il s’agit d’un inventaire fonctionnel, pas d’une preuve que chaque scénario a
été testé intégralement. Les envois externes dépendent des fournisseurs configurés ;
les publications exigent une approbation administrative. Cet inventaire daté ne
remplace ni les contrats propriétaires ni le code courant et ne constitue pas une
autorisation d’exécuter des opérations réelles.

Première priorité testée le 22 septembre 2026 : **contribution personnelle →
confirmation → reconnaissance consentie et transparence**, soit les scénarios
1, 2, 3 et 8, puis les totaux et l’export JSON du scénario 59. Les quatre
combinaisons de consentements passent dans une pile jetable avec fournisseurs
simulés. Voir la [recette et ses limites](../payment-trust-validation.md#recette-complète-dune-contribution-personnelle).

Deuxième priorité testée le 23 septembre 2026 : **commandite de 500 CAD → dossier et médias → revue →
Facebook et LinkedIn simulés**. La recette cible les scénarios 6, 11, 18, 20,
35, 36 et 39, ainsi que la pause et la reprise des destinations du scénario 41.
La visibilité de la fiche Web reste une décision distincte des envois sociaux.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--commandite-de-500-cad-et-deux-destinations).

Troisième priorité testée le 23 septembre 2026 : **remboursements partiels puis
intégral → avoirs et courriels → totaux et transparence**. Les variantes 200 puis
300 CAD et 500 CAD en une fois passent avec fournisseurs simulés. La recette
couvre les scénarios 28, 29, 30 et 61, la création et le PDF de facture du scénario
25, ainsi que les totaux et l’export JSON du scénario 59. Elle corrige la collision
des numéros d’avoirs multiples et les libellés erronés des avoirs partiels.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-des-remboursements-et-avoirs).

Quatrième priorité testée le 23 septembre 2026 : **publication programmée →
remboursement ou contestation → blocage avant envoi**, soit les scénarios 31 et 44,
avec remboursement intégral du scénario 29. Trois commandites de 500 CAD donnent
six publications autorisées : les quatre devenues inadmissibles sont bloquées
avant échéance, les deux témoins partent une seule fois en simulation. Les rejeux
ne rétablissent aucune autorisation. L’interface précise le motif et ouvre le dossier.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--paiement-invalidé-après-programmation).

Cinquième priorité testée le 23 septembre 2026 : **réponse sociale perdue →
redémarrage → vérification ou nouvelle approbation sans doublon**, soit le scénario 43. Les publications retrouvées sont confirmées sans renvoi ; les publications
absentes exigent une attestation motivée, un brouillon et une nouvelle approbation.
Les témoins prouvent que le worker redémarré continue à traiter les autres envois.
Les reçus du fournisseur simulé comptent chaque requête et chaque publication.
Voir la [recette et ses limites](../sponsorship-e2e-coverage.md#recette-navigateur--résultat-incertain-et-reprise-sans-doublon).

Sixième priorité testée le 23 septembre 2026 : **courriel de récupération en échec →
redémarrage du worker → relance concurrente → reprise du brouillon et soumission**.
La recette couvre les scénarios 12, 15 et 54, ainsi que le regroupement d’un renvoi
administratif récent du scénario 16. Une entreprise paie 500 CAD, ferme son
navigateur et retrouve son brouillon par le lien du courriel capturé dans Mailpit.
Deux refus SMTP puis une relance réussie donnent un seul message accepté ; le
paiement reste confirmé et le dossier attend une revue distincte de la publication.
Voir la [recette et ses limites](../sponsorship-access-and-drafts.md#recette-complete-courriel-en-echec-et-reprise-du-dossier).

Septième priorité testée le 23 septembre 2026 : **paiement abandonné, refusé ou
expiré → retour explicite → nouvelle tentative de 500 CAD → confirmation unique**,
soit le scénario 7 et les événements tardifs/répétés du scénario 61. Aucune facture,
notification de paiement reçu ni recette n'est créée pour la tentative non payée.
La nouvelle tentative confirmée produit un toast, un courriel admin, un SMS capturé
et une facture, sans doublon après rejeu. Le dossier reste privé et en attente de
revue. Les messages de reprise sont vérifiés sur mobile en FR/EN.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-de-reprise-après-paiement-interrompu).

Huitième priorité testée le 23 septembre 2026 : **paiement confirmé → webhook
interrompu → redémarrage → reprise sans doublon**, soit le scénario 62 avec
rediffusion locale signée, sans exécution du CLI d'exploitation. Les deux pannes
ciblent l'écriture de la facture puis la connexion PostgreSQL avant mise en file
de son courriel. Les compteurs admin FR/EN reflètent l'interruption et la reprise ;
la facture, les totaux, le toast et les courriels/SMS restent uniques après rejeu.
Voir la [recette et ses limites](../payment-trust-validation.md#recette-de-reprise-après-interruption-du-webhook).

## Contributions et accès au suivi

|  Nº | Scénario                             | Parcours de bout en bout                                                                                                           |
| --: | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Contribution personnelle             | Choisir un montant → consentements → Checkout → confirmation serveur → contribution enregistrée et totaux actualisés.              |
|   2 | Reconnaissance personnelle           | Contribuer avec consentement public → apparition dans les Bâtisseurs ; affichage du montant selon un consentement distinct.        |
|   3 | Contribution privée                  | Payer sans consentement public → contribution comptabilisée sans inscription nominative dans l’annuaire.                           |
|   4 | Commandite de 100 $                  | Paiement → suivi privé → fiche et médias → revue administrative → reconnaissance sur le site.                                      |
|   5 | Commandite de 250 $                  | Paiement → dossier → admissibilité à la mention Web et à Facebook → préparation → approbation → envoi configuré.                   |
|   6 | Commandite de 500 $                  | Même parcours, avec admissibilité supplémentaire à LinkedIn.                                                                       |
|   7 | Paiement abandonné, refusé ou expiré | Tentative de paiement → état non confirmé → aucun montant présenté comme encaissé → nouvelle tentative possible.                   |
|   8 | Confirmation retardée                | Retour du paiement encore en attente → actualisation → confirmation reçue du serveur → progression du dossier.                     |
|   9 | Recherche d’une contribution         | Saisir sa référence dans Support → consulter le statut autorisé → accéder à l’étape suivante.                                      |
|  10 | Référence oubliée                    | Demander une récupération par courriel → réponse publique uniforme → recevoir les références admissibles si un dossier correspond. |

## Dossiers commanditaires

Le suivi fonctionne sans compte utilisateur.
[Contrat du suivi](../sponsorship-access-and-drafts.md).

|  Nº | Scénario                               | Parcours de bout en bout                                                                                                         |
| --: | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|  11 | Première soumission                    | Ouvrir le lien privé → remplir les informations → joindre les médias → soumettre à l’équipe → dossier à examiner.                |
|  12 | Formulaire interrompu                  | Commencer une fiche → sauvegarde automatique serveur → revenir, éventuellement sur un autre appareil → reprendre et soumettre.   |
|  13 | Abandon des modifications              | Restaurer un brouillon → abandonner explicitement → conserver la fiche déjà soumise.                                             |
|  14 | Modifications concurrentes             | Modifier depuis deux onglets → détecter le conflit → conserver la saisie locale → choisir explicitement la version à reprendre.  |
|  15 | Lien perdu ou expiré                   | Demander un nouveau lien avec le courriel du paiement → recevoir l’accès → reprendre le dossier.                                 |
|  16 | Renvoi administratif du suivi          | Ouvrir le dossier → vérifier le destinataire → confirmer le renvoi → message en file et action auditée.                          |
|  17 | Informations manquantes                | Admin détecte un dossier incomplet → prépare et confirme une demande → entreprise reçoit le courriel → complète et soumet.       |
|  18 | Validation des médias                  | Téléverser logo/photos → stockage privé → revue administrative → utilisation des médias approuvés dans les surfaces admissibles. |
|  19 | Remplacement ou suppression d’un média | Sélectionner le fichier → confirmer l’action requise → mettre à jour le dossier et sa disponibilité publique.                    |
|  20 | Acceptation d’une commandite           | Examiner fiche, consentement et médias → approuver → fiche admissible à l’annuaire selon les conditions de visibilité.           |
|  21 | Refus d’une commandite                 | Refuser avec motif → notifier éventuellement l’entreprise → enregistrer séparément le traitement prévu du remboursement.         |
|  22 | Modification après approbation         | Entreprise ouvre explicitement l’édition → modifie et soumet → nouvelle revue des informations.                                  |
|  23 | Correction administrative              | Corriger identité, contact ou site → confirmer avec motif → enregistrer la correction et son audit.                              |
|  24 | Revue oubliée                          | Dossier complet payé laissé en attente → rappel administratif configuré → admin reprend la revue.                                |

## Facturation et remboursements

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                              |
| --: | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
|  25 | Facture de commandite              | Paiement confirmé → création de la facture → courriel en file → consultation et téléchargement du PDF.                                                |
|  26 | Facture historique manquante       | Repérer une commandite admissible → générer la facture manquante → la rendre consultable sans envoi automatique.                                      |
|  27 | Renvoi de facture ou d’avoir       | Choisir le document → vérifier ou corriger le destinataire → confirmer → suivre la livraison du courriel.                                             |
|  28 | Remboursement partiel              | Saisir montant et motif → confirmer la référence → demande Stripe → suivi du remboursement → avoir si facture correspondante.                         |
|  29 | Remboursement intégral             | Confirmer le remboursement → réponse Stripe ou webhook ultérieur → statut remboursé → avoir et notification selon configuration.                      |
|  30 | Remboursement échoué ou concurrent | Échec fournisseur ou dossier modifié par un autre admin → résultat explicite → investigation sans faux succès ni dépassement du montant remboursable. |
|  31 | Contestation du paiement           | Événement Stripe de contestation → mise à jour du dossier → prise en compte dans les règles de traitement.                                            |

## Publications

Les destinations prévues sont Facebook et LinkedIn, pour OpenG7 et OpenG20.
[Contrat du moteur](../operations/publication-automation.md).

|  Nº | Scénario                         | Parcours de bout en bout                                                                                                                                 |
| --: | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  32 | Préparation manuelle             | Sélectionner une commandite admissible → créer un brouillon → modifier le texte → soumettre à la validation.                                             |
|  33 | Publication collective           | Créer un lot → y affecter plusieurs brouillons → contrôler sa capacité → préparer le contenu collectif.                                                  |
|  34 | Planification au calendrier      | Créer un créneau → affecter un brouillon ou un lot → choisir la date → enregistrer ou déplacer la planification.                                         |
|  35 | Préparation récurrente           | Configurer jours, heure, fuseau et capacité → activer le moteur → génération de créneaux et propositions privées.                                        |
|  36 | Envoi social autorisé            | Examiner texte exact, image, compte et date → approuver → destination active → worker envoie à échéance, navigateur fermé compris.                       |
|  37 | Publication éditoriale           | Rédiger une actualité, réalisation ou nouvelle de campagne → choisir destination et date → approuver → envoi.                                            |
|  38 | Publication faite extérieurement | Publier manuellement sur le réseau → enregistrer le lien et le statut dans l’application après confirmation.                                             |
|  39 | Modification après approbation   | Changer texte, média ou date → retrait de l’autorisation précédente → nouvelle approbation nécessaire.                                                   |
|  40 | Refus ou annulation              | Refuser une proposition ou annuler un envoi programmé → conserver l’historique → empêcher cet envoi.                                                     |
|  41 | Pause et reprise                 | Suspendre une destination ou arrêter le moteur → conserver les traitements persistés → reprendre explicitement.                                          |
|  42 | Compte social indisponible       | Connexion absente, expirée ou invalide → publication bloquée → correction de configuration → contrôle et reprise autorisée.                              |
|  43 | Résultat d’envoi incertain       | Réponse fournisseur perdue → investigation du compte réel → rapprochement avec la publication existante, ou absence attestée avant nouvelle préparation. |
|  44 | Source devenue inadmissible      | Paiement, revue, consentement ou destination incompatible → blocage → proposition de recomposition → nouvelle validation.                                |

## Parcours éditoriaux supervisés

[Ma semaine](../operations/editorial-programme.md).

|  Nº | Scénario                | Parcours de bout en bout                                                                                                                            |
| --: | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
|  45 | Session de traitement   | Lire le briefing → ouvrir les décisions prioritaires → examiner et traiter les dossiers → consulter les résultats.                                  |
|  46 | Composer une semaine    | Choisir une cadence → obtenir une proposition → examiner collisions et répétitions → appliquer les changements → réapprouver les éléments modifiés. |
|  47 | Répétition générale     | Parcourir chronologiquement textes, images, destinations et dates → repérer les blocages avant tout envoi.                                          |
|  48 | Variante éditoriale     | Demander une transformation reconnue du texte → comparer avant/après → enregistrer la variante choisie.                                             |
|  49 | Préférences éditoriales | Accumuler des corrections reconnues → recevoir une suggestion → activer une préférence pour les futures préparations admissibles.                   |
|  50 | Pilotage guidé          | Suivre le guide interactif → naviguer au clavier ou à la manette → ouvrir les dossiers → confirmer les actions permises par son rôle.               |

## Opérations administratives quotidiennes

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                             |
| --: | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
|  51 | Traitement d’une anomalie          | Ouvrir « À traiter » ou l’Assistant → lire les faits → accéder au dossier exact → corriger → actualiser la file.                                     |
|  52 | Recherche transversale             | Rechercher une référence, entreprise ou document → ouvrir le résultat → consulter facture, contribution, publication ou dossier associé.             |
|  53 | Export privé des contributions     | Filtrer les contributions → confirmer l’export privé → obtenir le CSV administratif.                                                                 |
|  54 | Courriel échoué                    | Consulter le message et son état → corriger la cause → relancer un message admissible → suivre le nouveau résultat.                                  |
|  55 | Vérification de configuration      | Ouvrir Configuration → consulter l’état des services → lancer un courriel de test → vérifier sa livraison.                                           |
|  56 | Gestion des accès                  | Se connecter → accéder aux fonctions du rôle ; en OIDC, gérer les comptes, modifier les rôles ou révoquer les sessions.                              |
|  57 | Investigation et audit             | Partir d’un incident → inspecter les faits Stripe, documents et actions administratives → retrouver acteur, date et résultat.                        |
|  58 | Allocation ou réalisation publique | Créer un brouillon avec montant, description, avancement et preuves → publier → rendre visible dans la transparence → modifier, masquer ou archiver. |

## Transparence et reprise technique

|  Nº | Scénario                              | Parcours de bout en bout                                                                                                                               |
| --: | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
|  59 | Consultation financière publique      | Ouvrir Transparence → choisir une période → consulter contributions, frais, remboursements et versements → exporter JSON/CSV ou partager la vue.       |
|  60 | Frais Stripe reçus tardivement        | Paiement enregistré avec frais incomplets → réception de `charge.updated` → enrichissement des frais et du net sans doubler la transaction.            |
|  61 | Webhook répété ou désordonné          | Recevoir plusieurs livraisons → dédupliquer et appliquer les transitions autorisées → conserver un état financier cohérent.                            |
|  62 | Reprise d’un webhook échoué           | Corriger la cause → rejouer l’événement via l’outil d’exploitation → reprendre le traitement sans recréer les effets déjà confirmés.                   |
|  63 | Paiement historique absent de la base | Scanner Stripe sur un périmètre choisi → rapprocher les paiements du projet → compléter les données sans renvoyer les notifications historiques.       |
|  64 | Versement Stripe                      | Recevoir un versement réussi ou échoué → enregistrer le mouvement → le retrouver dans la projection financière.                                        |
|  65 | Alerte opérationnelle                 | Détecter un courriel ou événement Stripe en échec, ou une indisponibilité DB → envoyer une alerte signée au récepteur configuré → suivre les reprises. |
|  66 | Sauvegarde et restauration            | Sauvegarder PostgreSQL → restaurer sur une cible dédiée → vérifier la récupération ; parcours d’exploitation par scripts.                              |

## Parcours publics de découverte et d’aide

|  Nº | Scénario                           | Parcours de bout en bout                                                                                                                       |
| --: | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
|  67 | Consultation des annuaires         | Parcourir Bâtisseurs ou Commanditaires → consulter les fiches admissibles et publications disponibles → accéder à la contribution ou au suivi. |
|  68 | Découverte du projet               | Accueil, À propos ou Écosystème → comprendre le fonds et les plateformes → rejoindre le formulaire de contribution.                            |
|  69 | Demande d’aide ou de remboursement | Consulter la FAQ et la politique → retrouver sa référence → contacter l’équipe → traitement humain du dossier.                                 |
|  70 | Boutique et musique                | Consulter les contenus → suivre les liens proposés vers les services externes ; ces pages ne constituent pas un commerce intégré.              |
|  71 | Participation technique            | Support → guide de contribution ou formulaire GitHub de signalement/suggestion → poursuite sur le service externe.                             |

## Variantes et limites

Les variantes **FR/EN, mobile, navigation clavier, session expirée et erreur réseau
avec reprise** traversent plusieurs de ces scénarios.

Les SMS restent simulés ; l’assistant conversationnel n’a pas de fournisseur IA
réel raccordé ; une allocation publiée ne déclenche pas un paiement fournisseur ;
un remboursement ne retire pas automatiquement toute reconnaissance publique
selon la politique actuelle.

Les recettes futures pourront référencer ces numéros en précisant le périmètre,
la révision testée, les préconditions, les fournisseurs simulés ou réels et les
résultats observés. Une présence dans cet inventaire ne vaut pas preuve de test.
