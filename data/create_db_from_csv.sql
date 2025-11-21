--------------------------------------------------------
-- 1. CLEAN UP / RESET
--------------------------------------------------------
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS ParticipantStatusLogs CASCADE;
DROP TABLE IF EXISTS TravelJournal CASCADE;
DROP TABLE IF EXISTS SocialNetwork CASCADE;
DROP TABLE IF EXISTS FinancialJournal CASCADE;
DROP TABLE IF EXISTS CheckinJournal CASCADE;
DROP TABLE IF EXISTS JobSchedules CASCADE;
DROP TABLE IF EXISTS Schools CASCADE;
DROP TABLE IF EXISTS Restaurants CASCADE;
DROP TABLE IF EXISTS Pubs CASCADE;
DROP TABLE IF EXISTS Participants CASCADE;
DROP TABLE IF EXISTS Jobs CASCADE;
DROP TABLE IF EXISTS Employers CASCADE;
DROP TABLE IF EXISTS Apartments CASCADE;
DROP TABLE IF EXISTS Buildings CASCADE;

-- Drop Enums
DROP TYPE IF EXISTS education_level_enum CASCADE;
DROP TYPE IF EXISTS building_type_enum CASCADE;
DROP TYPE IF EXISTS job_mode_enum CASCADE;
DROP TYPE IF EXISTS venue_type_enum CASCADE;
DROP TYPE IF EXISTS payment_category_enum CASCADE;
DROP TYPE IF EXISTS travel_purpose_enum CASCADE;

--------------------------------------------------------
-- 2. DEFINE ENUMS & SCHEMA
--------------------------------------------------------

-- Education Levels
CREATE TYPE education_level_enum AS ENUM (
    'Low', 'HighSchoolOrCollege', 'Bachelors', 'Graduate'
);

--  Building types (Includes 'Residental' typo per docs)
CREATE TYPE building_type_enum AS ENUM (
    'Commercial', 'Residential', 'Residental', 'School'
);

-- Current Mode
CREATE TYPE job_mode_enum AS ENUM (
    'AtHome', 'Transport', 'AtRecreation', 'AtRestaurant', 'AtWork'
);

-- Venue Types
CREATE TYPE venue_type_enum AS ENUM (
    'Apartment', 'Pub', 'Restaurant', 'Workplace', 'School'
);

-- Payment Categories
CREATE TYPE payment_category_enum AS ENUM (
    'Education', 'Food', 'Recreation', 'RentAdjustment', 'Shelter', 'Wage'
);

-- Travel Purpose
CREATE TYPE travel_purpose_enum AS ENUM (
    'Coming Back From Restaurant', 'Eating', 'Going Back to Home', 
    'Recreation (Social Gathering)', 'Work/Home Commute'
);

--------------------------------------------------------
-- 3. CREATE TABLES
--------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '--- [INFO] CREATION OF TABLES ---'; END $$;

-- BUILDINGS
CREATE TABLE Buildings (
    buildingId INTEGER PRIMARY KEY, 
    location TEXT, 
    buildingType building_type_enum,
    maxOccupancy INTEGER,
    -- Temporary column: We load the CSV list here, then drop it later to satisfy 1NF
    units_raw TEXT 
);

-- APARTMENTS
CREATE TABLE Apartments (
    apartmentId INTEGER PRIMARY KEY,
    rentalCost DOUBLE PRECISION,
    maxOccupancy INTEGER,
    numberOfRooms INTEGER,
    location TEXT,
    buildingId INTEGER,
    CONSTRAINT fk_apt_building FOREIGN KEY (buildingId) REFERENCES Buildings(buildingId)
);

-- EMPLOYERS
CREATE TABLE Employers (
    employerId INTEGER PRIMARY KEY,
    location TEXT,
    buildingId INTEGER,
    CONSTRAINT fk_emp_building FOREIGN KEY (buildingId) REFERENCES Buildings(buildingId)
);

-- JOBS
CREATE TABLE Jobs (
    jobId INTEGER PRIMARY KEY,
    employerId INTEGER,
    hourlyRate DOUBLE PRECISION,
    startTime TIME, 
    endTime TIME,   
    -- Temporary column: We load the CSV list "Mon,Tue" here, then split it into JobSchedules
    daysToWork_raw TEXT,
    educationRequirement education_level_enum,
    CONSTRAINT fk_job_employer FOREIGN KEY (employerId) REFERENCES Employers(employerId)
);

