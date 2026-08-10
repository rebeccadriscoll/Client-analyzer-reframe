-- Benchmark network: firms opt in to contribute anonymized fees. Only aggregate
-- percentiles (never individual clients) are ever surfaced, and only once enough
-- firms and data points exist for a service.
ALTER TABLE firm ADD COLUMN contribute_benchmarks INTEGER;
