import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
import time
import logging
from flask import Flask, jsonify, request
from flask_cors import CORS

# Configure logging
logging.basicConfig(level=logging.INFO)
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

def get_db_connection():
    """Get a connection from the pool."""
    pool = get_connection_pool()
    conn = pool.getconn()
    return conn

def return_db_connection(conn):
    """Return a connection to the pool."""
    pool = get_connection_pool()
    pool.putconn(conn)

def get_participant_locations(cur):
    """
    Get participant locations efficiently using LATERAL join.
    Results are cached in memory for subsequent requests.
    """
    global _participant_locations_cache
    
    if _participant_locations_cache is not None:
        return _participant_locations_cache
    
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
    return _participant_locations_cache


def get_venue_locations(cur):
    """Get all venue locations, cached."""
    global _venue_locations_cache
    
    if _venue_locations_cache is not None:
        return _venue_locations_cache
    
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
    return _venue_locations_cache


def get_traffic_aggregation_sql(cur, grid_size, time_period, day_type):
    """Get pre-aggregated traffic data using SQL - much faster than loading all rows."""
    global _traffic_sql_cache
    
    cache_key = (grid_size, time_period, day_type)
    if cache_key in _traffic_sql_cache:
        return _traffic_sql_cache[cache_key]
    
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
    
    # Cache the result
    _traffic_sql_cache[cache_key] = traffic_data
    return traffic_data


