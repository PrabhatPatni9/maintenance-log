-- Shed-scoped operator access.
--
-- An operator only ever sees the sheds an admin has explicitly granted them
-- (CLAUDE.md's access model, tightened per the human product owner: "Shed A
-- or Shed B, whichever they're assigned, nothing else"). Admins are exempt
-- from this table entirely and always see every shed.

CREATE TABLE user_sheds (
  user_phone TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
  shed_id    TEXT NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
  PRIMARY KEY (user_phone, shed_id)
);

CREATE INDEX idx_user_sheds_shed ON user_sheds(shed_id);
