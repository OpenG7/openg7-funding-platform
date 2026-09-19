# Direction UX du volet admin : cockpit opérationnel

> Document de conception initial. Les lots 1 à 8 ont été livrés; les formulations
> prospectives expliquent la direction retenue. Consulter l'[index](README.md)
> pour les contrats livrés et l'[état courant](platform-status.md) pour les preuves
> et les compléments OIDC/alertes.

## Thèse directrice

L'administration est déjà riche en fonctionnalités. Le principal risque UX n'est plus le manque de fonctions, mais la dispersion des tâches : l'administratrice doit savoir où aller pour terminer un processus.

La plateforme devrait plutôt dire : **voici ce qui demande ton attention, et voici la prochaine action**.

Le modèle cible est :

```text
Evenement -> element a traiter -> dossier -> prochaine action -> validation humaine -> termine
```

Aujourd'hui, l'arborescence est surtout organisée autour des modules logiciels : Stripe, factures, publications, courriels et audit. La version supérieure doit être organisée autour du travail à accomplir.

## Priorites de transformation

### 1. Créer un Centre de pilotage

Transformer le haut de l'admin en une boîte de travail centrale avec une file unique **À traiter aujourd'hui**.

Exemples d'éléments :

- 3 commandites à réviser;
- 1 commanditaire en attente d'informations;
- 2 factures manquantes;
- 1 courriel en échec;
- 1 événement Stripe à investiguer;
- 4 publications prêtes;
- 2 créneaux de publication qui approchent.

Chaque élément doit proposer une action directe : **Ouvrir**, **Réviser**, **Relancer**, **Générer**, **Programmer**, etc.

C'est probablement l'amélioration qui ferait gagner le plus de temps.

Le tableau de bord devrait raconter l'état du système plutôt qu'afficher uniquement des métriques isolées :

```text
Fonds des bâtisseurs

124 850 $ encaissés
119 430 $ nets
27 commanditaires

À traiter
3 commandites à réviser
1 courriel en échec
1 événement Stripe à vérifier

Aujourd'hui
2 contributions reçues
1 facture générée
3 publications prévues

Système
Stripe       opérationnel
SMTP         opérationnel
Stockage     opérationnel
PostgreSQL   opérationnel
```

### 2. Donner à l'Assistant une présence contextuelle

L'Assistant peut rester une destination du menu, mais il doit surtout être disponible dans les dossiers et les écrans concernés.

Depuis une commandite, il pourrait signaler :

```text
Cette commandite est payée.
Le logo a été approuvé.
La revue administrative est toujours en attente.
Aucune publication n'a encore été créée.

Prochaine étape recommandée : effectuer la revue.

[Préparer l'approbation] [Demander des informations] [Résumer le dossier]
```

L'Assistant devient ainsi un copilote et non une application séparée.

Le principe de sécurité reste inchangé : il prépare, mais l'humain confirme les mutations sensibles.

### 3. Réduire la dispersion du menu principal

Regrouper les destinations par domaines mentaux :

```text
Pilotage
  Tableau de bord
  À traiter

Opérations
  Contributions
  Commandites
  Publications

Finances
  Factures
  Dépenses
  Transparence

Système
  Courriels
  Audit
  Configuration
```

L'Assistant devient un bouton permanent en haut ou à droite : **Assistant**.

Cette organisation réduit les destinations principales à quatre domaines. **Commandites** doit rester très visible, car c'est probablement l'objet métier le plus riche.

### 4. Faire de la commandite une fiche dossier complète

Une commandite devrait être présentée comme un dossier complet :

```text
ACME Canada                             10 000 $
Payée   Média approuvé   Revue   Publication

Résumé | Identité | Médias | Publication | Facturation | Remboursements | Historique
```

Sous le titre, afficher la prochaine étape et ses actions :

```text
Étape suivante : Réviser la commandite
[Approuver] [Demander des informations] [Refuser]
```

L'administratrice ne devrait presque jamais avoir à déterminer elle-même quel onglet ouvrir ensuite.

### 5. Introduire une progression métier

Une commandite devrait exposer son workflow :

```text
Paiement
   fait
Identité
   fait
Médias
   fait
Revue
   en cours
Facturation
   à venir
Publication
   à venir
```

Une publication devrait suivre :

```text
Brouillon -> Révision -> Approuvée -> Programmée -> Publiée
```

Un remboursement devrait suivre :

```text
Demandé -> Confirmé -> Stripe -> Avoir -> Courriel -> Terminé
```

L'admin expose ainsi le processus métier plutôt que seulement les tables de données.

### 6. Ajouter des badges d'action dans la navigation

Afficher de petits compteurs uniquement pour ce qui nécessite une action :

```text
Tableau de bord
Commandites        3
Publications       4
Courriels          1 !
```

Éviter les compteurs de volume qui ajoutent du bruit, comme `Contributions 1 284`. Les chiffres doivent représenter une file de travail.

### 7. Ajouter une recherche globale

Une recherche persistante pourrait accepter :

- nom d'entreprise;
- courriel;
- identifiant Stripe;
- numéro de facture;
- référence publique;
- montant;
- slug;
- identifiant de contribution.

Les résultats devraient regrouper les objets liés :

```text
ACME Canada

Commandite
10 000 $
Payée - revue en attente

Facture
INV-2026-0184

Publication
1 brouillon
```

Pour une administratrice expérimentée, cette recherche peut devenir le principal moyen de navigation.

### 8. Limiter les changements de page

Utiliser des panneaux latéraux pour les opérations courtes afin de conserver le contexte :

- ajouter une note à une commandite;
- prévisualiser une facture;
- consulter un événement Stripe;
- inspecter un courriel;
- consulter une entrée d'audit;
- examiner une pièce justificative;
- consulter un média ou un historique.

### 9. Différencier les niveaux de risque

Les actions doivent être visuellement hiérarchisées.

Actions normales :

- enregistrer une note;
- modifier un slug;
- créer un brouillon.

Actions importantes :

- approuver;
- programmer;
- publier.

Actions financières ou difficilement réversibles :

- rembourser;
- refuser une commandite;
- supprimer un média.

Seules les actions de la dernière catégorie devraient déclencher une confirmation forte. Des confirmations partout poussent l'admin à cliquer automatiquement sur « Confirmer ».

## Bandeau cible

Une direction possible pour le bandeau principal :

```text
OpenG7 · Fonds des bâtisseurs

Rechercher...

Tableau de bord     À traiter  6

Commandites
Contributions
Publications

Finances
Système

                         Assistant
```

## Ordre recommandé de mise en oeuvre

1. **À traiter** et actions directes depuis le tableau de bord.
2. Assistant contextuel dans les dossiers.
3. Fiche commandite orientée workflow avec prochaine action.
4. Progression métier et badges de navigation.
5. Recherche globale.
6. Panneaux latéraux et hiérarchie visuelle des actions sensibles.

Avec le niveau actuel de fonctionnalités, les trois changements à plus fort impact sont donc :

- **À traiter**;
- l'Assistant contextuel;
- la fiche commandite orientée workflow.

## Contraintes à préserver

- Le paiement est confirmé par Stripe et le serveur.
- Une commandite payée n'est pas automatiquement publiée.
- Les remboursements sont idempotents et auditables.
- Les données privées ne sont jamais exposées publiquement.
- Les actions sensibles exigent une validation humaine.
- L'Assistant ne publie, ne rembourse et ne modifie aucun état sensible sans confirmation explicite.
