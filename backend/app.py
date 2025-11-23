import os
import psycopg2
import time
from flask import Flask, jsonify, request
from psycopg2.extras import RealDictCursor
from datetime import datetime

app = Flask(__name__)

def get_db_connection():
    # Connect to the database using the service name "db"
    conn = psycopg2.connect(
        host="db",
        database="hpdavDB",
        user="myuser",
        password="mypassword"
    )
    return conn

def convert_point_to_dict(point_str):
    """Convert PostgreSQL point string to dict with x, y coordinates"""
    if not point_str:
        return None
    # Point format is (x,y)
    point_str = point_str.strip('()')
    coords = point_str.split(',')
    return {'x': float(coords[0]), 'y': float(coords[1])}

@app.route('/')
def index():
    return jsonify({
        "message": "VAST Challenge 2022 - Patterns of Life API",
        "endpoints": {
            "city_areas": "/api/city-areas",
            "building_density": "/api/building-density",
            "activity_heatmap": "/api/activity-heatmap",
            "traffic_bottlenecks": "/api/traffic-bottlenecks",
            "busiest_areas": "/api/busiest-areas",
            "travel_patterns": "/api/travel-patterns",
            "participant_routines": "/api/participant-routines/<participant_id>",
            "participant_list": "/api/participants",
            "temporal_patterns": "/api/temporal-patterns",
            "seasonal_changes": "/api/seasonal-changes",
            "daily_activity_trends": "/api/daily-activity-trends",
            "venue_popularity": "/api/venue-popularity"
        }
    })

# ========================================
# QUESTION 1: City Area Characterization
# ========================================

@app.route('/api/city-areas', methods=['GET'])
def get_city_areas():
    """
    Characterize distinct areas of the city based on building types and density.
    Returns buildings grouped by type with their locations.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            buildingType,
            buildingId,
            location,
            maxOccupancy,
            COUNT(*) OVER (PARTITION BY buildingType) as type_count
        FROM Buildings
        WHERE location IS NOT NULL
        ORDER BY buildingType, buildingId;
        """
        cur.execute(query)
        buildings = cur.fetchall()
        
        # Convert polygon locations to list of points
        result = []
        for building in buildings:
            building_dict = dict(building)
            if building_dict['location']:
                # Parse polygon format: ((x1,y1),(x2,y2),...)
                location_str = str(building_dict['location'])
                building_dict['location'] = location_str
            result.append(building_dict)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/building-density', methods=['GET'])
def get_building_density():
    """
    Analyze building density by type to identify distinct city areas.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            buildingType,
            COUNT(*) as building_count,
            AVG(maxOccupancy) as avg_occupancy,
            SUM(maxOccupancy) as total_capacity
        FROM Buildings
        GROUP BY buildingType
        ORDER BY building_count DESC;
        """
        cur.execute(query)
        density = cur.fetchall()
        return jsonify([dict(row) for row in density])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/activity-heatmap', methods=['GET'])
def get_activity_heatmap():
    """
    Get activity hotspots based on participant check-ins and movements.
    Optional query params: start_date, end_date (format: YYYY-MM-DD)
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    try:
        query = """
        SELECT 
            venueType,
            venueId,
            COUNT(*) as visit_count,
            COUNT(DISTINCT participantId) as unique_visitors,
            MIN(timestamp) as first_visit,
            MAX(timestamp) as last_visit
        FROM CheckinJournal
        WHERE 1=1
        """
        params = []
        
        if start_date:
            query += " AND timestamp >= %s"
            params.append(start_date)
        if end_date:
            query += " AND timestamp <= %s"
            params.append(end_date)
        
        query += """
        GROUP BY venueType, venueId
        ORDER BY visit_count DESC
        LIMIT 100;
        """
        
        cur.execute(query, params)
        heatmap = cur.fetchall()
        return jsonify([dict(row) for row in heatmap])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ========================================
# QUESTION 2: Traffic Bottlenecks
# ========================================

@app.route('/api/traffic-bottlenecks', methods=['GET'])
def get_traffic_bottlenecks():
    """
    Identify potential traffic bottlenecks based on travel patterns.
    Analyzes common routes and congestion points.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            travelStartLocationId as location_id,
            COUNT(*) as departure_count,
            COUNT(DISTINCT participantId) as unique_travelers,
            purpose,
            EXTRACT(HOUR FROM travelStartTime) as peak_hour,
            COUNT(*) as trips_in_hour
        FROM TravelJournal
        WHERE travelStartLocationId IS NOT NULL
        GROUP BY travelStartLocationId, purpose, EXTRACT(HOUR FROM travelStartTime)
        HAVING COUNT(*) > 10
        ORDER BY departure_count DESC
        LIMIT 50;
        """
        cur.execute(query)
        bottlenecks = cur.fetchall()
        return jsonify([dict(row) for row in bottlenecks])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/busiest-areas', methods=['GET'])
def get_busiest_areas():
    """
    Identify the busiest areas in Engagement based on participant activity.
    Optional query params: hour (0-23), day_of_week (Monday-Sunday)
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    hour = request.args.get('hour')
    day_of_week = request.args.get('day_of_week')
    
    try:
        query = """
        SELECT 
            currentLocation,
            currentMode,
            COUNT(*) as activity_count,
            COUNT(DISTINCT participantId) as unique_participants,
            EXTRACT(HOUR FROM timestamp) as hour_of_day,
            TO_CHAR(timestamp, 'Day') as day_name
        FROM ParticipantStatusLogs
        WHERE currentLocation IS NOT NULL
        """
        params = []
        
        if hour is not None:
            query += " AND EXTRACT(HOUR FROM timestamp) = %s"
            params.append(int(hour))
        if day_of_week:
            query += " AND TO_CHAR(timestamp, 'Day') ILIKE %s"
            params.append(f'%{day_of_week}%')
        
        query += """
        GROUP BY currentLocation, currentMode, EXTRACT(HOUR FROM timestamp), TO_CHAR(timestamp, 'Day')
        ORDER BY activity_count DESC
        LIMIT 100;
        """
        
        cur.execute(query, params)
        busy_areas = cur.fetchall()
        
        # Convert point locations to readable format
        result = []
        for area in busy_areas:
            area_dict = dict(area)
            if area_dict['currentlocation']:
                area_dict['currentlocation'] = str(area_dict['currentlocation'])
            result.append(area_dict)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/travel-patterns', methods=['GET'])
