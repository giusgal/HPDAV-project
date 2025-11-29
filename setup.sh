#!/bin/bash

# Check for wget
command -v wget >/dev/null 2>&1 || { echo >&2 "Error: 'wget' is not installed."; exit 1; }

# Check for unzip
command -v unzip >/dev/null 2>&1 || { echo >&2 "Error: 'unzip' is not installed."; exit 1; }

# Check for docker
command -v docker >/dev/null 2>&1 || { echo >&2 "Error: 'docker' is not installed."; exit 1; }

# Check for docker compose (v2)
docker compose version >/dev/null 2>&1 || { echo >&2 "Error: 'docker compose' is not installed or not running."; exit 1; }

cd ./data

echo "[INFO] Downloading part1 of DB"
wget -nv --show-progress "https://github.com/giusgal/HPDAV-project/releases/download/v1.0.0/create_db_part_1.part"

echo "[INFO] Downloading part2 of DB"
wget -nv --show-progress "https://github.com/giusgal/HPDAV-project/releases/download/v1.0.0/create_db_part_2.part"

echo "[INFO] Downloading part3 of DB"
wget -nv --show-progress "https://github.com/giusgal/HPDAV-project/releases/download/v1.0.0/create_db_part_3.part"

echo "[INFO] Downloading part4 of DB"
wget -nv --show-progress "https://github.com/giusgal/HPDAV-project/releases/download/v1.0.0/create_db_part_4.part"

echo "[INFO] Unsplitting DB"
cat ./create_db_part_* >> create_db.zip

echo "[INFO] Removing downloaded parts"
rm -rf ./create_db_part_*

echo "[INFO] unzipping create_db file"
unzip create_db.zip

echo "[INFO] removing zip file"
rm -rf create_db.zip

cd ..

echo "[INFO] running containers"
sudo docker compose up --build -d

echo "[INFO] waiting some seconds before"

echo "[INFO] creating DB (this might take several minutes) and removing create_db file"
sudo docker compose exec -T db psql -U myuser -d hpdavDB < ./data/create_db.sql && rm -rf ./data/create_db.sql

echo "[INFO] Creating indexes..."
sudo docker compose exec -T db psql -U myuser -d hpdavDB <<'EOF'
CREATE INDEX IF NOT EXISTS idx_checkin_timestamp
    ON public.checkinjournal USING btree ("timestamp");

CREATE INDEX IF NOT EXISTS idx_checkin_venue
    ON public.checkinjournal USING btree (venueid, venuetype);

CREATE INDEX IF NOT EXISTS idx_psl_participant_apt
    ON public.participantstatuslogs USING btree (participantid, apartmentid)
    WHERE apartmentid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_travel_locations
    ON public.traveljournal USING btree (travelstartlocationid, travelendlocationid);


-- Speed up "start" lookups
CREATE INDEX idx_psl_participant_time_desc
ON participantstatuslogs (participantid, "timestamp" DESC)
INCLUDE (currentlocation);

-- Speed up "end" lookups
CREATE INDEX idx_psl_participant_time_asc
ON participantstatuslogs (participantid, "timestamp" ASC)
INCLUDE (currentlocation);

-- Optional: filters
CREATE INDEX idx_traveljournal_purpose
ON traveljournal (purpose);

CREATE INDEX idx_traveljournal_starttime
ON traveljournal (travelstarttime);
EOF


echo "[INFO] Indexes created."

echo "[INFO] Finished"
echo " Connect to http://localhost:5000"