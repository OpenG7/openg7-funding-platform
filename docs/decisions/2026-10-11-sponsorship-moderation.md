# Décision : revue éditoriale versionnée des commandites

Date : 11 octobre 2026. Portée : construction locale de la politique de modération
V1, sans activation de charte contractuelle, opération de production ou retrait
social réel. La [source](../OpenG7_Politique_Moderation_Commandites_V1.docx) et
l'[analyse](../development/sponsorship-moderation-implementation-analysis.md)
distinguent ces autorisations.

La décision éditoriale possède un sujet typé, une révision du contenu et une
empreinte, une version de politique, un acteur serveur, un niveau, des motifs et
deux explications distinctes. Les règles pures et les contrats sont dans la
façade publique de `funding-core`; les snapshots, transactions et projections
appartiennent à `funding-api`. La révision éditoriale reste indépendante du
verrou de commande, des faits financiers et du claim worker. Un retour à un
texte antérieur ne restaure pas une ancienne revue.

Les décisions et preuves sont ajoutées à l'historique. Les cas en représentent
l'état courant. La décision, les restrictions, l'audit et la réservation de
notification sont transactionnels. Les commandes legacy, groupées et de
pilotage réutilisent ces contrats et gardes; les requêtes anciennes sans décision
ne peuvent pas autoriser un nouvel envoi. Le worker revalide immédiatement
avant chaque appel fournisseur, sans verrou de dossier pendant l'appel réseau.
Une restriction confirmée après soumission ne rappelle pas la requête : sa
réponse reste conservée et le besoin de retrait est suivi séparément.

N4 et les N5 graves attendent une personne indépendante, avec identité OIDC
stable et distincte. Une session token partagée ne satisfait pas cette condition.
L'auteur d'une décision grave ne peut pas la contourner en réapprouvant lui-même
le contenu. Un recours ouvert garde les autorisations fermées jusqu'à une
nouvelle décision autorisée et liée à sa résolution. Ni refus ni recours ne
créent un remboursement ou un fait de livraison.

Les projections commanditaires et les notifications utilisent une liste blanche
de champs externes. Elles ne portent ni note interne ni identité de relecteur.
Les lectures admin de preuves exigent les droits opérateur/propriétaire côté API;
les aperçus d'adoption et de conservation sont réservés au propriétaire.

L'adoption ne fabrique aucune acceptation ou décision historique. Les contenus
déjà publics conservent une observation distincte de leur état et empreinte,
sans autorisation de nouvel envoi. Un changement éditorial, une restriction ou
un retrait de consentement termine cette exception. Une ancienne approbation
technique en attente ne satisfait jamais la garde de modération du worker.

La charte FR/EN préparée reste inactive. Sa publication contractuelle exige la
validation et la date d'effet prévues par la V1. Les nouveaux Checkout concernés
conserveront alors l'acceptation exacte dans leur opération durable; le rejeu
préserve les conditions initiales. Aucun délai public, durée de conservation ou
fournisseur OCR/IA n'est supposé validé.

L'assistance textuelle locale fournit seulement quelques indices contextualisés
et peut s'abstenir. Elle ne décide pas et ne prouve pas une couverture sémantique
exhaustive. L'OCR, les téléchargements externes et la suppression sociale restent
indisponibles sans adaptateurs qualifiés. La purge reste indisponible sans règles
de conservation validées. Les observations de retrait distinguent la visibilité
locale de la copie détenue par Facebook ou LinkedIn.

Le [runbook propriétaire](../operations/sponsorship-moderation.md) décrit les
routes, droits, projections, migrations et limites. La recette utilise des bases
PostgreSQL jetables, des ports synthétiques et des parcours FR/EN; elle ne prouve
pas une activation de production ou une opération réelle chez un fournisseur.