def get_travel_patterns():
    """
    Analyze travel patterns between locations to identify common routes.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            travelStartLocationId,
            travelEndLocationId,
            purpose,
            COUNT(*) as route_frequency,
            AVG(EXTRACT(EPOCH FROM (travelEndTime - travelStartTime))/60) as avg_duration_minutes,
            COUNT(DISTINCT participantId) as unique_travelers
        FROM TravelJournal
        WHERE travelStartLocationId IS NOT NULL 
          AND travelEndLocationId IS NOT NULL
        GROUP BY travelStartLocationId, travelEndLocationId, purpose
        HAVING COUNT(*) > 5
        ORDER BY route_frequency DESC
        LIMIT 100;
        """
        cur.execute(query)
        patterns = cur.fetchall()
        return jsonify([dict(row) for row in patterns])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ========================================
# QUESTION 3: Participant Daily Routines
# ========================================

@app.route('/api/participants', methods=['GET'])
def get_participants():
    """
    Get list of all participants with their basic information.
    Useful for selecting participants to analyze.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            participantId,
            householdSize,
            haveKids,
            age,
            educationLevel,
            interestGroup,
            joviality
        FROM Participants
        ORDER BY participantId;
        """
        cur.execute(query)
        participants = cur.fetchall()
        return jsonify([dict(row) for row in participants])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/participant-routines/<int:participant_id>', methods=['GET'])
