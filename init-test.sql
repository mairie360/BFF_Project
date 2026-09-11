-- Seed minimal pour les tests isolés (performance / sécurité) du BFF Project.
-- L'utilisateur 2 est celui référencé par les JWT de test (claim sub = "2") :
--   * load-test.js le signe dynamiquement,
--   * docker-compose-security.yml injecte un token statique via le replacer ZAP.
-- Aucun rôle ni groupe n'est nécessaire : BFF User retombe alors sur le rôle
-- "Guest", ce qui suffit à exercer /health, /check_apis et /projects-page
-- (liste vide, 200) sans droits de gestion.

INSERT INTO users (id, first_name, last_name, email, password, status)
VALUES (2, 'Perf', 'Tester', 'perf-tester@mairie360.fr', 'dummy', 'active')
ON CONFLICT (id) DO NOTHING;
