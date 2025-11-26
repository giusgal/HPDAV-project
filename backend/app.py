import os
import time
import logging
import psycopg2
import psycopg2.extras

from flask import Flask, jsonify, request, g
from flask_cors import CORS


# =============================================================
# Configurations
# =============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logging.getLogger("werkzeug").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global in-memory cache for participant locations
_participant_locations_cache = None


# =============================================================
# Helpers
# =============================================================
def get_db_connection():
    return psycopg2.connect(
        host="db",
        database="hpdavDB",
        user="myuser",
        password="mypassword"
    )

@app.before_request
def start_timer():
    g.start_time = time.time()
    logger.info(
        f"===>> Incoming request: {request.method} {request.path} "
        f"args={dict(request.args)}"
    )


@app.after_request
def log_request(response):
    if hasattr(g, "start_time"):
        duration = time.time() - g.start_time
        logger.info(
            f"<<=== Completed request: {request.method} {request.path} "
            f"Status={response.status_code} | Time={duration:.3f}s"
        )
    return response


def get_participant_locations(cur):
    """
    Get participant locations using a LATERAL join.
    Cached for all subsequent requests.
    """
    global _participant_locations_cache

    if _participant_locations_cache is not None:
        return _participant_locations_cache

    t0 = time.time()
    logger.info("Loading participant locations from DB...")

    cur.execute("""
        SELECT 
            p.participantid,
            p.householdsize,
            p.havekids,
            p.age,
            p.educationlevel::text as educationlevel,
            p.interestgroup,
            p.joviality,
            a.apartmentid,
            a.location[0] as x,
            a.location[1] as y
        FROM participants p
        CROSS JOIN LATERAL (
            SELECT apartmentid 
            FROM participantstatuslogs 
            WHERE participantid = p.participantid 
              AND apartmentid IS NOT NULL 
            LIMIT 1
        ) psl
        JOIN apartments a ON a.apartmentid = psl.apartmentid
    """)

    _participant_locations_cache = cur.fetchall()
    logger.info(f"Participant locations loaded in {time.time() - t0:.3f}s")
    return _participant_locations_cache

# =============================================================
# API Endpoints
# =============================================================
@app.route('/')
def index():
    return jsonify({"status": "ok", "message": "HPDAV API is running"})


