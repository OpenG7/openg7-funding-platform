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

const labels = {
  dev: 'Démarrer le Web et l’API',
  'dev:web': 'Démarrer le Web',
  'dev:api': 'Démarrer l’API',
  'docker:up': 'Démarrer Docker — choisir l’environnement',
  'docker:up:dev': 'Démarrer Docker local',
  'docker:up:dev:token': 'Démarrer Docker local avec un jeton admin',
  'docker:up:dev:keycloak': 'Démarrer Docker local avec Keycloak',
  'docker:up:prod':
    'Démarrer Docker en production — choisir l’authentification',
  'docker:up:prod:keycloak': 'Démarrer Docker en production avec Keycloak',
  'docker:up:prod:oidc': 'Démarrer Docker en production avec OIDC externe',
  'docker:playwright': 'Démarrer la pile Docker des tests Playwright',
  'docker:recreate': 'Recréer les conteneurs Web et API',
  'docker:update': 'Mettre à jour Docker — choisir les options',
  'docker:update:dev': 'Mettre à jour Docker local et écouter Stripe',
  'docker:down': 'Arrêter et retirer les conteneurs Docker',
  'db:up': 'Démarrer PostgreSQL dans Docker',
  'db:stop': 'Arrêter PostgreSQL',
  'db:logs': 'Suivre les journaux PostgreSQL',
  'db:psql': 'Ouvrir une console SQL',
  'db:migrate': 'Appliquer les migrations de la base',
  'db:backup': 'Sauvegarder la base de données',
  'db:restore': 'Restaurer la base depuis une sauvegarde',
  'prod:check': 'Vérifier la pile de production',
  'prod:deploy': 'Déployer en production',
  'prod:backup': 'Sauvegarder la production',
  'prod:rollback': 'Revenir à une version précédente en production',
  'services:check': 'Vérifier la configuration et les outils locaux',
  'keycloak:check': 'Vérifier la configuration Keycloak locale',
  'smoke:public': 'Vérifier les endpoints publics de la cible configurée',
  'storage:check': 'Vérifier le stockage OVH',
  'storage:test': 'Tester le stockage OVH',
  'storage:provision': 'Provisionner le stockage OVH',
  'storage:publish': 'Publier des médias de commanditaires',
  'storage:unpublish': 'Retirer la publication de médias',
  'vps:ssh': 'Ouvrir une session SSH sur le VPS',
  'vps:env': 'Configurer l’environnement du VPS',
  'vps:node:install': 'Installer Node.js sur le VPS',
  'vps:update': 'Mettre à jour le VPS',
  'vps:deploy': 'Déployer sur le VPS',
  'vps:rollback': 'Revenir à une version précédente sur le VPS',
  'vps:check': 'Vérifier les services du VPS',
  'vps:logs': 'Consulter les journaux du VPS',
  'vps:ps': 'Afficher les conteneurs du VPS',
  'vps:backup': 'Sauvegarder le VPS',
  'vps:backup:list': 'Lister les sauvegardes du VPS',
  'vps:backup:download': 'Télécharger une sauvegarde du VPS',
  'vps:db:update': 'Mettre à jour la base sur le VPS',
  'vps:db:psql': 'Ouvrir une console SQL sur le VPS',
  'vps:db:backup': 'Sauvegarder la base du VPS',
  'vps:db:backup:list': 'Lister les sauvegardes de la base du VPS',
  'vps:db:backup:download': 'Télécharger une sauvegarde de la base du VPS',
  'stripe:cli:install': 'Installer Stripe CLI globalement',
  'stripe:webhook:listen': 'Écouter les webhooks Stripe en mode test',
  'stripe:events:resend': 'Renvoyer des événements Stripe en mode test',
  'stripe:events:resend:live': 'Renvoyer des événements Stripe live',
  'stripe:backfill': 'Récupérer l’historique Stripe en mode test',
  'stripe:backfill:live': 'Récupérer l’historique Stripe live',
  'email:dns': 'Vérifier les enregistrements DNS des courriels',
  'email:verify': 'Vérifier la connexion SMTP',
  'email:test': 'Envoyer un courriel de test réel',
  'tls:local:setup': 'Installer les certificats HTTPS locaux',
  'tls:local:renew': 'Renouveler les certificats HTTPS locaux',
  'playwright:install': 'Installer le navigateur Chromium pour Playwright',
  lint: 'Vérifier le code avec ESLint',
  format: 'Reformater les fichiers du dépôt',
  'format:check': 'Vérifier le format des fichiers',
  test: 'Compiler et lancer les tests Node',
  'test:integration': 'Compiler et lancer les tests d’intégration',
  'test:sponsorship': 'Vérifier les scénarios de commandite',
  'test:e2e:seed': 'Créer les données de test dans la base',
  'test:e2e:seed:cleanup': 'Supprimer les données de test de la base',
  'test:e2e:playwright':
    'Démarrer Docker, migrer, préparer et tester avec Playwright',
  'test:e2e:acceptance': 'Lancer la recette admin dans une pile Docker jetable',
  'test:e2e:identity': 'Tester l’identité dans une pile Docker jetable',
  'test:ui:admin': 'Tester l’interface admin',
  'test:ui:followup': 'Tester les parcours de suivi',
  'test:ui:funding-home': 'Tester la page d’accueil',
  'test:ui:funding-about': 'Tester la page À propos',
  'test:ui:funding-transparency': 'Tester les pages de transparence',
  'test:ui:sponsors': 'Tester les pages de commanditaires',
  'test:ui:public-journeys': 'Tester les parcours publics',
  'test:ui:platform-accessibility': 'Tester l’accessibilité de la plateforme',
  'test:rehearsal': 'Tester les fournisseurs dans un environnement jetable',
  'test:automation': 'Tester les automatisations et les parcours publics',
  build: 'Compiler les packages et l’API TypeScript',
  docs: 'Générer la documentation TypeDoc',
  'docs:check': 'Vérifier les standards et la documentation',
  'docs:report': 'Afficher le rapport des contrôles documentaires',
  'images:funding-home': 'Optimiser les images de la page d’accueil',
  'images:sponsors': 'Optimiser les images des commanditaires',
  'images:support': 'Optimiser les images des contributions',
  'providers:verify': 'Vérifier l’accès aux fournisseurs configurés',
  'operations:watch': 'Démarrer la surveillance et l’envoi des alertes',
  opencode: 'Ouvrir OpenCode avec l’environnement du dépôt'
};

