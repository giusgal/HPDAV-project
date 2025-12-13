import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
import time
import logging
from collections import defaultdict
from datetime import timedelta
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

# Connection pool for better resource management
_connection_pool = None

def get_connection_pool():
    """Get or create a connection pool."""
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            host="db",
            database="hpdavDB",
            user="myuser",
            password="mypassword"
        )
    return _connection_pool

# Cache for participant locations (computed once)
_participant_locations_cache = None
# Cache for venue locations
_venue_locations_cache = None
# Cache for hourly patterns
_hourly_pattern_cache = None
# Cache for pre-aggregated traffic data (computed in SQL, not Python)
_traffic_sql_cache = {}
# Cache for outlier participant IDs
_outlier_participants_cache = None


def get_outlier_participants(cur):
    """
    Get the list of outlier participant IDs.
    Outliers are participants who only logged during the first month (< 2000 records).
    Results are cached in memory for subsequent requests.
    """
    global _outlier_participants_cache
    
    if _outlier_participants_cache is not None:
        logger.info(f"Using cached outlier participants, count = {len(_outlier_participants_cache)}")
        return _outlier_participants_cache
    
    t0 = time.time()
    logger.info("Loading outlier participants from DB...")
    
    cur.execute("""
        SELECT participantid
        FROM participantstatuslogs
        WHERE participantid IS NOT NULL
        GROUP BY participantid
        HAVING count(*) < 2000
    """)
    # Filter out any None values that might still exist
    _outlier_participants_cache = set(
        row['participantid'] for row in cur.fetchall() 
        if row['participantid'] is not None
    )
    logger.info(f"Outlier participants loaded in {time.time() - t0:.3f}s, count = {len(_outlier_participants_cache)}")
    return _outlier_participants_cache

def get_db_connection():
    """Get a connection from the pool."""
    pool = get_connection_pool()
    conn = pool.getconn()
    return conn

