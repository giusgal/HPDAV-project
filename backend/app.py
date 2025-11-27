import os
import psycopg2
import psycopg2.extras
import time
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Cache for participant locations (computed once)
_participant_locations_cache = None
# Cache for venue locations
_venue_locations_cache = None
# Cache for checkin data with locations
_checkin_data_cache = None
# Cache for hourly patterns
_hourly_pattern_cache = None
# Cache for flow data by grid size
_flow_data_cache = {}

def get_db_connection():
    conn = psycopg2.connect(
        host="db",
        database="hpdavDB",
        user="myuser",
        password="mypassword"
    )
    return conn

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


def get_checkin_data(cur):
    """Get all checkin data with timestamps and venue info, cached."""
    global _checkin_data_cache
    
    if _checkin_data_cache is not None:
        return _checkin_data_cache
    
    venue_locs = get_venue_locations(cur)
    
    # Fetch checkins without JOIN - much faster
    cur.execute("""
        SELECT participantid, timestamp, venueid, venuetype::text as venuetype
        FROM checkinjournal
    """)
    
    # Add location info in Python
    _checkin_data_cache = []
    for row in cur.fetchall():
        key = (row['venueid'], row['venuetype'])
        if key in venue_locs:
            x, y = venue_locs[key]
            _checkin_data_cache.append({
                'participantid': row['participantid'],
                'timestamp': row['timestamp'],
                'venuetype': row['venuetype'],
                'x': x,
                'y': y,
                'hour': row['timestamp'].hour,
                'dow': row['timestamp'].weekday()  # 0=Monday, 6=Sunday
            })
    
    return _checkin_data_cache


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
    _hourly_pattern_cache = cur.fetchall()
    return _hourly_pattern_cache


# Pre-aggregated traffic cache: key = (grid_size, time_period, day_type)
_traffic_cache = {}

def get_traffic_aggregation(cur, grid_size, time_period, day_type):
    """Get pre-aggregated traffic data, cached by parameters."""
    global _traffic_cache
    
    cache_key = (grid_size, time_period, day_type)
    if cache_key in _traffic_cache:
        return _traffic_cache[cache_key]
    
    # Get checkin data (cached)
    checkin_data = get_checkin_data(cur)
    
    # Apply filters
    filtered_data = checkin_data
    
    if time_period == 'morning':
        filtered_data = [c for c in filtered_data if 6 <= c['hour'] < 10]
    elif time_period == 'midday':
        filtered_data = [c for c in filtered_data if 10 <= c['hour'] < 14]
    elif time_period == 'afternoon':
        filtered_data = [c for c in filtered_data if 14 <= c['hour'] < 18]
    elif time_period == 'evening':
        filtered_data = [c for c in filtered_data if 18 <= c['hour'] < 22]
    elif time_period == 'night':
        filtered_data = [c for c in filtered_data if c['hour'] >= 22 or c['hour'] < 6]
    
    if day_type == 'weekday':
        filtered_data = [c for c in filtered_data if c['dow'] < 5]
    elif day_type == 'weekend':
        filtered_data = [c for c in filtered_data if c['dow'] >= 5]
    
    # Aggregate by grid cell
    grid_data = {}
    for c in filtered_data:
        gx = int(c['x'] // grid_size)
        gy = int(c['y'] // grid_size)
        key = (gx, gy)
        
        if key not in grid_data:
            grid_data[key] = {
                'grid_x': gx,
                'grid_y': gy,
                'total_visits': 0,
                'participants': set(),
                'restaurant_visits': 0,
                'pub_visits': 0,
                'home_visits': 0,
                'work_visits': 0,
                'school_visits': 0,
                'cell_x': c['x'],
                'cell_y': c['y']
            }
        
        grid_data[key]['total_visits'] += 1
        grid_data[key]['participants'].add(c['participantid'])
        
        vt = c['venuetype']
        if vt == 'Restaurant':
            grid_data[key]['restaurant_visits'] += 1
        elif vt == 'Pub':
            grid_data[key]['pub_visits'] += 1
        elif vt == 'Apartment':
            grid_data[key]['home_visits'] += 1
        elif vt == 'Workplace':
            grid_data[key]['work_visits'] += 1
        elif vt == 'School':
            grid_data[key]['school_visits'] += 1
    
    # Convert to list
    traffic_data = []
    for key, data in grid_data.items():
        traffic_data.append({
            'grid_x': data['grid_x'],
            'grid_y': data['grid_y'],
            'total_visits': data['total_visits'],
            'unique_visitors': len(data['participants']),
            'restaurant_visits': data['restaurant_visits'],
            'pub_visits': data['pub_visits'],
            'home_visits': data['home_visits'],
            'work_visits': data['work_visits'],
            'school_visits': data['school_visits'],
            'cell_x': data['cell_x'],
            'cell_y': data['cell_y']
        })
    
    traffic_data.sort(key=lambda x: x['total_visits'], reverse=True)
    
    # Cache the result
    _traffic_cache[cache_key] = traffic_data
    return traffic_data

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
            results['venues'] = cur.fetchall()
        
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
            results['apartments'] = cur.fetchall()
        
        cur.close()
        conn.close()
        
        return jsonify(results)
    
    except Exception as e:
        cur.close()
        conn.close()
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
        
        # Get pre-aggregated traffic data (cached)
        traffic_data = get_traffic_aggregation(cur, grid_size, time_period, day_type)
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
        conn.close()
        
        return jsonify(results)
    
    except Exception as e:
        cur.close()
        conn.close()
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)