# Ma semaine — préparation éditoriale supervisée

Depuis `/admin/fundraiser/pilotage`, ouvrir **Ma semaine**. Les six parcours
partagent une projection des publications, leurs faits actuels et les reçus du
pilotage. Il n'existe pas de deuxième file d'envoi.

## Parcours livrés

- **Mon briefing** : brouillons à examiner, autorisations, incidents et dernière
  publication approuvée. Cette dernière date ne garantit pas une couverture sans
  trou. Les priorités reprennent la file courante et ses filtres. La session de
  cinq minutes conserve son début et son compteur dans la session du navigateur,
  liés au compte, sans interrompre la revue à l'expiration des cinq minutes.
- **Composer la semaine** : cadence de 1 à 7 publications, réparties dans les sept
  prochains jours au fuseau du feed. Les autorisations existantes restent fixes
  par défaut. Leur inclusion est explicite. Alternance des commanditaires quand
  possible, collisions à moins de 30 minutes, texte identique à moins de sept
  jours et répétition d'un commanditaire à moins de trois jours sont signalés.
  Les lots sans créneau gardent leur date; aucun contenu n'est inventé pour
  combler un trou. Les déplacements de 30 minutes ou 24 heures sont absolus.
  La cadence proposée est ponctuelle, sans changer les récurrences du feed.
- **Répétition générale** : déroulement chronologique du contenu, des visuels
  privés, destinations et dates, y compris les changements encore proposés.
  Les blocages sont visibles; cet aperçu ne contacte aucun fournisseur social
  et n'imite pas exactement sa mise en page.
- **Variante de texte** : quatre intentions reconnues en français et anglais :
  raccourcir, ton neutre, projet en premier, introduction LinkedIn. Les textes
  sont transformés de façon déterministe, sans modèle externe ni nouveau fait.
  La destination ne change pas. L'interface compare les passages avant/après.
  Une intention non reconnue échoue explicitement. La dictée vocale et la
  rédaction générative libre ne sont pas des capacités de ce parcours.
- **Préférences** : nombre de publications distinctes corrigées avec une
  intention reconnue; suggestion à partir de trois. Seules les variantes
  réellement enregistrées sont comptées. Les préférences sont partagées par
  destination, activables et désactivables après confirmation. Elles affectent
  les préparations automatiques intactes, jamais les modifications humaines,
  autorisations, refus ou envois incertains.
- **Résoudre les incidents** : les faits de paiement, consentement, revue,
  visibilité et destination expliquent les lots touchés. Une recomposition
  propose les sources encore admissibles et, s'il existe des brouillons libres,
  des remplaçants admissibles. Elle retire le média d'un commanditaire exclu.
  Les dossiers et leur historique financier restent conservés. Les envois
  incertains ou déjà engagés dans l'ancien moteur exigent une investigation.

## Autorité et transactions

La préparation, le calendrier proposé et la simulation sont sans mutation.
Les trois nouvelles commandes du catalogue sont `programme.apply`,
`editorial.preferences` et `publication.repair`. L'édition existante peut porter
`editorialIntent`; le serveur vérifie alors le texte exact avant de comptabiliser
la correction. Les autorisations, l'origine, la confirmation de la cible, la
version, l'UUID et les reçus du pilotage s'appliquent aussi à ces commandes.

`GET /api/admin/pilotage/programme` expose la projection privée (`no-store`).
`POST` sur cette route propose un calendrier; `POST /api/admin/pilotage/variant`
propose une transformation. Les alias `/admin/...` conservent les mêmes contrôles.
Ces POST sont réservés aux opérateurs/propriétaires et ne publient rien.

Une empreinte des destinations, dossiers, préférences et incidents protège
l'application d'un calendrier contre les modifications concurrentes. Les
déplacements d'une destination sont atomiques, versionnés et limités à 100
publications. Ils réutilisent l'édition du moteur, qui retire toute autorisation
précédente. Une approbation humaine du nouveau contenu/date demeure requise.
La recomposition verrouille sources et lot, puis recalcule la proposition : un
consentement ou contenu changé invalide la proposition lue. Le reçu ne rejoue
jamais une opération ambiguë; la procédure du pilotage reste applicable.

À chaque passage du worker déjà activé, un contrôle préalable met en blocage les
lots préparés/approuvés dont une source devient inadmissible, même avant leur
échéance. Il révoque l'autorisation et audite les raisons. Les vérifications
juste avant l'envoi demeurent en place. Un worker arrêté ne réalise pas ce
contrôle en arrière-plan; la projection continue de signaler les faits invalides.

## Activation et limites

Appliquer uniquement la migration additive
[025](../../apps/funding-api/migrations/025_create_publication_editorial_profiles.sql)
après 024, selon le [runbook des migrations](database-migrations.md). Elle ajoute
les préférences et observations sans activer un feed, un worker ou un fournisseur.
Sans elle, le programme reste consultable sans ses commandes; la préparation
historique continue sans préférences. Les observations ne stockent ni instruction
libre, ni texte privé, ni entrées de manette.

La projection reprend la fenêtre de 200 publications du moteur. Si tous les
dossiers actifs n'y tiennent pas, elle se déclare incomplète et empêche
l'application d'un programme. Les propositions sont renouvelées explicitement;
elles ne changent pas pendant la lecture.

## Recette

Les tests de domaine couvrent les intentions, faits protégés, alternance,
collisions et créneaux indisponibles. Les tests PostgreSQL jetables couvrent
l'ajout de 025 sur une base existante, versions/concurrence, annulation atomique,
préférences et préservation des corrections humaines, retrait de consentement,
recomposition sans envoi et couverture partielle. Les routes HTTP réelles sont
testées avec rôles OIDC, origine et cache privé. Les tests navigateur emploient
des fixtures synthétiques et une manette simulée, sans fournisseur réel.

```sh
yarn build
node --test tests/editorial-programme.test.mjs tests/integration/editorial-programme.integration.mjs tests/integration/admin-pilotage.integration.mjs
yarn workspace @openg7/funding-web build --configuration production
yarn tsc -p tests/tsconfig.admin-ui.json
yarn playwright test --config tests/playwright-admin-ui.config.mjs admin-pilotage.spec.ts
```

La qualification Xbox physique et les permissions des fournisseurs restent
distinctes de ces preuves. Voir le [pilotage](admin-pilotage.md) et le
[moteur de publication](publication-automation.md).