-- NEW NORMALIZED TABLE FOR JOB SCHEDULES
CREATE TABLE JobSchedules (
    jobId INTEGER,
    dayOfWeek TEXT, -- Will hold 'Monday', 'Tuesday', etc.
    CONSTRAINT fk_js_job FOREIGN KEY (jobId) REFERENCES Jobs(jobId)
);

-- PARTICIPANTS
CREATE TABLE Participants (
    participantId INTEGER PRIMARY KEY,
    householdSize INTEGER,
    haveKids BOOLEAN, 
    age INTEGER,
    educationLevel education_level_enum,
    interestGroup TEXT,
    joviality DOUBLE PRECISION CHECK(joviality >= 0 AND joviality <= 1)
);

-- PUBS
CREATE TABLE Pubs (
    pubId INTEGER PRIMARY KEY,
    hourlyCost DOUBLE PRECISION,
    maxOccupancy INTEGER,
    location TEXT,
    buildingId INTEGER,
    CONSTRAINT fk_pub_building FOREIGN KEY (buildingId) REFERENCES Buildings(buildingId)
);

-- RESTAURANTS
CREATE TABLE Restaurants (
    restaurantId INTEGER PRIMARY KEY,
    foodCost DOUBLE PRECISION,
    maxOccupancy INTEGER,
    location TEXT,
    buildingId INTEGER,
    CONSTRAINT fk_res_building FOREIGN KEY (buildingId) REFERENCES Buildings(buildingId)
);

-- SCHOOLS
CREATE TABLE Schools (
    schoolId INTEGER PRIMARY KEY,
    monthlyFees DOUBLE PRECISION,
    maxEnrollment INTEGER,
    location TEXT,
    buildingId INTEGER,
    CONSTRAINT fk_sch_building FOREIGN KEY (buildingId) REFERENCES Buildings(buildingId)
);

-- CHECKIN JOURNAL
CREATE TABLE CheckinJournal (
    participantId INTEGER,
    timestamp TIMESTAMP,
    venueId INTEGER, -- Polymorphic ID (can be Pub, Restaurant, etc)
    venueType venue_type_enum,
    PRIMARY KEY (participantId, timestamp),
    CONSTRAINT fk_chk_participant FOREIGN KEY (participantId) REFERENCES Participants(participantId)
);

-- FINANCIAL JOURNAL
CREATE TABLE FinancialJournal (
    financialId BIGSERIAL PRIMARY KEY, 
    participantId INTEGER,
    timestamp TIMESTAMP,
    category payment_category_enum,
    amount DOUBLE PRECISION,
    CONSTRAINT fk_fin_participant FOREIGN KEY (participantId) REFERENCES Participants(participantId)
);

-- SOCIAL NETWORK
CREATE TABLE SocialNetwork (
    timestamp TIMESTAMP,
    participantIdFrom INTEGER,
    participantIdTo INTEGER,
    PRIMARY KEY (timestamp, participantIdFrom, participantIdTo),
    CONSTRAINT fk_soc_from FOREIGN KEY (participantIdFrom) REFERENCES Participants(participantId),
    CONSTRAINT fk_soc_to FOREIGN KEY (participantIdTo) REFERENCES Participants(participantId)
);

-- TRAVEL JOURNAL
CREATE TABLE TravelJournal (
    travelId BIGSERIAL PRIMARY KEY, 
    participantId INTEGER,
    travelStartTime TIMESTAMP,
    travelStartLocationId INTEGER,
    travelEndTime TIMESTAMP,
    travelEndLocationId INTEGER,
    purpose travel_purpose_enum,
    checkInTime TIMESTAMP,
    checkOutTime TIMESTAMP,
    startingBalance DOUBLE PRECISION,
    endingBalance DOUBLE PRECISION,
    CONSTRAINT fk_trv_participant FOREIGN KEY (participantId) REFERENCES Participants(participantId)
);

-- PARTICIPANT STATUS LOGS
CREATE TABLE ParticipantStatusLogs (
    logId BIGSERIAL PRIMARY KEY, 
    timestamp TIMESTAMP,         
    currentLocation TEXT,
    participantId INTEGER,
    currentMode job_mode_enum,
    hungerStatus TEXT,
    sleepStatus TEXT,
    apartmentId INTEGER,
    availableBalance DOUBLE PRECISION,
    jobId INTEGER,
    financialStatus TEXT,
    dailyFoodBudget DOUBLE PRECISION,
    weeklyExtraBudget DOUBLE PRECISION,
    CONSTRAINT fk_log_participant FOREIGN KEY (participantId) REFERENCES Participants(participantId),
    CONSTRAINT fk_log_apartment FOREIGN KEY (apartmentId) REFERENCES Apartments(apartmentId),
    CONSTRAINT fk_log_job FOREIGN KEY (jobId) REFERENCES Jobs(jobId)
);