// Only these known local commands can run without an additional confirmation.
// New scripts remain available, but always require confirmation.
const localCommands = new Set([
  'dev',
  'dev:web',
  'dev:api',
  'services:check',
  'keycloak:check',
  'lint',
  'format:check',
  'test',
  'test:integration',
  'test:sponsorship',
  'test:ui:admin',
  'test:ui:followup',
  'test:ui:funding-home',
  'test:ui:funding-about',
  'test:ui:funding-transparency',
  'test:ui:sponsors',
  'test:ui:public-journeys',
  'test:ui:platform-accessibility',
  'build',
  'docs',
  'docs:check',
  'docs:report',
  'images:funding-home',
  'images:sponsors',
  'images:support'
]);

const continuousCommands = new Set([
  'dev',
  'dev:web',
  'dev:api',
  'docker:up:dev',
  'docker:up:dev:token',
  'docker:up:dev:keycloak',
  'docker:update:dev',
  'db:logs',
  'stripe:webhook:listen',
  'operations:watch',
  'opencode',
  'vps:ssh',
  'vps:db:psql',
  'db:psql'
]);

const notes = {
  'docker:up':
    'Le questionnaire peut cibler la production. En mode local, l’écoute Stripe garde le terminal occupé.',
  'docker:down':
    'Retire les conteneurs et les réseaux Compose. Sans -v/--volumes, les volumes sont conservés.',
  'docker:update':
    'Vérifier l’environnement choisi et les options de suppression d’images avant la mise à jour.',
  'docker:update:dev':
    'Met à jour les services locaux, supprime les images inutilisées et démarre l’écoute Stripe.',
  'db:psql': 'La console SQL permet de modifier la base configurée.',
  'db:migrate': 'Applique des changements de schéma à la base configurée.',
  'db:backup':
    'Vérifier la base cible et l’emplacement privé de la sauvegarde.',
  'db:restore':
    'Vérifier la cible et la sauvegarde; la restauration remplace des données.',
  'stripe:cli:install': 'Installe un outil global via npm.',
  'stripe:webhook:listen':
    'Transmet les événements Stripe de test à l’API configurée et garde le terminal occupé.',
  'stripe:events:resend':
    'Exige des identifiants d’événements. Vérifier compte, endpoint, volume et mode; commencer par --dry-run.',
  'stripe:backfill':
    'Peut modifier la base configurée. Vérifier compte, dates et volume; commencer par --dry-run.',
  'email:test': 'Envoie réellement un message au destinataire configuré.',
  'tls:local:setup':
    'Modifie les certificats locaux; peut installer une autorité de certification de confiance.',
  'tls:local:renew':
    'Remplace les certificats locaux; vérifier les domaines et l’autorité de certification.',
  format: 'Réécrit les fichiers du dépôt; vérifier les modifications en cours.',
  'test:e2e:seed': 'Insère des données de test dans la base configurée.',
  'test:e2e:seed:cleanup':
    'Supprime les données de test et réinitialise le simulateur Stripe configuré.',
  'test:e2e:playwright':
    'Démarre ou réutilise Docker local, applique les migrations et modifie les données de test.',
  'test:e2e:acceptance': 'Crée puis retire une pile Docker jetable de recette.',
  'test:e2e:identity':
    'Crée une pile locale jetable pour les tests d’identité.',
  'test:rehearsal': 'Utilise des fournisseurs et une base jetables de test.',
  'providers:verify': 'Contacte les fournisseurs de l’environnement configuré.',
  'operations:watch':
    'Lit la base configurée et envoie des alertes au webhook de supervision.',
  opencode: 'Donne à un outil externe accès à l’environnement du dépôt.'
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
      const command = {
        name,
        label: Object.hasOwn(labels, name) ? labels[name] : name,
        category,
        confirmation: !localCommands.has(name)
      };

      if (Object.hasOwn(notes, name)) {
        command.note = notes[name];
      } else if (name.startsWith('docker:up:dev')) {
        command.note =
          'Démarre les services locaux; l’écoute Stripe garde le terminal occupé.';
      } else if (category === 'advanced') {
        command.note =
          'Vérifier la cible, la portée et les préconditions; une opération réelle exige une instruction explicite.';
      } else if (!Object.hasOwn(labels, name)) {
        command.note =
          'Commande ajoutée au dépôt. Vérifier sa définition et ses effets avant de l’exécuter.';
      }

      if (continuousCommands.has(name)) {
        command.continuous = true;
      }

      return command;
    });
}