def return_db_connection(conn):
    """Return a connection to the pool."""
    pool = get_connection_pool()
    pool.putconn(conn)


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
    Get participant locations efficiently using LATERAL join.
    Results are cached in memory for subsequent requests.
    """
    global _participant_locations_cache
    
    if _participant_locations_cache is not None:
        logger.info("Using cached participant locations")
        return _participant_locations_cache
    
    t0 = time.time()
    logger.info("Loading participant locations from DB...")
    
    # Use LATERAL join with LIMIT 1 - very fast with the index
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
    logger.info(f"Participant locations loaded in {time.time() - t0:.3f}s, count = {len(_participant_locations_cache)}")
    return _participant_locations_cache


def get_venue_locations(cur):
    """Get all venue locations, cached."""
    global _venue_locations_cache
    
    if _venue_locations_cache is not None:
        logger.info("Using cached venue locations")
        return _venue_locations_cache
    
    t0 = time.time()
    logger.info("Loading venue locations from DB...")
    cur.execute("""
        SELECT restaurantid as venueid, 'Restaurant' as venuetype, location[0] as x, location[1] as y FROM restaurants
        UNION ALL
        SELECT pubid, 'Pub', location[0], location[1] FROM pubs
        UNION ALL
        SELECT apartmentid, 'Apartment', location[0], location[1] FROM apartments
        UNION ALL
        SELECT employerid, 'Workplace', location[0], location[1] FROM employers
        UNION ALL
        SELECT schoolid, 'School', location[0], location[1] FROM schools
    """)
    rows = cur.fetchall()
    # Create lookup dict: (venueid, venuetype) -> (x, y)
    _venue_locations_cache = {(r['venueid'], r['venuetype']): (r['x'], r['y']) for r in rows}
    logger.info(f"Venue locations loaded in {time.time() - t0:.3f}s, count = {len(_venue_locations_cache)}")
    return _venue_locations_cache


def get_traffic_aggregation_sql(cur, grid_size, time_period, day_type):
    """Get pre-aggregated traffic data using SQL - much faster than loading all rows."""
    global _traffic_sql_cache
    
    cache_key = (grid_size, time_period, day_type)
    if cache_key in _traffic_sql_cache:
        logger.info(f"Using cached traffic data for key={cache_key}")
        return _traffic_sql_cache[cache_key]
    
    t0 = time.time()
    logger.info(f"Querying traffic aggregation: grid_size={grid_size}, time_period={time_period}, day_type={day_type}")
    
    # Build time filter clause
    time_clause = ""
    if time_period == 'morning':
        time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 6 AND EXTRACT(HOUR FROM c.timestamp) < 10"
    elif time_period == 'midday':
        time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 10 AND EXTRACT(HOUR FROM c.timestamp) < 14"
    elif time_period == 'afternoon':
        time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 14 AND EXTRACT(HOUR FROM c.timestamp) < 18"
    elif time_period == 'evening':
        time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 18 AND EXTRACT(HOUR FROM c.timestamp) < 22"
    elif time_period == 'night':
        time_clause = "AND (EXTRACT(HOUR FROM c.timestamp) >= 22 OR EXTRACT(HOUR FROM c.timestamp) < 6)"
    
    # Build day filter clause
    day_clause = ""
    if day_type == 'weekday':
        day_clause = "AND EXTRACT(DOW FROM c.timestamp) BETWEEN 1 AND 5"
    elif day_type == 'weekend':
        day_clause = "AND EXTRACT(DOW FROM c.timestamp) IN (0, 6)"
    
    # Execute aggregation in SQL - much more efficient
    query = f"""
        WITH venue_locations AS (
            SELECT restaurantid as venueid, 'Restaurant'::text as venuetype, location[0] as x, location[1] as y FROM restaurants
            UNION ALL
            SELECT pubid, 'Pub', location[0], location[1] FROM pubs
            UNION ALL
            SELECT apartmentid, 'Apartment', location[0], location[1] FROM apartments
            UNION ALL
            SELECT employerid, 'Workplace', location[0], location[1] FROM employers
            UNION ALL
            SELECT schoolid, 'School', location[0], location[1] FROM schools
        ),
        filtered_checkins AS (
            SELECT 
                c.participantid,
                c.venuetype::text,
                v.x,
                v.y
            FROM checkinjournal c
            JOIN venue_locations v ON c.venueid = v.venueid AND c.venuetype::text = v.venuetype
            WHERE 1=1 {time_clause} {day_clause}
        )
        SELECT 
            FLOOR(x / {grid_size})::int as grid_x,
            FLOOR(y / {grid_size})::int as grid_y,
            COUNT(*) as total_visits,
            COUNT(DISTINCT participantid) as unique_visitors,
            COUNT(*) FILTER (WHERE venuetype = 'Restaurant') as restaurant_visits,
            COUNT(*) FILTER (WHERE venuetype = 'Pub') as pub_visits,
            COUNT(*) FILTER (WHERE venuetype = 'Apartment') as home_visits,
            COUNT(*) FILTER (WHERE venuetype = 'Workplace') as work_visits,
            COUNT(*) FILTER (WHERE venuetype = 'School') as school_visits,
            MIN(x) as cell_x,
            MIN(y) as cell_y
        FROM filtered_checkins
        GROUP BY FLOOR(x / {grid_size}), FLOOR(y / {grid_size})
        ORDER BY total_visits DESC
    """
    
    cur.execute(query)
    traffic_data = [dict(row) for row in cur.fetchall()]
    logger.info(f"Traffic aggregation completed in {time.time() - t0:.3f}s, rows = {len(traffic_data)}")
    
    # Cache the result
    _traffic_sql_cache[cache_key] = traffic_data
    return traffic_data


def get_hourly_pattern(cur):
    """Get hourly pattern, cached."""
    global _hourly_pattern_cache
    
    if _hourly_pattern_cache is not None:
        logger.info("Using cached hourly pattern")
        return _hourly_pattern_cache
    
    t0 = time.time()
    logger.info("Loading hourly pattern from DB...")
    cur.execute("""
        SELECT 
            EXTRACT(HOUR FROM timestamp)::int as hour,
            COUNT(*) as visits,
            COUNT(DISTINCT participantid) as unique_visitors
        FROM checkinjournal
        GROUP BY EXTRACT(HOUR FROM timestamp)
        ORDER BY hour
    """)
    _hourly_pattern_cache = [dict(row) for row in cur.fetchall()]
    logger.info(f"Hourly pattern loaded in {time.time() - t0:.3f}s")
    return _hourly_pattern_cache


# =============================================================
# API Endpoints
# =============================================================
@app.route('/')
def index():
    return jsonify({"status": "ok", "message": "HPDAV API is running"})


@app.route('/api/area-characteristics')
def area_characteristics():
    """
    Parametrized endpoint to characterize distinct areas of the city.
    
    Parameters:
    - grid_size: Size of the grid cells (default: 500)
    - metric: What to aggregate - 'demographics', 'financial', 'venues', 'apartments', 'all' (default: 'all')
    - exclude_outliers: 'true' or 'false' - exclude participants with < 2000 records (default: 'false')
    
    All metrics are aggregated over the entire 15-month period.
    """
    grid_size = request.args.get('grid_size', 500, type=int)
    metric = request.args.get('metric', 'all', type=str)
    exclude_outliers = request.args.get('exclude_outliers', 'false', type=str).lower() == 'true'
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Get outlier participants if needed
        outlier_pids = set()
        if exclude_outliers:
            outlier_pids = get_outlier_participants(cur)
        
        results = {
            'exclude_outliers': exclude_outliers
        }
        
        # Get city bounds from apartments (fast query)
        t0 = time.time()
        cur.execute("""
            SELECT 
                MIN(location[0]) as min_x, MAX(location[0]) as max_x,
                MIN(location[1]) as min_y, MAX(location[1]) as max_y
            FROM apartments
        """)
        bounds = cur.fetchone()
        logger.info(f"Bounds query time = {time.time() - t0:.3f}s")
        
        results['bounds'] = {
            'min_x': bounds['min_x'],
            'max_x': bounds['max_x'],
            'min_y': bounds['min_y'],
            'max_y': bounds['max_y']
        }
        results['grid_size'] = grid_size
        
        # Get cached participant locations for demographics and financial queries
        if metric in ['demographics', 'financial', 'all']:
            participant_data = get_participant_locations(cur)
            # Filter out outliers if requested
            if exclude_outliers and outlier_pids:
                participant_data = [p for p in participant_data if p['participantid'] not in outlier_pids]
                logger.info(f"Filtered participant data to {len(participant_data)} after excluding outliers")
        
        if metric in ['demographics', 'all']:
            # Aggregate in Python - much faster than SQL on 113M rows
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
            results['demographics'] = sorted(demographics, key=lambda x: (x['grid_x'], x['grid_y']))
            logger.info(f"Demographics computation time = {time.time() - t0:.3f}s, cells = {len(demographics)}")
        
        if metric in ['financial', 'all']:
            t0 = time.time()
            
            # Build participant to grid mapping
            participant_grid = {}
            for p in participant_data:
                gx = int(p['x'] // grid_size)
                gy = int(p['y'] // grid_size)
                participant_grid[p['participantid']] = (gx, gy)
            
            # Get financial data aggregated by participant over entire period
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
            logger.info(f"Financial journal DB query = {time.time() - q0:.3f}s")
            
            # Aggregate by grid
            grid_finances = {}
            for row in financial_rows:
                pid = row['participantid']
                if pid not in participant_grid:
                    continue
                gx, gy = participant_grid[pid]
                key = (gx, gy)
                if key not in grid_finances:
                    grid_finances[key] = {'wages': [], 'food': [], 'recreation': [], 'shelter': []}
                grid_finances[key]['wages'].append(row['total_wage'] or 0)
                grid_finances[key]['food'].append(row['total_food'] or 0)
                grid_finances[key]['recreation'].append(row['total_recreation'] or 0)
                grid_finances[key]['shelter'].append(row['total_shelter'] or 0)
            
            financial = []
            for (gx, gy), data in grid_finances.items():
                n = len(data['wages'])
                financial.append({
                    'grid_x': gx,
                    'grid_y': gy,
                    'avg_income': sum(data['wages']) / n if n > 0 else 0,
                    'avg_food_spending': sum(data['food']) / n if n > 0 else 0,
                    'avg_recreation_spending': sum(data['recreation']) / n if n > 0 else 0,
                    'avg_shelter_spending': sum(data['shelter']) / n if n > 0 else 0
                })
            results['financial'] = sorted(financial, key=lambda x: (x['grid_x'], x['grid_y']))
            logger.info(f"Financial aggregation time = {time.time() - t0:.3f}s, cells = {len(financial)}")
        
        if metric in ['venues', 'all']:
            # Count venues by type in each grid cell (fast - small tables)
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
            results['venues'] = [dict(row) for row in cur.fetchall()]
            logger.info(f"Venues aggregation time = {time.time() - t0:.3f}s")
        
        if metric in ['apartments', 'all']:
            # Aggregate apartment/building data by area (fast - small table)
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
            results['apartments'] = [dict(row) for row in cur.fetchall()]
            logger.info(f"Apartments aggregation time = {time.time() - t0:.3f}s")
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/area-characteristics", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


@app.route('/api/traffic-patterns')
def traffic_patterns():
    """
    Pandemic-style bubble map endpoint - returns aggregated location data.
    
    Parameters:
    - time_period: 'all', 'morning' (6-12), 'afternoon' (12-18), 'evening' (18-24), 'night' (0-6) (default: 'all')
    - day_type: 'all', 'weekday', 'weekend' (default: 'all')
    - sample_rate: Percentage of data to sample (1-100, default: 100)
    - start_date: Start date for filtering (YYYY-MM-DD, optional)
    - end_date: End date for filtering (YYYY-MM-DD, optional)
    """
    time_period = request.args.get('time_period', 'all', type=str)
    day_type = request.args.get('day_type', 'all', type=str)
    sample_rate = request.args.get('sample_rate', 100, type=int)
    start_date = request.args.get('start_date', None, type=str)
    end_date = request.args.get('end_date', None, type=str)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {}
        
        # Build time filter clause
        time_clause = ""
        if time_period == 'morning':
            time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 6 AND EXTRACT(HOUR FROM c.timestamp) < 12"
        elif time_period == 'afternoon':
            time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 12 AND EXTRACT(HOUR FROM c.timestamp) < 18"
        elif time_period == 'evening':
            time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 18 AND EXTRACT(HOUR FROM c.timestamp) < 24"
        elif time_period == 'night':
            time_clause = "AND EXTRACT(HOUR FROM c.timestamp) >= 0 AND EXTRACT(HOUR FROM c.timestamp) < 6"
        
        # Build day filter clause
        day_clause = ""
        if day_type == 'weekday':
            day_clause = "AND EXTRACT(DOW FROM c.timestamp) BETWEEN 1 AND 5"
        elif day_type == 'weekend':
            day_clause = "AND EXTRACT(DOW FROM c.timestamp) IN (0, 6)"
        
        # Build date range filter clause
        date_clause = ""
        if start_date:
            date_clause += f" AND c.timestamp >= '{start_date}'::date"
        if end_date:
            date_clause += f" AND c.timestamp < '{end_date}'::date + interval '1 day'"
        
        # Get aggregated location data
        t0 = time.time()
        sample_clause = f"AND random() < {sample_rate / 100.0}" if sample_rate < 100 else ""
        
        query = f"""
            WITH venue_locations AS (
                SELECT restaurantid as venueid, 'Restaurant'::text as venuetype, location[0] as x, location[1] as y FROM restaurants
                UNION ALL
                SELECT pubid, 'Pub', location[0], location[1] FROM pubs
                UNION ALL
                SELECT apartmentid, 'Apartment', location[0], location[1] FROM apartments
                UNION ALL
                SELECT employerid, 'Workplace', location[0], location[1] FROM employers
                UNION ALL
                SELECT schoolid, 'School', location[0], location[1] FROM schools
            )
            SELECT 
                v.x,
                v.y,
                v.venuetype,
                COUNT(*) as visits,
                COUNT(DISTINCT c.participantid) as unique_visitors
            FROM checkinjournal c
            JOIN venue_locations v ON c.venueid = v.venueid AND c.venuetype::text = v.venuetype
            WHERE 1=1 {time_clause} {day_clause} {date_clause} {sample_clause}
            GROUP BY v.x, v.y, v.venuetype
            HAVING COUNT(*) > 0
            ORDER BY visits DESC
        """
        
        cur.execute(query)
        locations = [dict(row) for row in cur.fetchall()]
        logger.info(f"Location aggregation completed in {time.time() - t0:.3f}s, locations = {len(locations)}")
        
        results['locations'] = locations
        results['time_period'] = time_period
        results['day_type'] = day_type
        results['sample_rate'] = sample_rate
        results['start_date'] = start_date
        results['end_date'] = end_date
        
        # Get available date range
        cur.execute("""
            SELECT 
                MIN(timestamp::date) as min_date,
                MAX(timestamp::date) as max_date
            FROM checkinjournal
        """)
        date_range = cur.fetchone()
        results['available_dates'] = {
            'min': str(date_range['min_date']) if date_range['min_date'] else None,
            'max': str(date_range['max_date']) if date_range['max_date'] else None
        }
        
        # Calculate statistics
        if locations:
            visits = [row['visits'] for row in locations]
            results['statistics'] = {
                'total_locations': len(locations),
                'total_visits': sum(visits),
                'max_visits': max(visits),
                'avg_visits': sum(visits) / len(visits),
                'p90_visits': sorted(visits)[int(len(visits) * 0.9)] if len(visits) >= 10 else max(visits)
            }
        
        # Get hourly pattern
        results['hourly_pattern'] = get_hourly_pattern(cur)
        
        logger.info(f"Total processing time = {time.time() - t0:.3f}s")
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/traffic-patterns", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


# Cache for participant list
_participants_cache = None

@app.route('/api/participant-routines')
def participant_routines():
    """
    Parametrized endpoint to get daily routines for one or two participants.
    
    Parameters:
    - participant_ids: Comma-separated participant IDs (e.g., "1,2" or "1")
    - date: Specific date to show (YYYY-MM-DD) or 'typical' for aggregated pattern (default: 'typical')
    - month: Filter by month number 1-6 (June-November) or 'all' (default: 'all')
    - day_type: Filter by day type: 'all', 'weekday', or 'weekend' (default: 'all')
    """
    global _participants_cache
    
    participant_ids_str = request.args.get('participant_ids', '', type=str)
    date_param = request.args.get('date', 'typical', type=str)
    month_param = request.args.get('month', 'all', type=str)
    day_type_param = request.args.get('day_type', 'all', type=str)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {}
        
        # Get available months from the data
        t0 = time.time()
        cur.execute("""
            SELECT DISTINCT 
                EXTRACT(YEAR FROM timestamp)::int as year,
                EXTRACT(MONTH FROM timestamp)::int as month
            FROM checkinjournal
            ORDER BY year, month
        """)
        month_data = cur.fetchall()
        available_months = []
        for row in month_data:
            available_months.append({
                'year': row['year'],
                'month': row['month'],
                'label': f"{['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][row['month']]} {row['year']}"
            })
        results['available_months'] = available_months
        logger.info(f"Available months query time = {time.time() - t0:.3f}s")
        
        # Get list of all participants with their characteristics (cached)
        t0 = time.time()
        if _participants_cache is None:
            logger.info("Loading participants cache from DB...")
            cur.execute("""
                SELECT 
                    p.participantid,
                    p.age,
                    p.educationlevel::text as education,
                    p.interestgroup,
                    p.householdsize,
                    p.havekids,
                    p.joviality
                FROM participants p
                ORDER BY p.participantid
            """)
            _participants_cache = [dict(row) for row in cur.fetchall()]
            logger.info(f"Participants cache loaded in {time.time() - t0:.3f}s, count = {len(_participants_cache)}")
        else:
            logger.info("Using cached participants list")
        
        results['participants'] = _participants_cache
        
        # If no specific participants requested, return basic list for selection
        if not participant_ids_str:
            # Return summary based on checkinjournal (much faster than participantstatuslogs)
            t0 = time.time()
            
            # Build month filter (format: YYYY-MM)
            month_filter = ""
            if month_param != 'all':
                try:
                    year, month = month_param.split('-')
                    month_filter = f"WHERE EXTRACT(YEAR FROM timestamp) = {year} AND EXTRACT(MONTH FROM timestamp) = {month}"
                except (ValueError, AttributeError):
                    pass
            
            # Add day type filter
            day_type_filter = ""
            if day_type_param == 'weekday':
                day_type_filter = "EXTRACT(DOW FROM timestamp) BETWEEN 1 AND 5"  # Monday-Friday
            elif day_type_param == 'weekend':
                day_type_filter = "EXTRACT(DOW FROM timestamp) IN (0, 6)"  # Sunday, Saturday
            
            # Combine filters
            if month_filter and day_type_filter:
                combined_filter = f"{month_filter} AND {day_type_filter}"
            elif month_filter:
                combined_filter = month_filter
            elif day_type_filter:
                combined_filter = f"WHERE {day_type_filter}"
            else:
                combined_filter = ""
            
            cur.execute(f"""
                WITH participant_checkins AS (
                    SELECT 
                        participantid,
                        COUNT(*) as total_checkins,
                        COUNT(*) FILTER (WHERE venuetype = 'Apartment') as home_checkins,
                        COUNT(*) FILTER (WHERE venuetype = 'Workplace') as work_checkins,
                        COUNT(*) FILTER (WHERE venuetype = 'Restaurant') as restaurant_checkins,
                        COUNT(*) FILTER (WHERE venuetype = 'Pub') as pub_checkins,
                        COUNT(DISTINCT DATE(timestamp)) as days_tracked
                    FROM checkinjournal
                    {combined_filter}
                    GROUP BY participantid
                )
                SELECT 
                    participantid,
                    days_tracked,
                    ROUND(100.0 * home_checkins / NULLIF(total_checkins, 0), 1) as pct_at_home,
                    ROUND(100.0 * work_checkins / NULLIF(total_checkins, 0), 1) as pct_at_work,
                    ROUND(100.0 * restaurant_checkins / NULLIF(total_checkins, 0), 1) as pct_restaurant,
                    ROUND(100.0 * pub_checkins / NULLIF(total_checkins, 0), 1) as pct_recreation
                FROM participant_checkins
                ORDER BY participantid
            """)
            results['routine_summaries'] = [dict(row) for row in cur.fetchall()]
            logger.info(f"Routine summaries query time = {time.time() - t0:.3f}s")
            cur.close()
            return_db_connection(conn)
            return jsonify(results)
        
        # Parse participant IDs
        try:
            participant_ids = [int(x.strip()) for x in participant_ids_str.split(',') if x.strip()]
        except ValueError:
            cur.close()
            return_db_connection(conn)
            return jsonify({"error": "Invalid participant IDs"}), 400
        
        if len(participant_ids) == 0 or len(participant_ids) > 2:
            cur.close()
            return_db_connection(conn)
            return jsonify({"error": "Please provide 1 or 2 participant IDs"}), 400
        
        # Get detailed routine data for selected participants
        t0 = time.time()
        routines = {}
        
        for pid in participant_ids:
            # Get participant info
            participant_info = next((p for p in _participants_cache if p['participantid'] == pid), None)
            
            # Build month filter (format: YYYY-MM)
            month_filter = ""
            query_params = [pid]
            if month_param != 'all':
                try:
                    year, month = month_param.split('-')
                    month_filter = f"AND EXTRACT(YEAR FROM timestamp) = {year} AND EXTRACT(MONTH FROM timestamp) = {month}"
                except (ValueError, AttributeError):
                    pass
            
            # Add day type filter
            day_type_filter = ""
            if day_type_param == 'weekday':
                day_type_filter = "AND EXTRACT(DOW FROM timestamp) BETWEEN 1 AND 5"  # Monday-Friday
            elif day_type_param == 'weekend':
                day_type_filter = "AND EXTRACT(DOW FROM timestamp) IN (0, 6)"  # Sunday, Saturday
            
            # Use checkinjournal for typical pattern (much faster than participantstatuslogs)
            cur.execute(f"""
                SELECT 
                    EXTRACT(HOUR FROM timestamp)::int as hour,
                    venuetype::text as activity,
                    COUNT(*) as count
                FROM checkinjournal
                WHERE participantid = %s {month_filter} {day_type_filter}
                GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                ORDER BY hour, count DESC
            """, tuple(query_params))
            hourly_data = cur.fetchall()
            
            # Convert to timeline format
            hourly_pattern = {}
            for row in hourly_data:
                hour = row['hour']
                if hour not in hourly_pattern:
                    hourly_pattern[hour] = []
                # Map venue types to activity names
                activity_map = {
                    'Apartment': 'AtHome',
                    'Workplace': 'AtWork',
                    'Restaurant': 'AtRestaurant',
                    'Pub': 'AtRecreation',
                    'School': 'AtWork'
                }
                hourly_pattern[hour].append({
                    'activity': activity_map.get(row['activity'], row['activity']),
                    'count': row['count']
                })
            
            # Build timeline
            timeline = []
            for hour in range(24):
                if hour in hourly_pattern:
                    acts = hourly_pattern[hour]
                    dominant = max(acts, key=lambda x: x['count'])
                    total_count = sum(a['count'] for a in acts)
                    timeline.append({
                        'hour': hour,
                        'dominant_activity': dominant['activity'],
                        'confidence': round(dominant['count'] / total_count * 100, 1),
                        'activities': acts
                    })
                else:
                    timeline.append({
                        'hour': hour,
                        'dominant_activity': 'Unknown',
                        'confidence': 0,
                        'activities': []
                    })
            
            # Get days tracked
            cur.execute("""
                SELECT COUNT(DISTINCT DATE(timestamp)) as days
                FROM checkinjournal WHERE participantid = %s
            """, (pid,))
            days_result = cur.fetchone()
            
            # Get participant's home (apartment) and work (employer) locations
            cur.execute("""
                SELECT DISTINCT ON (psl.participantid)
                    a.location[0] as home_x,
                    a.location[1] as home_y,
                    a.apartmentid
                FROM participantstatuslogs psl
                JOIN apartments a ON a.apartmentid = psl.apartmentid
                WHERE psl.participantid = %s
                  AND psl.apartmentid IS NOT NULL
                LIMIT 1
            """, (pid,))
            home_result = cur.fetchone()
            
            cur.execute("""
                SELECT DISTINCT ON (psl.participantid)
                    e.location[0] as work_x,
                    e.location[1] as work_y,
                    e.employerid
                FROM participantstatuslogs psl
                JOIN jobs j ON j.jobid = psl.jobid
                JOIN employers e ON e.employerid = j.employerid
                WHERE psl.participantid = %s
                  AND psl.jobid IS NOT NULL
                LIMIT 1
            """, (pid,))
            work_result = cur.fetchone()
            
            routines[pid] = {
                'participant': participant_info,
                'type': 'typical',
                'timeline': timeline,
                'days_sampled': days_result['days'] if days_result else 0,
                'home_location': {
                    'x': home_result['home_x'],
                    'y': home_result['home_y'],
                    'apartmentid': home_result['apartmentid']
                } if home_result else None,
                'work_location': {
                    'x': work_result['work_x'],
                    'y': work_result['work_y'],
                    'employerid': work_result['employerid']
                } if work_result else None
            }
        
        # Get checkin data for these participants (venue visits)
        for pid in participant_ids:
            # Build month filter (format: YYYY-MM)
            month_filter = ""
            if month_param != 'all':
                try:
                    year, month = month_param.split('-')
                    month_filter = f"AND EXTRACT(YEAR FROM timestamp) = {year} AND EXTRACT(MONTH FROM timestamp) = {month}"
                except (ValueError, AttributeError):
                    pass
            
            # Add day type filter
            day_type_filter = ""
            if day_type_param == 'weekday':
                day_type_filter = "AND EXTRACT(DOW FROM timestamp) BETWEEN 1 AND 5"  # Monday-Friday
            elif day_type_param == 'weekend':
                day_type_filter = "AND EXTRACT(DOW FROM timestamp) IN (0, 6)"  # Sunday, Saturday
            
            if date_param == 'typical':
                cur.execute(f"""
                    SELECT 
                        EXTRACT(HOUR FROM timestamp)::int as hour,
                        venuetype::text as venue_type,
                        COUNT(*) as visit_count
                    FROM checkinjournal
                    WHERE participantid = %s {month_filter} {day_type_filter}
                    GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                    ORDER BY hour
                """, (pid,))
            else:
                cur.execute(f"""
                    SELECT 
                        EXTRACT(HOUR FROM timestamp)::int as hour,
                        venuetype::text as venue_type,
                        COUNT(*) as visit_count
                    FROM checkinjournal
                    WHERE participantid = %s AND DATE(timestamp) = %s {month_filter} {day_type_filter}
                    GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                    ORDER BY hour
                """, (pid, date_param))
            
            checkins = [dict(row) for row in cur.fetchall()]
            if pid in routines:
                routines[pid]['checkins'] = checkins
        
        results['routines'] = routines
        results['selected_ids'] = participant_ids
        logger.info(f"Participant routines query time = {time.time() - t0:.3f}s for {len(participant_ids)} participants")
        
        # Get all movement routes from participantstatuslogs (all position changes)
        if month_param != 'all':
            try:
                year, month = month_param.split('-')
                month_filter_travel = f"AND EXTRACT(YEAR FROM psl.timestamp) = {year} AND EXTRACT(MONTH FROM psl.timestamp) = {month}"
            except (ValueError, AttributeError):
                month_filter_travel = ""
        else:
            month_filter_travel = ""
        
        # Add day type filter for travel routes
        day_type_filter_travel = ""
        if day_type_param == 'weekday':
            day_type_filter_travel = "AND EXTRACT(DOW FROM psl.timestamp) BETWEEN 1 AND 5"  # Monday-Friday
        elif day_type_param == 'weekend':
            day_type_filter_travel = "AND EXTRACT(DOW FROM psl.timestamp) IN (0, 6)"  # Sunday, Saturday
        
        travel_routes = {}
        for pid in participant_ids:
            cur.execute(f"""
                WITH ordered_positions AS (
                    SELECT 
                        currentlocation[0] as x,
                        currentlocation[1] as y,
                        timestamp,
                        LAG(currentlocation[0]) OVER (ORDER BY timestamp) as prev_x,
                        LAG(currentlocation[1]) OVER (ORDER BY timestamp) as prev_y,
                        LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
                    FROM participantstatuslogs psl
                    WHERE participantid = %s
                        AND currentlocation IS NOT NULL
                        {month_filter_travel}
                        {day_type_filter_travel}
                    ORDER BY timestamp
                )
                SELECT 
                    prev_x as start_x,
                    prev_y as start_y,
                    x as end_x,
                    y as end_y,
                    COUNT(*) as movement_count
                FROM ordered_positions
                WHERE prev_x IS NOT NULL 
                    AND prev_y IS NOT NULL
                    AND (prev_x != x OR prev_y != y)  -- Only actual movements
                    AND EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) <= 1800  -- Max 30 minutes between positions
                    AND SQRT(POWER(x - prev_x, 2) + POWER(y - prev_y, 2)) <= 3000  -- Max 3000 units distance
                GROUP BY prev_x, prev_y, x, y
                HAVING COUNT(*) >= 2  -- At least 2 occurrences of the same route
                ORDER BY movement_count DESC
                LIMIT 150
            """, (pid,))
            
            routes = [dict(row) for row in cur.fetchall()]
            travel_routes[pid] = routes
        
        results['travel_routes'] = travel_routes
        logger.info(f"Movement routes query completed for {len(participant_ids)} participants")
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/participant-routines", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


# Cache for temporal patterns
_temporal_patterns_cache = {}

@app.route('/api/temporal-patterns')
def temporal_patterns():
    """
    Parametrized endpoint to analyze how city patterns change over time.
    
    Parameters:
    - granularity: 'daily', 'weekly', 'monthly' (default: 'weekly')
    - metric: 'activity', 'spending', 'social', 'all' (default: 'all')
    - venue_type: 'all', 'Restaurant', 'Pub', 'Apartment', 'Workplace' (default: 'all')
    - exclude_outliers: 'true' or 'false' - exclude participants with < 2000 records (default: 'false')
    """
    global _temporal_patterns_cache
    
    granularity = request.args.get('granularity', 'weekly', type=str)
    metric = request.args.get('metric', 'all', type=str)
    venue_type = request.args.get('venue_type', 'all', type=str)
    exclude_outliers = request.args.get('exclude_outliers', 'false', type=str).lower() == 'true'
    
    cache_key = (granularity, metric, venue_type, exclude_outliers)
    if cache_key in _temporal_patterns_cache:
        logger.info(f"Using cached temporal patterns for key={cache_key}")
        return jsonify(_temporal_patterns_cache[cache_key])
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Get outlier participants if needed
        outlier_filter = ""
        outlier_filter_fin = ""
        outlier_filter_social = ""
        if exclude_outliers:
            outlier_pids = get_outlier_participants(cur)
            if outlier_pids:
                outlier_list = ','.join(str(pid) for pid in outlier_pids)
                outlier_filter = f"AND participantid NOT IN ({outlier_list})"
                outlier_filter_fin = f"WHERE participantid NOT IN ({outlier_list})"
                outlier_filter_social = f"AND participantidfrom NOT IN ({outlier_list}) AND participantidto NOT IN ({outlier_list})"
        
        results = {
            'granularity': granularity,
            'metric': metric,
            'venue_type': venue_type,
            'exclude_outliers': exclude_outliers
        }
        
        # Determine date truncation based on granularity
        if granularity == 'daily':
            date_trunc = "DATE(timestamp)"
            date_trunc_fin = "DATE(timestamp)"
        elif granularity == 'monthly':
            date_trunc = "DATE_TRUNC('month', timestamp)"
            date_trunc_fin = "DATE_TRUNC('month', timestamp)"
        else:  # weekly
            date_trunc = "DATE_TRUNC('week', timestamp)"
            date_trunc_fin = "DATE_TRUNC('week', timestamp)"
        
        # Get date range from checkinjournal
        t0 = time.time()
        cur.execute("""
            SELECT MIN(timestamp)::date as min_date, MAX(timestamp)::date as max_date
            FROM checkinjournal
        """)
        date_range = cur.fetchone()
        logger.info(f"Date range query time = {time.time() - t0:.3f}s")
        
        results['date_range'] = {
            'start': str(date_range['min_date']),
            'end': str(date_range['max_date'])
        }
        
        # Activity patterns over time
        if metric in ['activity', 'all']:
            t0 = time.time()
            venue_filter = "WHERE 1=1"
            if venue_type != 'all':
                venue_filter = f"WHERE venuetype = '{venue_type}'"
            
            cur.execute(f"""
                SELECT 
                    {date_trunc} as period,
                    COUNT(*) as total_checkins,
                    COUNT(DISTINCT participantid) as unique_visitors,
                    COUNT(*) FILTER (WHERE venuetype = 'Restaurant') as restaurant_visits,
                    COUNT(*) FILTER (WHERE venuetype = 'Pub') as pub_visits,
                    COUNT(*) FILTER (WHERE venuetype = 'Apartment') as home_activity,
                    COUNT(*) FILTER (WHERE venuetype = 'Workplace') as work_activity,
                    COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp) BETWEEN 6 AND 9) as morning_activity,
                    COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp) BETWEEN 10 AND 14) as midday_activity,
                    COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp) BETWEEN 15 AND 18) as afternoon_activity,
                    COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp) BETWEEN 19 AND 23) as evening_activity,
                    COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp) BETWEEN 0 AND 5) as night_activity
                FROM checkinjournal
                {venue_filter} {outlier_filter}
                GROUP BY {date_trunc}
                ORDER BY period
            """)
            activity_data = cur.fetchall()
            logger.info(f"Activity patterns query time = {time.time() - t0:.3f}s, periods = {len(activity_data)}")
            results['activity'] = [
                {
                    'period': str(row['period'].date()) if hasattr(row['period'], 'date') else str(row['period']),
                    'total_checkins': row['total_checkins'],
                    'unique_visitors': row['unique_visitors'],
                    'restaurant_visits': row['restaurant_visits'],
                    'pub_visits': row['pub_visits'],
                    'home_activity': row['home_activity'],
                    'work_activity': row['work_activity'],
                    'morning_activity': row['morning_activity'],
                    'midday_activity': row['midday_activity'],
                    'afternoon_activity': row['afternoon_activity'],
                    'evening_activity': row['evening_activity'],
                    'night_activity': row['night_activity']
                }
                for row in activity_data
            ]
        
        # Spending patterns over time
        if metric in ['spending', 'all']:
            t0 = time.time()
            cur.execute(f"""
                SELECT 
                    {date_trunc_fin} as period,
                    COUNT(*) as transaction_count,
                    COUNT(DISTINCT participantid) as unique_spenders,
                    SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_spending,
                    SUM(CASE WHEN category = 'Food' THEN ABS(amount) ELSE 0 END) as food_spending,
                    SUM(CASE WHEN category = 'Recreation' THEN ABS(amount) ELSE 0 END) as recreation_spending,
                    SUM(CASE WHEN category = 'Shelter' THEN ABS(amount) ELSE 0 END) as shelter_spending,
                    SUM(CASE WHEN category = 'Education' THEN ABS(amount) ELSE 0 END) as education_spending,
                    AVG(CASE WHEN amount < 0 THEN ABS(amount) END) as avg_transaction
                FROM financialjournal
                {outlier_filter_fin}
                GROUP BY {date_trunc_fin}
                ORDER BY period
            """)
            spending_data = cur.fetchall()
            logger.info(f"Spending patterns query time = {time.time() - t0:.3f}s, periods = {len(spending_data)}")
            results['spending'] = [
                {
                    'period': str(row['period'].date()) if hasattr(row['period'], 'date') else str(row['period']),
                    'transaction_count': row['transaction_count'],
                    'unique_spenders': row['unique_spenders'],
                    'total_income': float(row['total_income'] or 0),
                    'total_spending': float(row['total_spending'] or 0),
                    'food_spending': float(row['food_spending'] or 0),
                    'recreation_spending': float(row['recreation_spending'] or 0),
                    'shelter_spending': float(row['shelter_spending'] or 0),
                    'education_spending': float(row['education_spending'] or 0),
                    'avg_transaction': float(row['avg_transaction'] or 0)
                }
                for row in spending_data
            ]
        
        # Social network changes over time
        if metric in ['social', 'all']:
            t0 = time.time()
            cur.execute(f"""
                SELECT 
                    {date_trunc} as period,
                    COUNT(*) as interactions,
                    COUNT(DISTINCT participantidfrom) as active_initiators,
                    COUNT(DISTINCT participantidto) as contacted_people,
                    COUNT(DISTINCT participantidfrom) + COUNT(DISTINCT participantidto) as total_social_participants
                FROM socialnetwork
                WHERE 1=1 {outlier_filter_social}
                GROUP BY {date_trunc}
                ORDER BY period
            """)
            social_data = cur.fetchall()
            logger.info(f"Social patterns query time = {time.time() - t0:.3f}s, periods = {len(social_data)}")
            results['social'] = [
                {
                    'period': str(row['period'].date()) if hasattr(row['period'], 'date') else str(row['period']),
                    'interactions': row['interactions'],
                    'active_initiators': row['active_initiators'],
                    'contacted_people': row['contacted_people'],
                    'total_social_participants': row['total_social_participants']
                }
                for row in social_data
            ]
        
        # Calculate trend summaries
        if metric in ['activity', 'all'] and 'activity' in results and len(results['activity']) > 1:
            first_period = results['activity'][0]
            last_period = results['activity'][-1]
            results['activity_trends'] = {
                'checkin_change_pct': round((last_period['total_checkins'] - first_period['total_checkins']) / first_period['total_checkins'] * 100, 1) if first_period['total_checkins'] > 0 else 0,
                'restaurant_change_pct': round((last_period['restaurant_visits'] - first_period['restaurant_visits']) / first_period['restaurant_visits'] * 100, 1) if first_period['restaurant_visits'] > 0 else 0,
                'pub_change_pct': round((last_period['pub_visits'] - first_period['pub_visits']) / first_period['pub_visits'] * 100, 1) if first_period['pub_visits'] > 0 else 0
            }
        
        if metric in ['spending', 'all'] and 'spending' in results and len(results['spending']) > 1:
            first_period = results['spending'][0]
            last_period = results['spending'][-1]
            results['spending_trends'] = {
                'spending_change_pct': round((last_period['total_spending'] - first_period['total_spending']) / first_period['total_spending'] * 100, 1) if first_period['total_spending'] > 0 else 0,
                'food_change_pct': round((last_period['food_spending'] - first_period['food_spending']) / first_period['food_spending'] * 100, 1) if first_period['food_spending'] > 0 else 0,
                'recreation_change_pct': round((last_period['recreation_spending'] - first_period['recreation_spending']) / first_period['recreation_spending'] * 100, 1) if first_period['recreation_spending'] > 0 else 0
            }
        
        # Cache the result
        _temporal_patterns_cache[cache_key] = results
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/temporal-patterns", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


# =============================================================
# Main entry point
# =============================================================

@app.route('/api/buildings-map')
def buildings_map():
    """
    API endpoint to get building polygons and venue locations for the map visualization.
    Returns buildings with their polygon coordinates and all venue types with their point locations.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        results = {}

        # Get city bounds from building polygons (using bounding box of all buildings)
        t0 = time.time()
        cur.execute("""
            WITH building_boxes AS (
                SELECT box(location) as bbox FROM buildings WHERE location IS NOT NULL
            )
            SELECT 
                MIN((bbox[0])[0]) as min_x, MAX((bbox[1])[0]) as max_x,
                MIN((bbox[0])[1]) as min_y, MAX((bbox[1])[1]) as max_y
            FROM building_boxes
        """)
        bounds = cur.fetchone()
        
        results['bounds'] = dict(bounds) if bounds else None
        logger.info(f"Bounds query time = {time.time() - t0:.3f}s")

        # Get all buildings with their polygon locations
        t0 = time.time()
        cur.execute("""
            SELECT 
                buildingid,
                location::text as location,
                buildingtype::text as buildingtype,
                maxoccupancy
            FROM buildings
        """)
        results['buildings'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Buildings query time = {time.time() - t0:.3f}s, count = {len(results['buildings'])}")

        # Get all venue locations
        venues = {}

        # Apartments
        t0 = time.time()
        cur.execute("""
            SELECT 
                apartmentid as id,
                location[0] as x,
                location[1] as y,
                buildingid,
                rentalcost,
                maxoccupancy,
                numberofrooms
            FROM apartments
        """)
        venues['apartments'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Apartments query time = {time.time() - t0:.3f}s, count = {len(venues['apartments'])}")

        # Employers
        t0 = time.time()
        cur.execute("""
            SELECT 
                employerid as id,
                location[0] as x,
                location[1] as y,
                buildingid
            FROM employers
        """)
        venues['employers'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Employers query time = {time.time() - t0:.3f}s, count = {len(venues['employers'])}")

        # Pubs
        t0 = time.time()
        cur.execute("""
            SELECT 
                pubid as id,
                location[0] as x,
                location[1] as y,
                buildingid,
                hourlycost,
                maxoccupancy
            FROM pubs
        """)
        venues['pubs'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Pubs query time = {time.time() - t0:.3f}s, count = {len(venues['pubs'])}")

        # Restaurants
        t0 = time.time()
        cur.execute("""
            SELECT 
                restaurantid as id,
                location[0] as x,
                location[1] as y,
                buildingid,
                foodcost,
                maxoccupancy
            FROM restaurants
        """)
        venues['restaurants'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Restaurants query time = {time.time() - t0:.3f}s, count = {len(venues['restaurants'])}")

        # Schools
        t0 = time.time()
        cur.execute("""
            SELECT 
                schoolid as id,
                location[0] as x,
                location[1] as y,
                buildingid,
                monthlyfees,
                maxenrollment
            FROM schools
        """)
        venues['schools'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Schools query time = {time.time() - t0:.3f}s, count = {len(venues['schools'])}")

        results['venues'] = venues

        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)

    except Exception as e:
        logger.error("Error in /api/buildings-map", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


# Cache for flow map data
_flow_map_cache = {}

@app.route('/api/flow-map')
def flow_map():
    """
    Endpoint for animated flow map visualization showing OD (Origin-Destination) patterns.
    
    This endpoint:
    1. Uses pre-computed trip_coordinates materialized view (if available)
    2. Falls back to LATERAL join query if materialized view doesn't exist
    3. Bins coordinates into grid cells and aggregates flows by hour
    
    Parameters:
    - grid_size: Size of grid cells for spatial binning (default: 300)
    - day_type: 'all', 'weekday', 'weekend' (default: 'all')
    - purpose: 'all', 'Work/Home Commute', 'Eating', 'Recreation (Social Gathering)', etc. (default: 'all')
    - min_trips: Minimum trips to show a flow (default: 5)
    - start_date: Start date for filtering (YYYY-MM-DD, optional) - NOTE: currently not implemented due to MV structure
    - end_date: End date for filtering (YYYY-MM-DD, optional) - NOTE: currently not implemented due to MV structure
    """
    global _flow_map_cache
    
    grid_size = request.args.get('grid_size', 300, type=int)
    day_type = request.args.get('day_type', 'all', type=str)
    purpose = request.args.get('purpose', 'all', type=str)
    min_trips = request.args.get('min_trips', 5, type=int)
    start_date = request.args.get('start_date', None, type=str)
    end_date = request.args.get('end_date', None, type=str)
    
    # Note: Date filtering not yet implemented in MV queries, but we track the params
    cache_key = (grid_size, day_type, purpose, min_trips, start_date, end_date)
    if cache_key in _flow_map_cache:
        logger.info(f"Using cached flow map data for key={cache_key}")
        return jsonify(_flow_map_cache[cache_key])
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {
            'grid_size': grid_size,
            'day_type': day_type,
            'purpose': purpose,
            'min_trips': min_trips,
            'start_date': start_date,
            'end_date': end_date
        }
        
        # Get available date range from traveljournal
        t0 = time.time()
        cur.execute("""
            SELECT 
                MIN(travelstarttime::date) as min_date,
                MAX(travelstarttime::date) as max_date
            FROM traveljournal
        """)
        date_range = cur.fetchone()
        results['available_dates'] = {
            'min': str(date_range['min_date']) if date_range['min_date'] else None,
            'max': str(date_range['max_date']) if date_range['max_date'] else None
        }
        logger.info(f"Date range query time = {time.time() - t0:.3f}s")
        
        # If no date range specified, return just metadata (fast path for initial load)
        # This prevents expensive full-table scans on first page load
        if not start_date and not end_date:
            logger.info("No date range specified - returning metadata only (fast path)")
            # Get city bounds from buildings
            t0 = time.time()
            cur.execute("""
                SELECT 
                    MIN(location[0]) as min_x, MAX(location[0]) as max_x,
                    MIN(location[1]) as min_y, MAX(location[1]) as max_y
                FROM apartments
            """)
            bounds = cur.fetchone()
            results['bounds'] = {
                'min_x': bounds['min_x'],
                'max_x': bounds['max_x'],
                'min_y': bounds['min_y'],
                'max_y': bounds['max_y']
            }
            logger.info(f"Bounds query time = {time.time() - t0:.3f}s")
            
            # Get purpose options
            cur.execute("SELECT DISTINCT purpose::text as purpose FROM traveljournal ORDER BY purpose")
            results['purposes'] = [{'purpose': row['purpose']} for row in cur.fetchall()]
            
            # Return empty flows/cells for initial load
            results['flows'] = []
            results['cells'] = []
            results['buildings'] = []
            results['statistics'] = {
                'total_flows': 0,
                'total_trips': 0,
                'max_trips': 0
            }
            
            cur.close()
            return_db_connection(conn)
            return jsonify(results)
        
        # Get city bounds from buildings
        t0 = time.time()
        cur.execute("""
            SELECT 
                MIN(location[0]) as min_x, MAX(location[0]) as max_x,
                MIN(location[1]) as min_y, MAX(location[1]) as max_y
            FROM apartments
        """)
        bounds = cur.fetchone()
        logger.info(f"Bounds query time = {time.time() - t0:.3f}s")
        
        results['bounds'] = {
            'min_x': bounds['min_x'],
            'max_x': bounds['max_x'],
            'min_y': bounds['min_y'],
            'max_y': bounds['max_y']
        }
        
        # Check if materialized view exists
        t0 = time.time()
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM pg_matviews WHERE matviewname = 'trip_coordinates'
            ) as mv_exists
        """)
        mv_exists = cur.fetchone()['mv_exists']
        logger.info(f"MV check time = {time.time() - t0:.3f}s, exists = {mv_exists}")
        
        # Check if trip_date column exists in MV
        mv_has_date = False
        if mv_exists:
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM pg_attribute a
                    JOIN pg_class c ON a.attrelid = c.oid
                    JOIN pg_namespace n ON c.relnamespace = n.oid
                    WHERE n.nspname = 'public'
                      AND c.relname = 'trip_coordinates'
                      AND a.attname = 'trip_date'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                ) as has_date
            """)
            mv_has_date = cur.fetchone()['has_date']
            logger.info(f"MV has trip_date column: {mv_has_date}")
        
        # Build day filter
        if day_type == 'weekday':
            day_clause = "AND day_of_week BETWEEN 1 AND 5"
        elif day_type == 'weekend':
            day_clause = "AND day_of_week IN (0, 6)"
        else:
            day_clause = ""
        
        # Build purpose filter
        if purpose != 'all':
            purpose_clause = f"AND purpose = '{purpose}'"
        else:
            purpose_clause = ""
        
        # Build date range filter (only if MV has trip_date column)
        date_clause = ""
        if mv_has_date:
            if start_date:
                date_clause += f" AND trip_date >= '{start_date}'::date"
            if end_date:
                date_clause += f" AND trip_date <= '{end_date}'::date"
        else:
            # Log a warning if date filtering was requested but not available
            if start_date or end_date:
                logger.warning("Date filtering requested but trip_date column not in MV. Run setup.sh to recreate MV with date support.")
        
        if mv_exists:
            # Use fast materialized view query
            flows_query = f"""
                WITH gridded_trips AS (
                    SELECT 
                        hour_bucket,
                        purpose,
                        FLOOR(start_x / {grid_size})::int as start_cell_x,
                        FLOOR(start_y / {grid_size})::int as start_cell_y,
                        FLOOR(end_x / {grid_size})::int as end_cell_x,
                        FLOOR(end_y / {grid_size})::int as end_cell_y,
                        (FLOOR(start_x / {grid_size}) * {grid_size} + {grid_size}/2) as start_centroid_x,
                        (FLOOR(start_y / {grid_size}) * {grid_size} + {grid_size}/2) as start_centroid_y,
                        (FLOOR(end_x / {grid_size}) * {grid_size} + {grid_size}/2) as end_centroid_x,
                        (FLOOR(end_y / {grid_size}) * {grid_size} + {grid_size}/2) as end_centroid_y,
                        travel_time_minutes
                    FROM trip_coordinates
                    WHERE start_x IS NOT NULL AND end_x IS NOT NULL
                      AND start_y IS NOT NULL AND end_y IS NOT NULL
                      AND NOT (FLOOR(start_x / {grid_size}) = FLOOR(end_x / {grid_size})
                           AND FLOOR(start_y / {grid_size}) = FLOOR(end_y / {grid_size}))
                      {day_clause} {purpose_clause} {date_clause}
                )
                SELECT 
                    hour_bucket,
                    start_cell_x,
                    start_cell_y,
                    end_cell_x,
                    end_cell_y,
                    MIN(start_centroid_x) as start_x,
                    MIN(start_centroid_y) as start_y,
                    MIN(end_centroid_x) as end_x,
                    MIN(end_centroid_y) as end_y,
                    COUNT(*) as trips,
                    AVG(travel_time_minutes) as avg_travel_time,
                    COUNT(*) FILTER (WHERE purpose = 'Work/Home Commute') as commute_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Eating') as eating_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Recreation (Social Gathering)') as recreation_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Going Back to Home') as home_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Coming Back From Restaurant') as from_restaurant_trips
                FROM gridded_trips
                GROUP BY hour_bucket, start_cell_x, start_cell_y, end_cell_x, end_cell_y
                HAVING COUNT(*) >= {min_trips}
                ORDER BY hour_bucket, trips DESC
            """
            
            cells_query = f"""
                WITH origins AS (
                    SELECT 
                        hour_bucket,
                        FLOOR(start_x / {grid_size})::int as cell_x,
                        FLOOR(start_y / {grid_size})::int as cell_y,
                        (FLOOR(start_x / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_x,
                        (FLOOR(start_y / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_y,
                        COUNT(*) as departures
                    FROM trip_coordinates
                    WHERE start_x IS NOT NULL AND start_y IS NOT NULL
                      {day_clause} {purpose_clause} {date_clause}
                    GROUP BY hour_bucket, FLOOR(start_x / {grid_size}), FLOOR(start_y / {grid_size})
                ),
                destinations AS (
                    SELECT 
                        hour_bucket,
                        FLOOR(end_x / {grid_size})::int as cell_x,
                        FLOOR(end_y / {grid_size})::int as cell_y,
                        (FLOOR(end_x / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_x,
                        (FLOOR(end_y / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_y,
                        COUNT(*) as arrivals
                    FROM trip_coordinates
                    WHERE end_x IS NOT NULL AND end_y IS NOT NULL
                      {day_clause} {purpose_clause} {date_clause}
                    GROUP BY hour_bucket, FLOOR(end_x / {grid_size}), FLOOR(end_y / {grid_size})
                )
                SELECT 
                    COALESCE(o.hour_bucket, d.hour_bucket) as hour_bucket,
                    COALESCE(o.cell_x, d.cell_x) as cell_x,
                    COALESCE(o.cell_y, d.cell_y) as cell_y,
                    COALESCE(o.centroid_x, d.centroid_x) as x,
                    COALESCE(o.centroid_y, d.centroid_y) as y,
                    COALESCE(o.departures, 0) as departures,
                    COALESCE(d.arrivals, 0) as arrivals,
                    COALESCE(d.arrivals, 0) - COALESCE(o.departures, 0) as net_flow
                FROM origins o
                FULL OUTER JOIN destinations d 
                    ON o.hour_bucket = d.hour_bucket 
                    AND o.cell_x = d.cell_x 
                    AND o.cell_y = d.cell_y
                ORDER BY hour_bucket, (COALESCE(o.departures, 0) + COALESCE(d.arrivals, 0)) DESC
            """
        else:
            # Fallback: Use LATERAL join (much faster than correlated subqueries)
            day_clause_tj = day_clause.replace("day_of_week", "EXTRACT(DOW FROM t.travelstarttime)::int")
            purpose_clause_tj = purpose_clause.replace("purpose", "t.purpose::text")
            date_clause_tj = ""
            if start_date:
                date_clause_tj += f" AND t.travelstarttime::date >= '{start_date}'::date"
            if end_date:
                date_clause_tj += f" AND t.travelstarttime::date <= '{end_date}'::date"
            
            flows_query = f"""
                WITH trip_coords AS (
                    SELECT 
                        t.travelid,
                        t.purpose::text as purpose,
                        EXTRACT(HOUR FROM t.travelstarttime)::int as hour_bucket,
                        EXTRACT(DOW FROM t.travelstarttime)::int as day_of_week,
                        start_loc.currentlocation[0] as start_x,
                        start_loc.currentlocation[1] as start_y,
                        end_loc.currentlocation[0] as end_x,
                        end_loc.currentlocation[1] as end_y,
                        EXTRACT(EPOCH FROM (t.travelendtime - t.travelstarttime))/60 as travel_time_minutes
                    FROM traveljournal t
                    LEFT JOIN LATERAL (
                        SELECT currentlocation
                        FROM participantstatuslogs psl
                        WHERE psl.participantid = t.participantid 
                          AND psl.timestamp <= t.travelstarttime
                          AND psl.currentlocation IS NOT NULL
                        ORDER BY psl.timestamp DESC
                        LIMIT 1
                    ) start_loc ON true
                    LEFT JOIN LATERAL (
                        SELECT currentlocation
                        FROM participantstatuslogs psl
                        WHERE psl.participantid = t.participantid 
                          AND psl.timestamp >= t.travelendtime
                          AND psl.currentlocation IS NOT NULL
                        ORDER BY psl.timestamp ASC
                        LIMIT 1
                    ) end_loc ON true
                    WHERE 1=1 {day_clause_tj} {purpose_clause_tj} {date_clause_tj}
                ),
                gridded_trips AS (
                    SELECT 
                        hour_bucket,
                        purpose,
                        FLOOR(start_x / {grid_size})::int as start_cell_x,
                        FLOOR(start_y / {grid_size})::int as start_cell_y,
                        FLOOR(end_x / {grid_size})::int as end_cell_x,
                        FLOOR(end_y / {grid_size})::int as end_cell_y,
                        (FLOOR(start_x / {grid_size}) * {grid_size} + {grid_size}/2) as start_centroid_x,
                        (FLOOR(start_y / {grid_size}) * {grid_size} + {grid_size}/2) as start_centroid_y,
                        (FLOOR(end_x / {grid_size}) * {grid_size} + {grid_size}/2) as end_centroid_x,
                        (FLOOR(end_y / {grid_size}) * {grid_size} + {grid_size}/2) as end_centroid_y,
                        travel_time_minutes
                    FROM trip_coords
                    WHERE start_x IS NOT NULL AND end_x IS NOT NULL
                      AND start_y IS NOT NULL AND end_y IS NOT NULL
                      AND NOT (FLOOR(start_x / {grid_size}) = FLOOR(end_x / {grid_size})
                           AND FLOOR(start_y / {grid_size}) = FLOOR(end_y / {grid_size}))
                )
                SELECT 
                    hour_bucket,
                    start_cell_x,
                    start_cell_y,
                    end_cell_x,
                    end_cell_y,
                    MIN(start_centroid_x) as start_x,
                    MIN(start_centroid_y) as start_y,
                    MIN(end_centroid_x) as end_x,
                    MIN(end_centroid_y) as end_y,
                    COUNT(*) as trips,
                    AVG(travel_time_minutes) as avg_travel_time,
                    COUNT(*) FILTER (WHERE purpose = 'Work/Home Commute') as commute_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Eating') as eating_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Recreation (Social Gathering)') as recreation_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Going Back to Home') as home_trips,
                    COUNT(*) FILTER (WHERE purpose = 'Coming Back From Restaurant') as from_restaurant_trips
                FROM gridded_trips
                GROUP BY hour_bucket, start_cell_x, start_cell_y, end_cell_x, end_cell_y
                HAVING COUNT(*) >= {min_trips}
                ORDER BY hour_bucket, trips DESC
            """
            
            cells_query = f"""
                WITH trip_coords AS (
                    SELECT 
                        EXTRACT(HOUR FROM t.travelstarttime)::int as hour_bucket,
                        start_loc.currentlocation[0] as start_x,
                        start_loc.currentlocation[1] as start_y,
                        end_loc.currentlocation[0] as end_x,
                        end_loc.currentlocation[1] as end_y
                    FROM traveljournal t
                    LEFT JOIN LATERAL (
                        SELECT currentlocation
                        FROM participantstatuslogs psl
                        WHERE psl.participantid = t.participantid 
                          AND psl.timestamp <= t.travelstarttime
                          AND psl.currentlocation IS NOT NULL
                        ORDER BY psl.timestamp DESC
                        LIMIT 1
                    ) start_loc ON true
                    LEFT JOIN LATERAL (
                        SELECT currentlocation
                        FROM participantstatuslogs psl
                        WHERE psl.participantid = t.participantid 
                          AND psl.timestamp >= t.travelendtime
                          AND psl.currentlocation IS NOT NULL
                        ORDER BY psl.timestamp ASC
                        LIMIT 1
                    ) end_loc ON true
                    WHERE 1=1 {day_clause_tj} {purpose_clause_tj} {date_clause_tj}
                ),
                origins AS (
                    SELECT 
                        hour_bucket,
                        FLOOR(start_x / {grid_size})::int as cell_x,
                        FLOOR(start_y / {grid_size})::int as cell_y,
                        (FLOOR(start_x / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_x,
                        (FLOOR(start_y / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_y,
                        COUNT(*) as departures
                    FROM trip_coords
                    WHERE start_x IS NOT NULL AND start_y IS NOT NULL
                    GROUP BY hour_bucket, FLOOR(start_x / {grid_size}), FLOOR(start_y / {grid_size})
                ),
                destinations AS (
                    SELECT 
                        hour_bucket,
                        FLOOR(end_x / {grid_size})::int as cell_x,
                        FLOOR(end_y / {grid_size})::int as cell_y,
                        (FLOOR(end_x / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_x,
                        (FLOOR(end_y / {grid_size}) * {grid_size} + {grid_size}/2) as centroid_y,
                        COUNT(*) as arrivals
                    FROM trip_coords
                    WHERE end_x IS NOT NULL AND end_y IS NOT NULL
                    GROUP BY hour_bucket, FLOOR(end_x / {grid_size}), FLOOR(end_y / {grid_size})
                )
                SELECT 
                    COALESCE(o.hour_bucket, d.hour_bucket) as hour_bucket,
                    COALESCE(o.cell_x, d.cell_x) as cell_x,
                    COALESCE(o.cell_y, d.cell_y) as cell_y,
                    COALESCE(o.centroid_x, d.centroid_x) as x,
                    COALESCE(o.centroid_y, d.centroid_y) as y,
                    COALESCE(o.departures, 0) as departures,
                    COALESCE(d.arrivals, 0) as arrivals,
                    COALESCE(d.arrivals, 0) - COALESCE(o.departures, 0) as net_flow
                FROM origins o
                FULL OUTER JOIN destinations d 
                    ON o.hour_bucket = d.hour_bucket 
                    AND o.cell_x = d.cell_x 
                    AND o.cell_y = d.cell_y
                ORDER BY hour_bucket, (COALESCE(o.departures, 0) + COALESCE(d.arrivals, 0)) DESC
            """
        
        # Execute flows query
        t0 = time.time()
        cur.execute(flows_query)
        flows = [dict(row) for row in cur.fetchall()]
        logger.info(f"Flows query time = {time.time() - t0:.3f}s, flows = {len(flows)}")
        results['flows'] = flows
        
        # Calculate statistics
        if flows:
            all_trips = [f['trips'] for f in flows]
            results['statistics'] = {
                'total_flows': len(flows),
                'total_trips': sum(all_trips),
                'max_trips': max(all_trips),
                'avg_trips': sum(all_trips) / len(all_trips),
                'hours_covered': len(set(f['hour_bucket'] for f in flows))
            }
        else:
            results['statistics'] = {
                'total_flows': 0,
                'total_trips': 0,
                'max_trips': 0,
                'avg_trips': 0,
                'hours_covered': 0
            }
        
        # Execute cells query
        t0 = time.time()
        cur.execute(cells_query)
        cells = [dict(row) for row in cur.fetchall()]
        logger.info(f"Cells query time = {time.time() - t0:.3f}s, cells = {len(cells)}")
        results['cells'] = cells
        
        # Get buildings for base map context
        t0 = time.time()
        cur.execute("""
            SELECT 
                buildingid,
                location::text as location,
                buildingtype::text as buildingtype
            FROM buildings
        """)
        results['buildings'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Buildings query time = {time.time() - t0:.3f}s")
        
        # Get purpose options
        t0 = time.time()
        cur.execute("""
            SELECT DISTINCT purpose::text as purpose, COUNT(*) as count
            FROM traveljournal
            GROUP BY purpose
            ORDER BY count DESC
        """)
        results['purposes'] = [dict(row) for row in cur.fetchall()]
        logger.info(f"Purposes query time = {time.time() - t0:.3f}s")
        
        # Cache results
        _flow_map_cache[cache_key] = results
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/flow-map", exc_info=e)
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


# Cache for theme river data
_theme_river_cache = {}

@app.route('/api/theme-river')
def theme_river():
    """
    Endpoint for Theme River (Streamgraph) visualization showing temporal evolution of city behaviors.
    
    This endpoint aggregates participant status logs over time to show how different modes
    (AtHome, AtWork, AtRecreation, AtRestaurant, Transport) evolve throughout the dataset period.
    
    Parameters:
    - granularity: 'daily', 'weekly', 'monthly' (default: 'weekly')
    - dimension: 'mode', 'purpose', 'spending' - which dimension to visualize (default: 'mode')
    - normalize: 'true' or 'false' - whether to normalize to percentages (default: 'false')
    - exclude_outliers: 'true' or 'false' - exclude participants with < 2000 records (default: 'false')
    """
    global _theme_river_cache
    
    granularity = request.args.get('granularity', 'weekly', type=str)
    dimension = request.args.get('dimension', 'mode', type=str)
    normalize = request.args.get('normalize', 'false', type=str).lower() == 'true'
    exclude_outliers = request.args.get('exclude_outliers', 'false', type=str).lower() == 'true'
    
    cache_key = (granularity, dimension, normalize, exclude_outliers)
    if cache_key in _theme_river_cache:
        logger.info(f"Using cached theme river data for key={cache_key}")
        return jsonify(_theme_river_cache[cache_key])
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Get outlier participants if needed
        outlier_filter = ""
        if exclude_outliers:
            outlier_pids = get_outlier_participants(cur)
            if outlier_pids:
                outlier_list = ','.join(str(pid) for pid in outlier_pids)
                outlier_filter = f"AND participantid NOT IN ({outlier_list})"
        
        results = {
            'granularity': granularity,
            'dimension': dimension,
            'normalize': normalize,
            'exclude_outliers': exclude_outliers
        }
        
        # Determine date truncation based on granularity
        if granularity == 'daily':
            date_trunc = "DATE(timestamp)"
        elif granularity == 'monthly':
            date_trunc = "DATE_TRUNC('month', timestamp)"
        else:  # weekly
            date_trunc = "DATE_TRUNC('week', timestamp)"
        
        t0 = time.time()
        
        if dimension == 'mode':
            # Participant modes over time from participantstatuslogs
            cur.execute(f"""
                SELECT 
                    {date_trunc} as period,
                    currentmode::text as category,
                    COUNT(*) as value
                FROM participantstatuslogs
                WHERE currentmode IS NOT NULL {outlier_filter}
                GROUP BY {date_trunc}, currentmode
                ORDER BY period, category
            """)
            data = cur.fetchall()
            logger.info(f"Mode data query time = {time.time() - t0:.3f}s, rows = {len(data)}")
            
        elif dimension == 'purpose':
            # Travel purposes over time from traveljournal
            t0 = time.time()
            cur.execute(f"""
                SELECT 
                    DATE_TRUNC('day', travelstarttime) as day,
                    purpose::text as category,
                    COUNT(*) as value
                FROM traveljournal
                WHERE purpose IS NOT NULL {outlier_filter}
                GROUP BY DATE_TRUNC('day', travelstarttime), purpose
            """)
            daily_data = cur.fetchall()
            logger.info(f"Purpose daily data query time = {time.time() - t0:.3f}s, rows = {len(daily_data)}")
            
            # Aggregate to desired granularity
            aggregated = defaultdict(lambda: defaultdict(int))
            
            for row in daily_data:
                day = row['day']
                if granularity == 'daily':
                    period = day
                elif granularity == 'monthly':
                    period = day.replace(day=1)
                else:  # weekly
                    period = day - timedelta(days=day.weekday())
                
                aggregated[period][row['category']] += row['value']
            
            data = []
            for period in sorted(aggregated.keys()):
                for category, value in aggregated[period].items():
                    data.append({
                        'period': period,
                        'category': category,
                        'value': value
                    })
                    
        elif dimension == 'spending':
            # Spending categories over time from financialjournal
            # Note: We get per-period spending (not cumulative) by using GROUP BY
            t0 = time.time()
            cur.execute(f"""
                SELECT 
                    {date_trunc} as period,
                    category::text as category,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as value
                FROM financialjournal
                WHERE category IS NOT NULL AND category != 'Wage' {outlier_filter}
                GROUP BY {date_trunc}, category
                HAVING SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) > 0
                ORDER BY period, category
            """)
            data = cur.fetchall()
            logger.info(f"Spending data query time = {time.time() - t0:.3f}s, rows = {len(data)}")
            
            # Debug: log first few rows to verify non-cumulative data
            if len(data) > 0:
                logger.info(f"Spending sample data (first 5 rows): {[dict(row) for row in data[:5]]}")
        else:
            return jsonify({"error": f"Invalid dimension: {dimension}"}), 400
        
        # Get date range
        t0 = time.time()
        if dimension == 'purpose':
            cur.execute("""
                SELECT 
                    MIN(travelstarttime::date) as min_date,
                    MAX(travelstarttime::date) as max_date
                FROM traveljournal
            """)
        elif dimension == 'spending':
            cur.execute("""
                SELECT 
                    MIN(timestamp::date) as min_date,
                    MAX(timestamp::date) as max_date
                FROM financialjournal
            """)
        else:  # mode
            cur.execute("""
                SELECT 
                    MIN(timestamp::date) as min_date,
                    MAX(timestamp::date) as max_date
                FROM participantstatuslogs
            """)
        date_range = cur.fetchone()
        logger.info(f"Date range query time = {time.time() - t0:.3f}s")
        
        results['date_range'] = {
            'start': str(date_range['min_date']) if date_range['min_date'] else None,
            'end': str(date_range['max_date']) if date_range['max_date'] else None
        }
        
        # Process data into streamgraph format
        # Group by period
        periods_dict = defaultdict(dict)
        categories = set()
        
        for row in data:
            period_str = str(row['period'].date()) if hasattr(row['period'], 'date') else str(row['period'])
            category = row['category']
            # Skip NULL categories
            if category is None:
                continue
            value = float(row['value'])
            
            periods_dict[period_str][category] = value
            categories.add(category)
        
        # Sort periods chronologically
        sorted_periods = sorted(periods_dict.keys())
        
        # Normalize if requested
        if normalize:
            for period in sorted_periods:
                total = sum(periods_dict[period].values())
                if total > 0:
                    for category in periods_dict[period]:
                        periods_dict[period][category] = (periods_dict[period][category] / total) * 100
        
        # Build output arrays
        results['periods'] = sorted_periods
        results['categories'] = sorted(list(categories))
        results['data'] = []
        
        for period in sorted_periods:
            period_data = {'period': period}
            for category in results['categories']:
                period_data[category] = periods_dict[period].get(category, 0)
            results['data'].append(period_data)
        
        # Calculate significant changes (comparing first month to last month)
        if len(results['data']) > 4:  # Need at least a few data points
            t0 = time.time()
            
            # Take first and last ~month of data for comparison
            points_per_period = {'daily': 30, 'weekly': 4, 'monthly': 1}
            n = points_per_period.get(granularity, 4)
            
            first_periods = results['data'][:n]
            last_periods = results['data'][-n:]
            
            # Calculate averages
            first_avg = defaultdict(float)
            last_avg = defaultdict(float)
            
            for period_data in first_periods:
                for cat in results['categories']:
                    first_avg[cat] += period_data[cat]
            
            for period_data in last_periods:
                for cat in results['categories']:
                    last_avg[cat] += period_data[cat]
            
            for cat in results['categories']:
                first_avg[cat] /= len(first_periods)
                last_avg[cat] /= len(last_periods)
            
            # Calculate changes
            changes = []
            for cat in results['categories']:
                if first_avg[cat] > 0:
                    pct_change = ((last_avg[cat] - first_avg[cat]) / first_avg[cat]) * 100
                    abs_change = last_avg[cat] - first_avg[cat]
                    changes.append({
                        'category': cat,
                        'first_avg': round(first_avg[cat], 2),
                        'last_avg': round(last_avg[cat], 2),
                        'abs_change': round(abs_change, 2),
                        'pct_change': round(pct_change, 2)
                    })
            
            # Sort by absolute percentage change
            changes.sort(key=lambda x: abs(x['pct_change']), reverse=True)
            results['significant_changes'] = changes[:10]
            
            logger.info(f"Change analysis time = {time.time() - t0:.3f}s")
        
        # Cache results
        _theme_river_cache[cache_key] = results
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        logger.error("Error in /api/theme-river", exc_info=e)
        try:
            cur.close()
            return_db_connection(conn)
        except:
            pass
        return jsonify({"error": str(e)}), 500


@app.route('/api/parallel-coordinates', methods=['GET'])
def get_parallel_coordinates():
    """
    Get activity counts by participant for parallel coordinates visualization.
    Returns counts for different activity types (venue types) for each participant.
    
    Parameters:
    - exclude_outliers: 'true' or 'false' - exclude participants with < 2000 records (default: 'false')
    """
    exclude_outliers = request.args.get('exclude_outliers', 'false', type=str).lower() == 'true'
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Get outlier participants if needed
        outlier_filter = ""
        if exclude_outliers:
            outlier_pids = get_outlier_participants(cur)
            if outlier_pids:
                outlier_list = ','.join(str(pid) for pid in outlier_pids)
                outlier_filter = f"WHERE p.participantid NOT IN ({outlier_list})"
        
        t0 = time.time()
        logger.info(f"Querying parallel coordinates data... (exclude_outliers={exclude_outliers})")
        
        # Query to get activity counts by participant for 5 main categories:
        # Categories explanation:
        # - work: Work-related activities (Workplace venue visits + Work/Home Commute travels)
        #         Represents professional activities and daily commuting patterns
        # - home: Time spent at home (Apartment venue visits)
        #         Indicates residential/domestic activities
        # - social: Social/recreational activities (Pub visits + Recreation travels)
        #           Represents leisure time and social gatherings
        # - food: Food-related activities (Restaurant visits + Eating-purpose travels)
        #         Indicates dining out and food consumption patterns
        # - travel: Total mobility (all travel journal entries)
        #           Represents overall movement and transportation activity
        cur.execute(f"""
            WITH venue_counts AS (
                SELECT 
                    participantid,
                    COUNT(*) FILTER (WHERE venuetype = 'Workplace') as workplace_visits,
                    COUNT(*) FILTER (WHERE venuetype = 'Apartment') as home_visits,
                    COUNT(*) FILTER (WHERE venuetype = 'Pub') as pub_visits,
                    COUNT(*) FILTER (WHERE venuetype = 'Restaurant') as restaurant_visits
                FROM checkinjournal
                WHERE venuetype IS NOT NULL
                GROUP BY participantid
            ),
            travel_counts AS (
                SELECT 
                    participantid,
                    COUNT(*) as total_travels,
                    COUNT(*) FILTER (WHERE purpose = 'Work/Home Commute') as work_travels,
                    COUNT(*) FILTER (WHERE purpose = 'Recreation (Social Gathering)') as recreation_travels,
                    COUNT(*) FILTER (WHERE purpose = 'Eating') as eating_travels
                FROM traveljournal
                GROUP BY participantid
            )
            SELECT 
                p.participantid,
                COALESCE(vc.workplace_visits, 0) + COALESCE(tc.work_travels, 0) as work,
                COALESCE(vc.home_visits, 0) as home,
                COALESCE(vc.pub_visits, 0) + COALESCE(tc.recreation_travels, 0) as social,
                COALESCE(vc.restaurant_visits, 0) + COALESCE(tc.eating_travels, 0) as food,
                COALESCE(tc.total_travels, 0) as travel
            FROM participants p
            LEFT JOIN venue_counts vc ON p.participantid = vc.participantid
            LEFT JOIN travel_counts tc ON p.participantid = tc.participantid
            {outlier_filter}
            ORDER BY p.participantid
        """)
        
        rows = cur.fetchall()
        logger.info(f"Parallel coordinates query time = {time.time() - t0:.3f}s, rows = {len(rows)}")
        
        participants = [dict(row) for row in rows]
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify({
            'participants': participants,
            'exclude_outliers': exclude_outliers
        })
    
    except Exception as e:
        logger.error("Error in /api/parallel-coordinates", exc_info=e)
        try:
            cur.close()
            return_db_connection(conn)
        except:
            pass
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    logger.info("Starting Flask server on 0.0.0.0:5000 ...")
    app.run(host='0.0.0.0', port=5000)