--------------------------------------------------------
-- 4. BULK DATA LOADING (COPY)
--------------------------------------------------------

-- Load Buildings (Into raw column first)
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING BUILDINGS.CSV ---'; END $$;
COPY Buildings(buildingId, location, buildingType, maxOccupancy, units_raw)
FROM '/Datasets/Attributes/Buildings.csv' WITH (FORMAT csv, HEADER true);

-- Load Apartments
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING APARTMENTS.CSV ---'; END $$;
COPY Apartments(apartmentId, rentalCost, maxOccupancy, numberOfRooms, location, buildingId)
FROM '/Datasets/Attributes/Apartments.csv' WITH (FORMAT csv, HEADER true);

-- Load Employers
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING EMPLOYERS.CSV ---'; END $$;
COPY Employers(employerId, location, buildingId)
FROM '/Datasets/Attributes/Employers.csv' WITH (FORMAT csv, HEADER true);

-- Load Schools
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING SCHOOLS.CSV ---'; END $$;
COPY Schools(schoolId, monthlyFees, maxEnrollment, location, buildingId)
FROM '/Datasets/Attributes/Schools.csv' WITH (FORMAT csv, HEADER true);

-- Load Pubs
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING PUBS.CSV ---'; END $$;
COPY Pubs(pubId, hourlyCost, maxOccupancy, location, buildingId)
FROM '/Datasets/Attributes/Pubs.csv' WITH (FORMAT csv, HEADER true);

-- Load Restaurants
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING RESTAURANTS.CSV ---'; END $$;
COPY Restaurants(restaurantId, foodCost, maxOccupancy, location, buildingId)
FROM '/Datasets/Attributes/Restaurants.csv' WITH (FORMAT csv, HEADER true);

-- Load Jobs (Into raw daysToWork first)
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING JOBS.CSV ---'; END $$;
COPY Jobs(jobId, employerId, hourlyRate, startTime, endTime, daysToWork_raw, educationRequirement)
FROM '/Datasets/Attributes/Jobs.csv' WITH (FORMAT csv, HEADER true);

-- Load Participants
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING PARTICIPANTS.CSV ---'; END $$;
COPY Participants(participantId, householdSize, haveKids, age, educationLevel, interestGroup, joviality)
FROM '/Datasets/Attributes/Participants.csv' WITH (FORMAT csv, HEADER true);

-- Load CheckinJournal
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING CHECKINJOURNAL.CSV ---'; END $$;
COPY CheckinJournal(participantId, timestamp, venueId, venueType)
FROM '/Datasets/Journals/CheckinJournal.csv' WITH (FORMAT csv, HEADER true);

-- Load FinancialJournal
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING FINANCIALJOURNAL.CSV ---'; END $$;
COPY FinancialJournal(participantId, timestamp, category, amount)
FROM '/Datasets/Journals/FinancialJournal.csv' WITH (FORMAT csv, HEADER true);

-- Load SocialNetwork
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING SOCIALNETWORK.CSV ---'; END $$;
COPY SocialNetwork(timestamp, participantIdFrom, participantIdTo)
FROM '/Datasets/Journals/SocialNetwork.csv' WITH (FORMAT csv, HEADER true);

-- Load TravelJournal
DO $$ BEGIN RAISE NOTICE '--- [INFO] LOADING TRAVELJOURNAL.CSV ---'; END $$;
COPY TravelJournal(participantId, travelStartTime, travelStartLocationId, travelEndTime, travelEndLocationId, purpose, checkInTime, checkOutTime, startingBalance, endingBalance)
FROM '/Datasets/Journals/TravelJournal.csv' WITH (FORMAT csv, HEADER true, NULL 'NA');

--------------------------------------------------------
-- 5. LOAD LOOP: ParticipantStatusLogs (72 Files)
--------------------------------------------------------
DO $$
DECLARE
    i INT;
    file_path TEXT;
