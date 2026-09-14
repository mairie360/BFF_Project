-- Seed minimal pour les tests isolés (performance / sécurité) du BFF Project.
-- L'utilisateur 2 est celui référencé par les JWT de test (claim sub = "2") :
--   * load-test.js le signe dynamiquement,
--   * docker-compose-security.yml injecte un token statique via le replacer ZAP.
-- Le seul rôle "User" et aucun groupe suffisent pour exercer /health, /check_apis
-- et /projects-page (liste vide, 200) sans droits de gestion.

INSERT INTO users (id, first_name, last_name, email, password, status)
VALUES (2, 'Perf', 'Tester', 'perf-tester@mairie360.fr', 'dummy', 'active')
ON CONFLICT (id) DO NOTHING;

-- Core API >= 1.1.1 exige au moins un rôle sur l'utilisateur pour GET /user/me
-- (sinon panic "index out of bounds" côté Core -> 502 côté BFF User puis BFF Project).
-- Le rôle "User" ne donne pas l'accès admin.
INSERT INTO user_roles (user_id, role_id)
SELECT 2, r.id FROM roles r WHERE lower(r.name) = 'user'
ON CONFLICT DO NOTHING;
