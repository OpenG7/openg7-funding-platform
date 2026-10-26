# Prompt de reprise — démo des prestations OpenG7

Joindre le blueprint complet et, si possible, le ZIP avec ses captures. Copier
ensuite le texte ci-dessous. Le document contient suffisamment d'explications
pour commencer une discussion fonctionnelle sans accès au dépôt.

---

Je veux poursuivre la conception et le développement de la démo des prestations
OpenG7 décrite dans les documents joints. Sa référence initiale est le commit
`a4370ba3133a42e4f37a9c3c615943b698149144`, PR #383.

Le parcours principal est **Contenu → Consentement → Publication**. Le libellé
affiché doit rester **Consentement**, sans ajouter « du client ». Le contexte
et l'aide précisent qui consent, à quel contenu, sur quels canaux et pour
quelle portée. L'accord sur les prestations promises reste un autre concept.

Commence par lire le blueprint et ses annexes. Présente ensuite une synthèse
de l'expérience actuelle, ses points forts, ses limites et les décisions à
prendre. Si tu n'as pas accès aux sources, fonde tes propositions sur les
documents et les captures; indique les détails techniques qui restent à
vérifier au lieu d'inventer des contrats existants.

Je souhaite d'abord travailler l'expérience et le fonctionnement de la démo.
Une décision de conception ne vaut pas demande d'activer une opération réelle.
Organise tes propositions écran par écran et parcours par parcours, avec le
déclencheur, les informations visibles, l'action principale, le résultat et
le retour. Conserve un parcours court, des libellés simples, une action
principale lisible et la continuité du dossier lorsqu'on ouvre un détour.

Respecte les distinctions du blueprint :

- Fonctions locales réellement présentes, illustrations fixes et évolutions
  proposées doivent être identifiables séparément.
- Conserver un brouillon dans la démo ne l'enregistre pas dans une base. Le
  rechargement efface les saisies locales. La langue et certains paramètres
  d'URL ont une durée de vie différente.
- Les dossiers et leurs étapes sont fictifs. Les coches et l'historique ne
  constituent pas une validation ou un audit réel.
- Le contenu Web et Facebook est actuellement partagé. Ne présume pas que
  deux versions indépendantes existent déjà.
- Une mention saisie est du texte, pas un compte social résolu. Le choix d'une
  pièce conserve seulement son nom; aucun téléversement n'est réalisé.
- Le paiement, la revue, le consentement, la visibilité Web, l'autorisation
  administrative d'envoi et la preuve de réalisation sont distincts.
- Ne déduis aucune nouvelle offre commerciale de la fixture « Web + Facebook ».
  Les engagements réels proviennent de l'offre figée du dossier. Les lots
  collectifs, LinkedIn et les contributions personnelles ne sont pas des
  fonctionnalités de cette démo.
- Modifier le contenu à publier doit conduire, dans une future intégration
  réelle, à réexaminer les décisions qui dépendent de sa version exacte.
- Les opérations d'envoi, publication, visibilité, réconciliation et attestation
  restent sans effet réel tant qu'un raccordement explicitement demandé et
  contrôlé n'a pas été réalisé.

Pour chaque évolution retenue, livre :

1. Le besoin utilisateur et un exemple concret avant/après.
2. Les écrans et composants concernés, avec un schéma ou une maquette si utile.
3. Les données et états nécessaires, leur portée et leur durée de conservation.
4. Les états vide, erreur, indisponible, lecture seule et succès applicables.
5. Les règles clavier, focus, mobile et français/anglais.
6. Les critères d'acceptation et les scénarios de recette.
7. Les décisions à confirmer avant de passer à un service réel.

Si nous passons ensuite au code, tiens compte du monorepo Yarn 4, d'Angular 21
standalone, de TypeScript strict et des instructions AGENTS du dépôt. Examine
les contrats réels avant de proposer un nouvel endpoint, modèle persistant ou
statut. Réutilise les services existants et vérifie les droits côté API. Ne
remplace pas tout l'existant pour reproduire une maquette.

Propose maintenant une liste courte des décisions les plus utiles à traiter,
puis nous développerons le premier parcours choisi. N'active ni publication,
ni envoi, ni opération de production à partir de ce prompt.
