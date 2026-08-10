-- Foundation: capacity-first, honest tiering, and multi-factor decisions.
-- target_rate: the firm's target realized rate ($/hr). When set, tiers are
--   graded against it (absolute), not just the book's own percentiles.
-- risk_level / relationship_level: 1 (low) .. 3 (high). Risk is how much a
--   client costs beyond the fee (late pay, messy books, scope creep). Relationship
--   is how valuable they are beyond the fee (referrals, tenure, growth).
ALTER TABLE firm ADD COLUMN target_rate REAL;
ALTER TABLE client ADD COLUMN risk_level INTEGER;
ALTER TABLE client ADD COLUMN relationship_level INTEGER;
