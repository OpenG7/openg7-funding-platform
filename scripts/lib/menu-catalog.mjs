export const MENU_CATEGORIES = [
  { id: 'development', label: 'Démarrer le développement' },
  { id: 'docker', label: 'Gérer Docker' },
  { id: 'checks', label: 'Vérifier, tester et compiler' },
  { id: 'database', label: 'Base de données' },
  { id: 'stripe', label: 'Stripe en mode test' },
  { id: 'email', label: 'Courriels et DNS' },
  { id: 'tls', label: 'Certificats HTTPS locaux' },
  { id: 'docs', label: 'Documentation' },
  { id: 'images', label: 'Optimiser les images' },
  { id: 'advanced', label: 'Production, VPS, stockage et Stripe live' },
  { id: 'other', label: 'Autres outils' }
];

// Known local commands explicitly opt out of confirmation.
// New scripts remain available, but always require confirmation.
const commandDefinitions = {
  dev: {
    label: 'Démarrer le Web et l’API',
    confirmation: false,
    continuous: true
  },
  'dev:web': {
    label: 'Démarrer le Web',
    confirmation: false,
    continuous: true
  },
  'dev:api': { label: 'Démarrer l’API', confirmation: false, continuous: true },
  'docker:up': {
    label: 'Démarrer Docker — choisir l’environnement',
    note: 'Le questionnaire peut cibler la production. En mode local, l’écoute Stripe garde le terminal occupé.'
  },
  'docker:up:dev': { label: 'Démarrer Docker local', continuous: true },
  'docker:up:dev:token': {
    label: 'Démarrer Docker local avec un jeton admin',
    continuous: true
  },
  'docker:up:dev:keycloak': {
    label: 'Démarrer Docker local avec Keycloak',
    continuous: true
  },
  'docker:up:prod': {
    label: 'Démarrer Docker en production — choisir l’authentification'
  },
  'docker:up:prod:keycloak': {
    label: 'Démarrer Docker en production avec Keycloak'
  },
  'docker:up:prod:oidc': {
    label: 'Démarrer Docker en production avec OIDC externe'
  },
  'docker:playwright': {
    label: 'Démarrer la pile Docker des tests Playwright'
  },
  'docker:recreate': { label: 'Recréer les conteneurs Web et API' },
  'docker:update': {
    label: 'Mettre à jour Docker — choisir les options',
    note: 'Vérifier l’environnement choisi et les options de suppression d’images avant la mise à jour.'
  },
  'docker:update:dev': {
    label: 'Mettre à jour Docker local et écouter Stripe',
    continuous: true,
    note: 'Met à jour les services locaux, supprime les images inutilisées et démarre l’écoute Stripe.'
  },
  'docker:down': {
    label: 'Arrêter et retirer les conteneurs Docker',
    note: 'Retire les conteneurs et les réseaux Compose. Sans -v/--volumes, les volumes sont conservés.'
  },
  'db:up': { label: 'Démarrer PostgreSQL dans Docker' },
  'db:stop': { label: 'Arrêter PostgreSQL' },
  'db:logs': { label: 'Suivre les journaux PostgreSQL', continuous: true },
  'db:psql': {
    label: 'Ouvrir une console SQL',
    continuous: true,
    note: 'La console SQL permet de modifier la base configurée.'
  },
  'db:migrate': {
    label: 'Appliquer les migrations de la base',
    note: 'Applique des changements de schéma à la base configurée.'
  },
  'db:backup': {
    label: 'Sauvegarder la base de données',
    note: 'Vérifier la base cible et l’emplacement privé de la sauvegarde.'
  },
  'db:restore': {
    label: 'Restaurer la base depuis une sauvegarde',
    note: 'Vérifier la cible et la sauvegarde; la restauration remplace des données.'
  },
  'prod:check': { label: 'Vérifier la pile de production' },
  'prod:deploy': { label: 'Déployer en production' },
  'prod:backup': { label: 'Sauvegarder la production' },
  'prod:rollback': { label: 'Revenir à une version précédente en production' },
  'services:check': {
    label: 'Vérifier la configuration et les outils locaux',
    confirmation: false
  },
  'keycloak:check': {
    label: 'Vérifier la configuration Keycloak locale',
    confirmation: false
  },
  'smoke:public': {
    label: 'Vérifier les endpoints publics de la cible configurée'
  },
  'storage:check': { label: 'Vérifier le stockage OVH' },
  'storage:test': { label: 'Tester le stockage OVH' },
  'storage:provision': { label: 'Provisionner le stockage OVH' },
  'storage:publish': { label: 'Publier des médias de commanditaires' },
  'storage:unpublish': { label: 'Retirer la publication de médias' },
  'vps:ssh': { label: 'Ouvrir une session SSH sur le VPS', continuous: true },
  'vps:env': { label: 'Configurer l’environnement du VPS' },
  'vps:node:install': { label: 'Installer Node.js sur le VPS' },
  'vps:update': { label: 'Mettre à jour le VPS' },
  'vps:deploy': { label: 'Déployer sur le VPS' },
  'vps:rollback': { label: 'Revenir à une version précédente sur le VPS' },
  'vps:check': { label: 'Vérifier les services du VPS' },
  'vps:logs': { label: 'Consulter les journaux du VPS' },
  'vps:ps': { label: 'Afficher les conteneurs du VPS' },
  'vps:backup': { label: 'Sauvegarder le VPS' },
  'vps:backup:list': { label: 'Lister les sauvegardes du VPS' },
  'vps:backup:download': { label: 'Télécharger une sauvegarde du VPS' },
  'vps:db:update': { label: 'Mettre à jour la base sur le VPS' },
  'vps:db:psql': {
    label: 'Ouvrir une console SQL sur le VPS',
    continuous: true
  },
  'vps:db:backup': { label: 'Sauvegarder la base du VPS' },
  'vps:db:backup:list': { label: 'Lister les sauvegardes de la base du VPS' },
  'vps:db:backup:download': {
    label: 'Télécharger une sauvegarde de la base du VPS'
  },
  'stripe:cli:install': {
    label: 'Installer Stripe CLI globalement',
    note: 'Installe un outil global via npm.'
  },
  'stripe:webhook:listen': {
    label: 'Écouter les webhooks Stripe en mode test',
    continuous: true,
    note: 'Transmet les événements Stripe de test à l’API configurée et garde le terminal occupé.'
  },
  'stripe:events:resend': {
    label: 'Renvoyer des événements Stripe en mode test',
    note: 'Exige des identifiants d’événements. Vérifier compte, endpoint, volume et mode; commencer par --dry-run.'
  },
  'stripe:events:resend:live': { label: 'Renvoyer des événements Stripe live' },
  'stripe:backfill': {
    label: 'Récupérer l’historique Stripe en mode test',
    note: 'Peut modifier la base configurée. Vérifier compte, dates et volume; commencer par --dry-run.'
  },
  'stripe:backfill:live': { label: 'Récupérer l’historique Stripe live' },
  'email:dns': { label: 'Vérifier les enregistrements DNS des courriels' },
  'email:verify': { label: 'Vérifier la connexion SMTP' },
  'email:test': {
    label: 'Envoyer un courriel de test réel',
    note: 'Envoie réellement un message au destinataire configuré.'
  },
  'tls:local:setup': {
    label: 'Installer les certificats HTTPS locaux',
    note: 'Modifie les certificats locaux; peut installer une autorité de certification de confiance.'
  },
  'tls:local:renew': {
    label: 'Renouveler les certificats HTTPS locaux',
    note: 'Remplace les certificats locaux; vérifier les domaines et l’autorité de certification.'
  },
  'playwright:install': {
    label: 'Installer le navigateur Chromium pour Playwright'
  },
  lint: { label: 'Vérifier le code avec ESLint', confirmation: false },
  format: {
    label: 'Reformater les fichiers du dépôt',
    note: 'Réécrit les fichiers du dépôt; vérifier les modifications en cours.'
  },
  'format:check': {
    label: 'Vérifier le format des fichiers',
    confirmation: false
  },
  test: { label: 'Compiler et lancer les tests Node', confirmation: false },
  'test:integration': {
    label: 'Compiler et lancer les tests d’intégration',
    confirmation: false
  },
  'test:sponsorship': {
    label: 'Vérifier les scénarios de commandite',
    confirmation: false
  },
  'test:e2e:seed': {
    label: 'Créer les données de test dans la base',
    note: 'Insère des données de test dans la base configurée.'
  },
  'test:e2e:seed:cleanup': {
    label: 'Supprimer les données de test de la base',
    note: 'Supprime les données de test et réinitialise le simulateur Stripe configuré.'
  },
  'test:e2e:playwright': {
    label: 'Démarrer Docker, migrer, préparer et tester avec Playwright',
    note: 'Démarre ou réutilise Docker local, applique les migrations et modifie les données de test.'
  },
  'test:e2e:acceptance': {
    label: 'Lancer la recette admin dans une pile Docker jetable',
    note: 'Crée puis retire une pile Docker jetable de recette.'
  },
  'test:e2e:identity': {
    label: 'Tester l’identité dans une pile Docker jetable',
    note: 'Crée une pile locale jetable pour les tests d’identité.'
  },
  'test:ui:admin': { label: 'Tester l’interface admin', confirmation: false },
  'test:ui:followup': {
    label: 'Tester les parcours de suivi',
    confirmation: false
  },
  'test:ui:funding-home': {
    label: 'Tester la page d’accueil',
    confirmation: false
  },
  'test:ui:funding-about': {
    label: 'Tester la page À propos',
    confirmation: false
  },
  'test:ui:funding-transparency': {
    label: 'Tester les pages de transparence',
    confirmation: false
  },
  'test:ui:sponsors': {
    label: 'Tester les pages de commanditaires',
    confirmation: false
  },
  'test:ui:public-journeys': {
    label: 'Tester les parcours publics',
    confirmation: false
  },
  'test:ui:platform-accessibility': {
    label: 'Tester l’accessibilité de la plateforme',
    confirmation: false
  },
  'test:rehearsal': {
    label: 'Tester les fournisseurs dans un environnement jetable',
    note: 'Utilise des fournisseurs et une base jetables de test.'
  },
  'test:automation': {
    label: 'Tester les automatisations et les parcours publics'
  },
  build: {
    label: 'Compiler les packages et l’API TypeScript',
    confirmation: false
  },
  docs: { label: 'Générer la documentation TypeDoc', confirmation: false },
  'docs:check': {
    label: 'Vérifier les standards et la documentation',
    confirmation: false
  },
  'docs:report': {
    label: 'Afficher le rapport des contrôles documentaires',
    confirmation: false
  },
  'images:funding-home': {
    label: 'Optimiser les images de la page d’accueil',
    confirmation: false
  },
  'images:sponsors': {
    label: 'Optimiser les images des commanditaires',
    confirmation: false
  },
  'images:support': {
    label: 'Optimiser les images des contributions',
    confirmation: false
  },
  'providers:verify': {
    label: 'Vérifier l’accès aux fournisseurs configurés',
    note: 'Contacte les fournisseurs de l’environnement configuré.'
  },
  'operations:watch': {
    label: 'Démarrer la surveillance et l’envoi des alertes',
    continuous: true,
    note: 'Lit la base configurée et envoie des alertes au webhook de supervision.'
  },
  opencode: {
    label: 'Ouvrir OpenCode avec l’environnement du dépôt',
    continuous: true,
    note: 'Donne à un outil externe accès à l’environnement du dépôt.'
  }
};