def get_participant_routines(participant_id):
    """
    Get detailed daily routine for a specific participant.
    Shows their typical activities, locations, and timing.
    Optional query params: start_date, end_date
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    try:
        # Get participant info
        cur.execute("""
            SELECT * FROM Participants WHERE participantId = %s;
        """, (participant_id,))
        participant_info = cur.fetchone()
        
        if not participant_info:
            return jsonify({"error": "Participant not found"}), 404
        
        # Get typical daily activities
        query = """
        SELECT 
            TO_CHAR(timestamp, 'Day') as day_of_week,
            EXTRACT(HOUR FROM timestamp) as hour,
            currentMode,
            currentLocation,
            COUNT(*) as frequency
        FROM ParticipantStatusLogs
        WHERE participantId = %s
        """
        params = [participant_id]
        
        if start_date:
            query += " AND timestamp >= %s"
            params.append(start_date)
        if end_date:
            query += " AND timestamp <= %s"
            params.append(end_date)
        
        query += """
        GROUP BY TO_CHAR(timestamp, 'Day'), EXTRACT(HOUR FROM timestamp), currentMode, currentLocation
        ORDER BY day_of_week, hour;
        """
        
        cur.execute(query, params)
        activities = cur.fetchall()
        
        # Get travel patterns
        cur.execute("""
        SELECT 
            purpose,
            COUNT(*) as trip_count,
            AVG(EXTRACT(EPOCH FROM (travelEndTime - travelStartTime))/60) as avg_duration_minutes,
            EXTRACT(HOUR FROM travelStartTime) as typical_start_hour
        FROM TravelJournal
        WHERE participantId = %s
        GROUP BY purpose, EXTRACT(HOUR FROM travelStartTime)
        ORDER BY trip_count DESC;
        """, (participant_id,))
        travel_patterns = cur.fetchall()
        
        # Get venue visits
        cur.execute("""
        SELECT 
            venueType,
            venueId,
            COUNT(*) as visit_count,
            MIN(timestamp) as first_visit,
            MAX(timestamp) as last_visit
        FROM CheckinJournal
        WHERE participantId = %s
        GROUP BY venueType, venueId
        ORDER BY visit_count DESC
        LIMIT 20;
        """, (participant_id,))
        venue_visits = cur.fetchall()
        
        # Convert locations to strings
        activities_list = []
        for activity in activities:
            activity_dict = dict(activity)
            if activity_dict.get('currentlocation'):
                activity_dict['currentlocation'] = str(activity_dict['currentlocation'])
            activities_list.append(activity_dict)
        
        return jsonify({
            "participant": dict(participant_info),
            "daily_activities": activities_list,
            "travel_patterns": [dict(row) for row in travel_patterns],
            "venue_visits": [dict(row) for row in venue_visits]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

# ========================================
# QUESTION 4: Temporal Pattern Changes
# ========================================

@app.route('/api/temporal-patterns', methods=['GET'])
def get_temporal_patterns():
    """
    Analyze how patterns change over time.
    Returns aggregated data by date to show trends.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            DATE(timestamp) as date,
            currentMode,
            COUNT(*) as activity_count,
            COUNT(DISTINCT participantId) as active_participants,
            AVG(availableBalance) as avg_balance
        FROM ParticipantStatusLogs
        WHERE timestamp IS NOT NULL
        GROUP BY DATE(timestamp), currentMode
        ORDER BY date, currentMode;
        """
        cur.execute(query)
        patterns = cur.fetchall()
        return jsonify([dict(row) for row in patterns])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/seasonal-changes', methods=['GET'])
def get_seasonal_changes():
    """
    Identify seasonal changes in behavior patterns.
    Groups data by month to show seasonal trends.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            TO_CHAR(timestamp, 'YYYY-MM') as month,
            currentMode,
            COUNT(*) as activity_count,
            COUNT(DISTINCT participantId) as active_participants
        FROM ParticipantStatusLogs
        WHERE timestamp IS NOT NULL
        GROUP BY TO_CHAR(timestamp, 'YYYY-MM'), currentMode
        ORDER BY month, currentMode;
        """
        cur.execute(query)
        seasonal = cur.fetchall()
        return jsonify([dict(row) for row in seasonal])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/daily-activity-trends', methods=['GET'])
def get_daily_activity_trends():
    """
    Analyze daily activity trends over the dataset timespan.
    Shows how overall activity levels change day by day.
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        query = """
        SELECT 
            DATE(timestamp) as date,
            TO_CHAR(timestamp, 'Day') as day_of_week,
            COUNT(*) as total_activities,
            COUNT(DISTINCT participantId) as active_participants,
            SUM(CASE WHEN currentMode = 'Transport' THEN 1 ELSE 0 END) as transport_count,
            SUM(CASE WHEN currentMode = 'AtWork' THEN 1 ELSE 0 END) as work_count,
            SUM(CASE WHEN currentMode = 'AtRecreation' THEN 1 ELSE 0 END) as recreation_count,
            SUM(CASE WHEN currentMode = 'AtRestaurant' THEN 1 ELSE 0 END) as restaurant_count,
            SUM(CASE WHEN currentMode = 'AtHome' THEN 1 ELSE 0 END) as home_count
        FROM ParticipantStatusLogs
        WHERE timestamp IS NOT NULL
        GROUP BY DATE(timestamp), TO_CHAR(timestamp, 'Day')
        ORDER BY date;
        """
        cur.execute(query)
        trends = cur.fetchall()
        return jsonify([dict(row) for row in trends])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/venue-popularity', methods=['GET'])
def get_venue_popularity():
    """
    Track venue popularity changes over time.
    Optional query params: venue_type (Apartment, Pub, Restaurant, Workplace, School)
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    venue_type = request.args.get('venue_type')
    
    try:
        query = """
        SELECT 
            DATE(timestamp) as date,
            venueType,
            venueId,
            COUNT(*) as visit_count,
            COUNT(DISTINCT participantId) as unique_visitors
        FROM CheckinJournal
        WHERE 1=1
        """
        params = []
        
        if venue_type:
            query += " AND venueType = %s"
            params.append(venue_type)
        
        query += """
        GROUP BY DATE(timestamp), venueType, venueId
        ORDER BY date, visit_count DESC;
        """
        
        cur.execute(query, params)
        popularity = cur.fetchall()
        return jsonify([dict(row) for row in popularity])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