BEGIN
    -- "split across 72 files"
    FOR i IN 1..72 LOOP 
        -- Note: File numbering usually starts at 0 or 1. Adjusted loop to cover range.
        -- If files are named ParticipantStatusLogs1.csv, change range to 1..72
        file_path := '/Datasets/ActivityLogs/ParticipantStatusLogs' || i || '.csv';
        
        BEGIN
            RAISE NOTICE '--- [INFO] LOADING % ---', file_path;
            EXECUTE format('
                COPY ParticipantStatusLogs(timestamp, currentLocation, participantId, currentMode, hungerStatus, sleepStatus, apartmentId, availableBalance, jobId, financialStatus, dailyFoodBudget, weeklyExtraBudget) FROM %L WITH (FORMAT csv, HEADER true, NULL ''NA'')', file_path);
        EXCEPTION
            WHEN OTHERS THEN
                -- Silently continue if a specific file number doesn't exist
                RAISE NOTICE 'File % not found or empty, skipping.', file_path;
        END;
    END LOOP;
END $$;

--------------------------------------------------------
-- 6. POST-LOAD NORMALIZATION
--------------------------------------------------------

-- Convert Jobs.daysToWork_raw (e.g. "Mon,Tue") into JobSchedules table
-- Not-normalized column is kept just in case
INSERT INTO JobSchedules (jobId, dayOfWeek)
SELECT 
    jobId, 
    TRIM(unnest(string_to_array(replace(replace(daysToWork_raw, '[', ''), ']', ''), ',')))
FROM Jobs;

ALTER TABLE ParticipantStatusLogs
ALTER COLUMN currentLocation TYPE POINT
USING (
    CASE 
        -- Check if the string is empty after removing 'POINT', parens, and spaces
        WHEN length(trim(both 'POINT() ' from currentLocation)) = 0 THEN NULL 
        ELSE 
            ('(' || regexp_replace(trim(both 'POINT() ' from currentLocation), '\s+', ',') || ')')::point 
    END
);

ALTER TABLE Apartments 
ALTER COLUMN location TYPE POINT 
USING (
    CASE 
        WHEN length(trim(both 'POINT() ' from location)) = 0 THEN NULL 
        ELSE 
            ('(' || regexp_replace(trim(both 'POINT() ' from location), '\s+', ',') || ')')::point 
    END
);

ALTER TABLE Buildings
ALTER COLUMN location TYPE POLYGON 
USING (
    CASE 
        WHEN location IS NULL OR length(trim(location)) = 0 OR location = 'NA' THEN NULL
        ELSE
            (
                '((' || 
                regexp_replace(
                    regexp_replace(
                        -- 1. TRIM the string AFTER removing "POLYGON" and parens
                        -- This prevents the leading space from becoming a leading comma
                        trim(regexp_replace(location, '[a-zA-Z()]+', '', 'g')), 
                        
                        -- 2. Turn point separators (", ") into tuple separators ("),(")
                        ',\s*', '),(', 'g' 
                    ),
                    
                    -- 3. Turn coordinate separators (" ") into commas (",")
                    '\s+', ',', 'g'
                ) 
                || '))'
            )::polygon
    END
);

ALTER TABLE Employers 
ALTER COLUMN location TYPE POINT 
USING (
    CASE 
        WHEN length(trim(both 'POINT() ' from location)) = 0 THEN NULL 
        ELSE 
            ('(' || regexp_replace(trim(both 'POINT() ' from location), '\s+', ',') || ')')::point 
    END
);

ALTER TABLE Pubs 
ALTER COLUMN location TYPE POINT 
USING (
    CASE 
        WHEN length(trim(both 'POINT() ' from location)) = 0 THEN NULL 
        ELSE 
             ('(' || regexp_replace(trim(both 'POINT() ' from location), '\s+', ',') || ')')::point 
    END
);

ALTER TABLE Restaurants 
ALTER COLUMN location TYPE POINT 
USING (
    CASE 
        WHEN length(trim(both 'POINT() ' from location)) = 0 THEN NULL 
        ELSE 
             ('(' || regexp_replace(trim(both 'POINT() ' from location), '\s+', ',') || ')')::point 
    END
);

ALTER TABLE Schools
ALTER COLUMN location TYPE POINT
USING (
    CASE 
        WHEN length(trim(both 'POINT() ' from location)) = 0 THEN NULL 
        ELSE 
            ('(' || regexp_replace(trim(both 'POINT() ' from location), '\s+', ',') || ')')::point 
    END
);