def get_hourly_pattern(cur):
    """Get hourly pattern, cached."""
    global _hourly_pattern_cache
    
    if _hourly_pattern_cache is not None:
        return _hourly_pattern_cache
    
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
    return _hourly_pattern_cache


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
    """
    grid_size = request.args.get('grid_size', 500, type=int)
    metric = request.args.get('metric', 'all', type=str)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {}
        
        # Get city bounds from apartments (fast query)
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
        results['grid_size'] = grid_size
        
        # Get cached participant locations for demographics and financial queries
        if metric in ['demographics', 'financial', 'all']:
            participant_data = get_participant_locations(cur)
        
        if metric in ['demographics', 'all']:
            # Aggregate in Python - much faster than SQL on 113M rows
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
        
        if metric in ['financial', 'all']:
            # Build participant to grid mapping
            participant_grid = {}
            for p in participant_data:
                gx = int(p['x'] // grid_size)
                gy = int(p['y'] // grid_size)
                participant_grid[p['participantid']] = (gx, gy)
            
            # Get financial data aggregated by participant (fast - only 1.8M rows)
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
            
            # Aggregate by grid
            grid_finances = {}
            for row in cur.fetchall():
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
        
        if metric in ['venues', 'all']:
            # Count venues by type in each grid cell (fast - small tables)
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
        
        if metric in ['apartments', 'all']:
            # Aggregate apartment/building data by area (fast - small table)
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
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


@app.route('/api/traffic-patterns')
def traffic_patterns():
    """
    Parametrized endpoint to identify busiest areas and traffic bottlenecks.
    
    Parameters:
    - grid_size: Size of the grid cells (default: 500)
    - time_period: 'all', 'morning' (6-10), 'midday' (10-14), 'afternoon' (14-18), 'evening' (18-22), 'night' (22-6) (default: 'all')
    - day_type: 'all', 'weekday', 'weekend' (default: 'all')
    - metric: 'visits', 'unique_visitors', 'avg_duration', 'all' (default: 'all')
    """
    grid_size = request.args.get('grid_size', 500, type=int)
    time_period = request.args.get('time_period', 'all', type=str)
    day_type = request.args.get('day_type', 'all', type=str)
    metric = request.args.get('metric', 'all', type=str)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {}
        
        # Get city bounds from apartments (fast, small table)
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
        results['grid_size'] = grid_size
        results['time_period'] = time_period
        results['day_type'] = day_type
        
        # Get pre-aggregated traffic data using SQL (much faster, no memory issues)
        traffic_data = get_traffic_aggregation_sql(cur, grid_size, time_period, day_type)
        results['traffic'] = traffic_data
        
        # Calculate statistics for bottleneck detection
        if traffic_data:
            visits = [row['total_visits'] for row in traffic_data]
            results['statistics'] = {
                'total_cells': len(traffic_data),
                'total_visits': sum(visits),
                'max_visits': max(visits),
                'avg_visits': sum(visits) / len(visits),
                'median_visits': sorted(visits)[len(visits) // 2],
                'p90_visits': sorted(visits)[int(len(visits) * 0.9)] if len(visits) >= 10 else max(visits),
                'p95_visits': sorted(visits)[int(len(visits) * 0.95)] if len(visits) >= 20 else max(visits)
            }
        
        # Get cached hourly pattern
        if metric in ['hourly', 'all']:
            results['hourly_pattern'] = get_hourly_pattern(cur)
        
        results['flows'] = []
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
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
    """
    global _participants_cache
    
    participant_ids_str = request.args.get('participant_ids', '', type=str)
    date_param = request.args.get('date', 'typical', type=str)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {}
        
        # Get list of all participants with their characteristics (cached)
        if _participants_cache is None:
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
        
        results['participants'] = _participants_cache
        
        # If no specific participants requested, return basic list for selection
        if not participant_ids_str:
            # Return summary based on checkinjournal (much faster than participantstatuslogs)
            cur.execute("""
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
        routines = {}
        
        for pid in participant_ids:
            # Get participant info
            participant_info = next((p for p in _participants_cache if p['participantid'] == pid), None)
            
            # Use checkinjournal for typical pattern (much faster than participantstatuslogs)
            cur.execute("""
                SELECT 
                    EXTRACT(HOUR FROM timestamp)::int as hour,
                    venuetype::text as activity,
                    COUNT(*) as count
                FROM checkinjournal
                WHERE participantid = %s
                GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                ORDER BY hour, count DESC
            """, (pid,))
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
            
            routines[pid] = {
                'participant': participant_info,
                'type': 'typical',
                'timeline': timeline,
                'days_sampled': days_result['days'] if days_result else 0
            }
        
        # Get checkin data for these participants (venue visits)
        for pid in participant_ids:
            if date_param == 'typical':
                cur.execute("""
                    SELECT 
                        EXTRACT(HOUR FROM timestamp)::int as hour,
                        venuetype::text as venue_type,
                        COUNT(*) as visit_count
                    FROM checkinjournal
                    WHERE participantid = %s
                    GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                    ORDER BY hour
                """, (pid,))
            else:
                cur.execute("""
                    SELECT 
                        EXTRACT(HOUR FROM timestamp)::int as hour,
                        venuetype::text as venue_type,
                        COUNT(*) as visit_count
                    FROM checkinjournal
                    WHERE participantid = %s AND DATE(timestamp) = %s
                    GROUP BY EXTRACT(HOUR FROM timestamp), venuetype
                    ORDER BY hour
                """, (pid, date_param))
            
            checkins = [dict(row) for row in cur.fetchall()]
            if pid in routines:
                routines[pid]['checkins'] = checkins
        
        results['routines'] = routines
        results['selected_ids'] = participant_ids
        
        cur.close()
        return_db_connection(conn)
        
        return jsonify(results)
    
    except Exception as e:
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
    """
    global _temporal_patterns_cache
    
    granularity = request.args.get('granularity', 'weekly', type=str)
    metric = request.args.get('metric', 'all', type=str)
    venue_type = request.args.get('venue_type', 'all', type=str)
    
    cache_key = (granularity, metric, venue_type)
    if cache_key in _temporal_patterns_cache:
        return jsonify(_temporal_patterns_cache[cache_key])
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        results = {
            'granularity': granularity,
            'metric': metric,
            'venue_type': venue_type
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
        cur.execute("""
            SELECT MIN(timestamp)::date as min_date, MAX(timestamp)::date as max_date
            FROM checkinjournal
        """)
        date_range = cur.fetchone()
        results['date_range'] = {
            'start': str(date_range['min_date']),
            'end': str(date_range['max_date'])
        }
        
        # Activity patterns over time
        if metric in ['activity', 'all']:
            venue_filter = ""
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
                {venue_filter}
                GROUP BY {date_trunc}
                ORDER BY period
            """)
            activity_data = cur.fetchall()
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
                GROUP BY {date_trunc_fin}
                ORDER BY period
            """)
            spending_data = cur.fetchall()
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
            cur.execute(f"""
                SELECT 
                    {date_trunc} as period,
                    COUNT(*) as interactions,
                    COUNT(DISTINCT participantidfrom) as active_initiators,
                    COUNT(DISTINCT participantidto) as contacted_people,
                    COUNT(DISTINCT participantidfrom) + COUNT(DISTINCT participantidto) as total_social_participants
                FROM socialnetwork
                GROUP BY {date_trunc}
                ORDER BY period
            """)
            social_data = cur.fetchall()
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
        cur.close()
        return_db_connection(conn)
        return jsonify({"error": str(e)}), 500


        conn.close()


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

        # Get city bounds from apartments (covers the same area as buildings)
        t0 = time.time()
        cur.execute("""
            SELECT 
                MIN(location[0]) as min_x, MAX(location[0]) as max_x,
                MIN(location[1]) as min_y, MAX(location[1]) as max_y
            FROM apartments
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)