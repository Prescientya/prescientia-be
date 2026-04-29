-- Migration: Add first_login column to users table
-- This tracks whether a user needs to change their password on first login

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT TRUE;

-- For existing users, set first_login to FALSE (they already have passwords)
UPDATE users SET first_login = FALSE WHERE first_login IS DISTINCT FROM FALSE;
