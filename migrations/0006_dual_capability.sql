-- `is_utility` used to REPLACE the operator capability (a utility_operator
-- could not also record maintenance logs). A person can now hold either job,
-- both, or be moved between them by an admin — so the two capabilities need
-- to be independent flags rather than one flag switching between them.
--
-- `is_operator` defaults to 1 so every existing plain operator is unaffected.
-- Existing utility_operator accounts (is_utility = 1) were utility-ONLY under
-- the old model, so they're backfilled to is_operator = 0 to preserve exactly
-- what they could do before this migration — an admin can now opt them into
-- both from the Users screen if that person's job has actually grown.
ALTER TABLE users ADD COLUMN is_operator INTEGER NOT NULL DEFAULT 1;

UPDATE users SET is_operator = 0 WHERE role = 'operator' AND is_utility = 1;