@app.route('/api/area-characteristics')
def area_characteristics():
    total_start = time.time()

    grid_size = request.args.get('grid_size', 500, type=int)
    metric = request.args.get('metric', 'all', type=str)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        results = {}

        # City bounds
        t0 = time.time()
        cur.execute("""
            SELECT 
                MIN(location[0]) as min_x, MAX(location[0]) as max_x,
                MIN(location[1]) as min_y, MAX(location[1]) as max_y
            FROM apartments
        """)
        bounds = cur.fetchone()
        logger.info(f"Bounds query time = {time.time() - t0:.3f}s")

        results['bounds'] = bounds
        results['grid_size'] = grid_size

        # Fetch cached participant locations
        if metric in ['demographics', 'financial', 'all']:
            t0 = time.time()
            participant_data = get_participant_locations(cur)

        # Demographics computation (Python)
        if metric in ['demographics', 'all']:
            t0 = time.time()
            grid_data = {}

            for p in participant_data:
                gx = int(p['x'] // grid_size)
                gy = int(p['y'] // grid_size)
                key = (gx, gy)

                if key not in grid_data:
                    grid_data[key] = {
                        'participants': [],
                        'cell_x': p['x'],
                        'cell_y': p['y']
                    }

                grid_data[key]['participants'].append(p)

            demographics = []
            for (gx, gy), data in grid_data.items():
                participants = data['participants']
                n = len(participants)

                demographics.append({
                    'grid_x': gx,
                    'grid_y': gy,
                    'population': n,
                    'avg_age': sum(p['age'] for p in participants) / n,
                    'avg_household_size': sum(p['householdsize'] for p in participants) / n,
                    'avg_joviality': sum(p['joviality'] for p in participants) / n,
                    'pct_with_kids': sum(1 for p in participants if p['havekids']) / n,
                    'pct_graduate': sum(1 for p in participants if p['educationlevel'] == 'Graduate') / n,
                    'pct_bachelors': sum(1 for p in participants if p['educationlevel'] == 'Bachelors') / n,
                    'pct_highschool': sum(1 for p in participants if p['educationlevel'] == 'HighSchoolOrCollege') / n,
                    'pct_low_education': sum(1 for p in participants if p['educationlevel'] == 'Low') / n,
                    'cell_x': data['cell_x'],
                    'cell_y': data['cell_y']
                })

            results['demographics'] = sorted(
                demographics, key=lambda x: (x['grid_x'], x['grid_y'])
            )

            logger.info(
                f"Demographics computation time = {time.time() - t0:.3f}s"
            )

        # Financial aggregation
        if metric in ['financial', 'all']:
            t0 = time.time()

            # Map participant → grid
            participant_grid = {
                p['participantid']: (int(p['x'] // grid_size),
                                     int(p['y'] // grid_size))
                for p in participant_data
            }

            # DB query (~1.8M rows aggregated)
            q0 = time.time()
            cur.execute("""
                SELECT 
                    participantid,
                    SUM(CASE WHEN category = 'Wage' THEN amount ELSE 0 END) as total_wage,
                    SUM(CASE WHEN category = 'Food' THEN ABS(amount) ELSE 0 END) as total_food,
                    SUM(CASE WHEN category = 'Recreation' THEN ABS(amount) ELSE 0 END) as total_recreation,
                    SUM(CASE WHEN category = 'Shelter' THEN ABS(amount) ELSE 0 END) as total_shelter
                FROM financialjournal
                GROUP BY participantid
            """)
            financial_rows = cur.fetchall()
            logger.info(
                f"Financial journal DB query = {time.time() - q0:.3f}s"
            )

            # Aggregate by grid
            grid_finances = {}
            for row in financial_rows:
                pid = row['participantid']
                if pid not in participant_grid:
                    continue

                gx, gy = participant_grid[pid]
                key = (gx, gy)

                if key not in grid_finances:
                    grid_finances[key] = {
                        'wages': [],
                        'food': [],
                        'recreation': [],
                        'shelter': []
                    }

                grid_finances[key]['wages'].append(row['total_wage'] or 0)
                grid_finances[key]['food'].append(row['total_food'] or 0)
                grid_finances[key]['recreation'].append(row['total_recreation'] or 0)
                grid_finances[key]['shelter'].append(row['total_shelter'] or 0)

            financial = []
            for (gx, gy), data in grid_finances.items():
                n = len(data['wages']) or 1
                financial.append({
                    'grid_x': gx,
                    'grid_y': gy,
                    'avg_income': sum(data['wages']) / n,
                    'avg_food_spending': sum(data['food']) / n,
                    'avg_recreation_spending': sum(data['recreation']) / n,
                    'avg_shelter_spending': sum(data['shelter']) / n,
                })

            results['financial'] = sorted(
                financial, key=lambda x: (x['grid_x'], x['grid_y'])
            )
            logger.info(
                f"Financial aggregation time = {time.time() - t0:.3f}s"
            )

        # Venue aggregation
        if metric in ['venues', 'all']:
            t0 = time.time()
            cur.execute("""
                WITH all_venues AS (
                    SELECT location[0] as x, location[1] as y, 'restaurant' as venue_type FROM restaurants
                    UNION ALL
                    SELECT location[0] as x, location[1] as y, 'pub' as venue_type FROM pubs
                    UNION ALL
                    SELECT location[0] as x, location[1] as y, 'school' as venue_type FROM schools
                    UNION ALL
                    SELECT location[0] as x, location[1] as y, 'employer' as venue_type FROM employers
                )
                SELECT 
                    FLOOR(x / %s) as grid_x,
                    FLOOR(y / %s) as grid_y,
                    COUNT(*) FILTER (WHERE venue_type = 'restaurant') as restaurant_count,
                    COUNT(*) FILTER (WHERE venue_type = 'pub') as pub_count,
                    COUNT(*) FILTER (WHERE venue_type = 'school') as school_count,
                    COUNT(*) FILTER (WHERE venue_type = 'employer') as employer_count,
                    COUNT(*) as total_venues,
                    MIN(x) as cell_x,
                    MIN(y) as cell_y
                FROM all_venues
                GROUP BY FLOOR(x / %s), FLOOR(y / %s)
                ORDER BY grid_x, grid_y
            """, (grid_size, grid_size, grid_size, grid_size))

            results['venues'] = cur.fetchall()
            logger.info(
                f"Venue aggregation time = {time.time() - t0:.3f}s"
            )

        # Apartment aggregation
        if metric in ['apartments', 'all']:
            t0 = time.time()
            cur.execute("""
                SELECT 
                    FLOOR(location[0] / %s) as grid_x,
                    FLOOR(location[1] / %s) as grid_y,
                    COUNT(*) as apartment_count,
                    AVG(rentalcost) as avg_rental_cost,
                    AVG(numberofrooms) as avg_rooms,
                    MIN(location[0]) as cell_x,
                    MIN(location[1]) as cell_y
                FROM apartments
                GROUP BY FLOOR(location[0] / %s), FLOOR(location[1] / %s)
                ORDER BY grid_x, grid_y
            """, (grid_size, grid_size, grid_size, grid_size))

            results['apartments'] = cur.fetchall()
            logger.info(
                f"Apartments aggregation time = {time.time() - t0:.3f}s"
            )

        return jsonify(results)

    except Exception as e:
        logger.error("Error in /api/area-characteristics", exc_info=e)
        return jsonify({"error": str(e)}), 500

    finally:
        cur.close()
        conn.close()


# =============================================================
# Main entry point
# =============================================================
if __name__ == '__main__':
    logger.info("Starting Flask server on 0.0.0.0:5000 ...")
    app.run(host='0.0.0.0', port=5000)
