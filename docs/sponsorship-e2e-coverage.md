# Couverture E2E commandite et feeds

Cette matrice couvre le parcours commandite de bout en bout au niveau des
routes, contrats API, etats UI, filtres publics, controles de securite, i18n
et documentation de deploiement.

Couverture cible: 8 scenarios sur 8, soit 100%.

| Scenario                                                                 | Couvert | Surface                                                                            |
| ------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| Entreprise choisit une commandite, paie et revient avec token            | Oui     | Fonds, Checkout, API Stripe sans token brut en metadata ni formulaire `session_id` |
| Entreprise rouvre le suivi par token et soumet ses details               | Oui     | Suivi commandite, API token, retrait du token de l'URL, resoumission idempotente   |
| Token absent, invalide, expire ou introuvable affiche un etat d'erreur   | Oui     | Suivi commandite, validations API                                                  |
| Admin liste les commandites payees avec jeton admin                      | Oui     | Admin, API privee                                                                  |
| Admin approuve, remet en attente, refuse ou rembourse la commandite      | Oui     | Admin, revue DB, remboursement Stripe guide, avoir, PDF et courriel optionnel      |
| Admin prepare la publication OpenG7/OpenG20 Facebook/LinkedIn            | Oui     | Admin, migration feed                                                              |
| Page publique affiche seulement les commandites approuvees et consenties | Oui     | `/commanditaires`, API publique                                                    |
| Navigation FR/EN, prerender, sitemap et docs de prod restent alignes     | Oui     | Routes, i18n, deployment                                                           |

Limite volontaire: ces tests ne publient pas sur Facebook ou LinkedIn. Le MVP
trace le placement de feed et le lien public, mais l'integration API sociale
reste hors perimetre tant que les permissions et credentials ne sont pas
branches.
