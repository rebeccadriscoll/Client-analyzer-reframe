-- Cross-season trends: snapshot book health at each close so the trajectory is
-- visible over time. Past seasons stay null for these; new closes populate them.
ALTER TABLE season ADD COLUMN gross_revenue REAL;
ALTER TABLE season ADD COLUMN book_rate REAL;
ALTER TABLE season ADD COLUMN clients INTEGER;
