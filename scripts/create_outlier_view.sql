-- ============================================================================
-- Create View for Outlier Participants
-- These are participants who only logged during the first month (< 2000 records)
-- and should be optionally excluded from temporal analyses
-- ============================================================================

-- Usage:
-- docker compose exec -T db psql -U myuser -d hpdavDB < scripts/create_outlier_view.sql

\echo 'Creating view for outlier participants...'

-- Drop the view if it already exists
DROP VIEW IF EXISTS outlier_participants;

-- Create a view that identifies participants with less than 2000 status logs
-- These are considered outliers as they only logged during the first month
CREATE VIEW outlier_participants AS
SELECT 
    participantid, 
    count(*) as log_count
FROM participantstatuslogs
GROUP BY participantid
HAVING count(*) < 2000;

\echo 'Outlier participants view created successfully!'

-- Also create a view for valid (non-outlier) participants
DROP VIEW IF EXISTS valid_participants;

CREATE VIEW valid_participants AS
SELECT 
    participantid, 
    count(*) as log_count
FROM participantstatuslogs
GROUP BY participantid
HAVING count(*) >= 2000;

\echo 'Valid participants view created successfully!'

-- Show summary statistics
\echo ''
\echo 'Summary Statistics:'
SELECT 
    (SELECT count(*) FROM outlier_participants) as outlier_count,
    (SELECT count(*) FROM valid_participants) as valid_count,
    (SELECT count(DISTINCT participantid) FROM participantstatuslogs) as total_participants;
