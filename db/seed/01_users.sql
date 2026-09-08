-- db/seed/01_users.sql
--
-- GENERATED FILE. Do not edit by hand.
-- Source: scripts/seed.ts. Regenerate: npm run db:seed -- --regen-users
--
-- Three seeded users, bcrypt cost 10, all with the password Demo!2026.
-- These are demo fixtures: the password is published in the plan and printed on the
-- login screen. There is no sign-up and these are the only accounts that exist.
--
-- Landing routes, per the amended AC-1 (spec amendment 2026-09-07):
--   loan_officer              -> /cases?segment=personal
--   corporate_credit_officer  -> /cases?segment=corporate
--   risk_manager              -> /ai, with /portfolio one click away in the top nav

INSERT INTO users (id, email, password_hash, role, display_name) VALUES
  ('u-officer', 'officer@ocbc.demo', '$2b$10$IILA7xVwkRVzKY/BNwcl0.CgI.BQQCrQM9nz.Bp4pMt/aSCzvQYsi', 'loan_officer', 'Amirah Rahim'),
  ('u-corp', 'corp@ocbc.demo', '$2b$10$8TC8KlVcz76MpebST/yAO.9rUatXN0MTPP7bsyULRRyNm.troFPc6', 'corporate_credit_officer', 'Daniel Koh'),
  ('u-risk', 'risk@ocbc.demo', '$2b$10$yiIIdSw1T3rf41iAVyxVSOqIUHIunzVPxvD5F8qOnMFnoFwIFy57.', 'risk_manager', 'Priya Nair')
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name;