function categoryFor(name) {
  if (/(?:^|:)(?:prod|production|vps|storage|live)(?:$|:)/i.test(name)) {
    return 'advanced';
  }

  const prefix = name.split(':')[0];
  const categories = {
    dev: 'development',
    docker: 'docker',
    db: 'database',
    stripe: 'stripe',
    email: 'email',
    tls: 'tls',
    docs: 'docs',
    images: 'images',
    test: 'checks',
    build: 'checks',
    lint: 'checks',
    format: 'checks',
    services: 'checks',
    keycloak: 'checks',
    smoke: 'checks',
    providers: 'checks'
  };

  return Object.hasOwn(categories, prefix) ? categories[prefix] : 'other';
}

export function createCommandCatalog(scripts) {
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return [];
  }

  return Object.entries(scripts)
    .filter(
      ([name, command]) =>
        name !== 'menu' && typeof command === 'string' && command.trim() !== ''
    )
    .map(([name]) => {
      const category = categoryFor(name);
      const definition = Object.hasOwn(commandDefinitions, name)
        ? commandDefinitions[name]
        : undefined;
      const command = {
        name,
        label: definition?.label ?? name,
        category,
        confirmation: definition?.confirmation !== false
      };

      if (definition?.note !== undefined) {
        command.note = definition.note;
      } else if (name.startsWith('docker:up:dev')) {
        command.note =
          'Démarre les services locaux; l’écoute Stripe garde le terminal occupé.';
      } else if (category === 'advanced') {
        command.note =
          'Vérifier la cible, la portée et les préconditions; une opération réelle exige une instruction explicite.';
      } else if (!definition) {
        command.note =
          'Commande ajoutée au dépôt. Vérifier sa définition et ses effets avant de l’exécuter.';
      }

      if (definition?.continuous) {
        command.continuous = true;
      }

      return command;
    });
}
