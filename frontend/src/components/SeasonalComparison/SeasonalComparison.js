import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { fetchTemporalPatterns, fetchBuildingsMapData } from '../../hooks/useApi';
import { RadarChart, CalendarHeatmap, TimelineChart } from './SeasonalComparisonChart';
import './SeasonalComparison.css';

const SeasonalComparison = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [activeView, setActiveView] = useState('calendar');
  const [dayTypeFilter, setDayTypeFilter] = useState('all');
  const [timePeriodFilter, setTimePeriodFilter] = useState('all');
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [timelineGranularity, setTimelineGranularity] = useState('daily');
  const [activeCategories, setActiveCategories] = useState({
    restaurant: true, pub: true, home: true, work: true
  });
  
  // Geographic bounding box filter
  const [enableGeoFilter, setEnableGeoFilter] = useState(false);
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapData, setMapData] = useState(null);
  // Ref to store applied geo coords (only updated when Apply is clicked)
  const appliedGeoCoords = useRef(null);
  const miniMapRef = useRef(null);
  const brushRef = useRef(null);

  const toggleCategory = (cat) => setActiveCategories(p => ({ ...p, [cat]: !p[cat] }));
  
  const radarChartRef = useRef(null);
  const calendarChartRef = useRef(null);
  const timelineChartRef = useRef(null);
  const radarChartInstance = useRef(null);
  const calendarChartInstance = useRef(null);
  const timelineChartInstance = useRef(null);

  const calculateSeasonalData = useCallback((activityData) => {
    if (!activityData?.length) return null;
    const seasonalAgg = {
      spring: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      summer: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      fall: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      winter: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 }
    };
    activityData.forEach(d => {
      const month = new Date(d.period).getMonth() + 1;
      const season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'fall' : 'winter';
      seasonalAgg[season].count++;
      ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'].forEach(k => {
        seasonalAgg[season][k] += d[k] || 0;
      });
    });
    Object.values(seasonalAgg).forEach(s => {
      if (s.count > 0) ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'].forEach(k => s[k] /= s.count);
    });
    return seasonalAgg;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Prepare API params with optional bounding box
      const apiParams = { 
        granularity: 'daily', 
        metric: 'activity', 
        excludeOutliers,
        dayType: dayTypeFilter,
        timePeriod: timePeriodFilter
      };
      
      // Add bounding box if geo filter is enabled and applied coordinates exist
      const coords = appliedGeoCoords.current;
      if (enableGeoFilter && coords) {
        apiParams.minLat = coords.minLat;
        apiParams.maxLat = coords.maxLat;
        apiParams.minLon = coords.minLon;
        apiParams.maxLon = coords.maxLon;
      }
      
      // Load data for calendar (daily) and radar (weekly), plus timeline data
      const [daily, weekly, timeline] = await Promise.all([
        fetchTemporalPatterns({ ...apiParams, granularity: 'daily' }),
        fetchTemporalPatterns({ ...apiParams, granularity: 'weekly' }),
        fetchTemporalPatterns({ ...apiParams, granularity: timelineGranularity })
      ]);
      setData({ 
        daily: daily.activity || [], 
        weekly: weekly.activity || [], 
        timeline: timeline.activity || [],
        dateRange: weekly.date_range 
      });
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [excludeOutliers, enableGeoFilter, timelineGranularity, dayTypeFilter, timePeriodFilter]);
  
  // Load map data for geographic selection
  const loadMapData = useCallback(async () => {
    if (mapData) return; // Already loaded
    try {
      const data = await fetchBuildingsMapData();
      setMapData(data);
    } catch (e) {
      console.error('Failed to load map data:', e);
    }
  }, [mapData]);
  
  // Clear geo filter
  const clearGeoFilter = useCallback(() => {
    appliedGeoCoords.current = null;
    // Clear the brush selection
    if (brushRef.current && miniMapRef.current) {
      const svg = d3.select(miniMapRef.current);
      svg.select('.brush').call(brushRef.current.move, null);
    }
    loadData();
  }, [loadData]);
  
  // Initialize mini-map with brush when shown
  useEffect(() => {
    if (!enableGeoFilter || !miniMapRef.current || !mapData) return;
    
    const container = miniMapRef.current;
    const width = 450;
    const height = 350;
    const margin = { top: 10, right: 10, bottom: 10, left: 10 };
    
    // Clear previous
    d3.select(container).selectAll('*').remove();
    
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);
    
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);
    
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    
    // Get bounds from map data (API returns min_x, max_x, min_y, max_y)
    const bounds = mapData.bounds || {};
    const minX = bounds.min_x || 0;
    const maxX = bounds.max_x || 4000;
    const minY = bounds.min_y || 0;
    const maxY = bounds.max_y || 3000;
    
    // Create scales
    const xScale = d3.scaleLinear()
      .domain([minX, maxX])
      .range([0, innerWidth]);
    
    const yScale = d3.scaleLinear()
      .domain([minY, maxY])
      .range([innerHeight, 0]); // Inverted for proper map orientation
    
    // Parse PostgreSQL polygon string to array of points
    const parsePolygon = (locationStr) => {
      if (!locationStr) return null;
      // Format: "((x1,y1),(x2,y2),...)"
      const match = locationStr.match(/\(\((.*)\)\)/);
      if (!match) return null;
      const pointsStr = match[1];
      const points = pointsStr.split('),(').map(p => {
        const [x, y] = p.replace(/[()]/g, '').split(',').map(Number);
        return [x, y];
      });
      return points;
    };
    
    // Draw buildings as polygons
    if (mapData.buildings && mapData.buildings.length > 0) {
      g.selectAll('.building')
        .data(mapData.buildings.filter(b => b.location))
        .enter()
        .append('path')
        .attr('class', 'building')
        .attr('d', d => {
          const polygon = parsePolygon(d.location);
          if (!polygon || polygon.length < 3) return null;
          const points = polygon.map(p => [xScale(p[0]), yScale(p[1])]);
          return d3.line()(points) + 'Z';
        })
        .attr('fill', '#e8e8e8')
        .attr('stroke', '#ccc')
        .attr('stroke-width', 0.3);
    }
    
    // Draw venues as dots (API returns x and y properties)
    const venueColors = {
      apartments: '#3498db',
      employers: '#e74c3c',
      pubs: '#9b59b6',
      restaurants: '#f39c12'
    };
    
    Object.entries(mapData.venues || {}).forEach(([type, venues]) => {
      if (!venues || !Array.isArray(venues)) return;
      g.selectAll(`.venue-${type}`)
        .data(venues.filter(v => v.x != null && v.y != null))
        .enter()
        .append('circle')
        .attr('class', `venue-${type}`)
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y))
        .attr('r', 1.5)
        .attr('fill', venueColors[type] || '#666')
        .attr('opacity', 0.7);
    });
    
    // Create brush
    const brush = d3.brush()
      .extent([[0, 0], [innerWidth, innerHeight]])
      .on('end', (event) => {
        if (!event.selection) {
          appliedGeoCoords.current = null;
          loadData();
          return;
        }
        
        const [[x0, y0], [x1, y1]] = event.selection;
        
        // Convert pixel coordinates back to data coordinates
        const minLon = xScale.invert(x0);
        const maxLon = xScale.invert(x1);
        const minLat = yScale.invert(y1); // Note: y is inverted
        const maxLat = yScale.invert(y0);
        
        appliedGeoCoords.current = { minLat, maxLat, minLon, maxLon };
        loadData();
      });
    
    brushRef.current = brush;
    
    // Add brush to SVG
    g.append('g')
      .attr('class', 'brush')
      .call(brush);
    
    // Style the brush
    g.select('.brush .selection')
      .attr('fill', '#3498db')
      .attr('fill-opacity', 0.2)
      .attr('stroke', '#3498db')
      .attr('stroke-width', 2);
      
  }, [enableGeoFilter, mapData, loadData]);
  
  // Load map data when geo filter is enabled
  useEffect(() => {
    if (enableGeoFilter) {
      loadMapData();
    }
  }, [enableGeoFilter, loadMapData]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!radarChartRef.current || !data?.weekly || activeView !== 'radar') return;
    if (!radarChartInstance.current) {
      radarChartInstance.current = new RadarChart(radarChartRef.current);
      radarChartInstance.current.initialize();
    }
    radarChartInstance.current.update({
      seasonalData: calculateSeasonalData(data.weekly),
      dimensions: ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity']
    });
  }, [data, activeView, calculateSeasonalData]);

  useEffect(() => {
    if (!calendarChartRef.current || !data?.daily || activeView !== 'calendar') return;
    if (!calendarChartInstance.current) {
      calendarChartInstance.current = new CalendarHeatmap(calendarChartRef.current);
      calendarChartInstance.current.initialize();
    }
    calendarChartInstance.current.update({
      dailyData: data.daily,
      metric: 'total_checkins',
      dayTypeFilter,
      timePeriodFilter,
      compareMode: false,
      activeCategories
    });
  }, [data, activeView, dayTypeFilter, timePeriodFilter, activeCategories]);

  useEffect(() => {
    if (!timelineChartRef.current || !data?.timeline || activeView !== 'calendar') return;
    if (!timelineChartInstance.current) {
      timelineChartInstance.current = new TimelineChart(timelineChartRef.current);
      timelineChartInstance.current.initialize();
    }
    timelineChartInstance.current.update({
      dailyData: data.timeline,
      granularity: timelineGranularity,
      activeCategories
    });
  }, [data, activeView, timelineGranularity, activeCategories]);

  useEffect(() => () => {
    radarChartInstance.current?.destroy();
    calendarChartInstance.current?.destroy();
    timelineChartInstance.current?.destroy();
  }, []);

  return (
    <>
      <div className="seasonal-comparison">
        {/* Compact control bar */}
        <div className="controls-bar">
          <div className="control-item">
            <label>View</label>
            <select value={activeView} onChange={e => setActiveView(e.target.value)}>
              <option value="calendar">Calendar</option>
              <option value="radar">Radar</option>
            </select>
          </div>

          <div className="divider" />

          <div className="control-item">
            <label className="checkbox-minimal">
              <input type="checkbox" checked={excludeOutliers} onChange={e => setExcludeOutliers(e.target.checked)} />
              Remove Outliers
            </label>
          </div>
          
          <div className="divider" />
          
          <div className="control-item">
            <label className="checkbox-minimal">
              <input type="checkbox" checked={enableGeoFilter} onChange={e => setEnableGeoFilter(e.target.checked)} />
              Geographic Filter
            </label>
          </div>
          
          {enableGeoFilter && (
            <>
              <button 
                onClick={clearGeoFilter}
                style={{
                  padding: '4px 12px',
                  fontSize: '11px',
                  background: '#95a5a6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Clear Selection
              </button>
              
              {appliedGeoCoords.current && (
                <span style={{fontSize: '10px', color: '#27ae60', fontWeight: '500'}}>
                  ✓ Filter active
                </span>
              )}
            </>
          )}

          {activeView === 'calendar' && (
            <>
              <div className="divider" />
              
              <div className="control-item">
                <div className="toggle-group">
                  {['all', 'weekday', 'weekend'].map(v => (
                    <button key={v} className={dayTypeFilter === v ? 'active' : ''} onClick={() => setDayTypeFilter(v)}>
                      {v === 'all' ? 'All' : v === 'weekday' ? 'Weekdays' : 'Weekends'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-item">
                <div className="toggle-group">
                  {['all', 'morning', 'afternoon', 'evening', 'night'].map(v => (
                    <button key={v} className={timePeriodFilter === v ? 'active' : ''} onClick={() => setTimePeriodFilter(v)}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider" />

              <div className="control-item">
                <div className="category-pills">
                  <button className={`pill work ${activeCategories.work ? 'active' : ''}`} onClick={() => toggleCategory('work')}>💼 Work</button>
                  <button className={`pill home ${activeCategories.home ? 'active' : ''}`} onClick={() => toggleCategory('home')}>🏠 Home</button>
                  <button className={`pill restaurant ${activeCategories.restaurant ? 'active' : ''}`} onClick={() => toggleCategory('restaurant')}>🍽 Restaurant</button>
                  <button className={`pill pub ${activeCategories.pub ? 'active' : ''}`} onClick={() => toggleCategory('pub')}>🍺 Pub</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Main content area with map and charts side by side */}
        <div style={{ display: 'flex', gap: '12px', flex: 1, minHeight: 0, overflow: 'visible' }}>
          
          {/* Mini-map for geographic selection - always visible when geo filter is on */}
          {enableGeoFilter && activeView === 'calendar' && (
            <div className="geo-map-selector" style={{
              flex: '0 0 auto',
              background: 'white',
              borderRadius: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '100%',
              overflow: 'visible'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{fontSize: '12px', fontWeight: '600', color: '#2c3e50'}}>
                  📍 Draw a rectangle to select area
                </span>
                <span style={{fontSize: '10px', color: '#999'}}>
                  {appliedGeoCoords.current ? 
                    `Selected: (${appliedGeoCoords.current.minLon.toFixed(0)}, ${appliedGeoCoords.current.minLat.toFixed(0)}) - (${appliedGeoCoords.current.maxLon.toFixed(0)}, ${appliedGeoCoords.current.maxLat.toFixed(0)})` : 
                    'No area selected'}
                </span>
              </div>
              <div 
                ref={miniMapRef} 
                style={{
                  width: '450px',
                  height: '350px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  background: '#f8f9fa',
                  cursor: 'crosshair',
                  flexShrink: 0
                }}
              />
              <div style={{
                marginTop: '8px',
                display: 'flex',
                gap: '8px',
                fontSize: '10px',
                color: '#666'
              }}>
                <span><span style={{display: 'inline-block', width: '8px', height: '8px', background: '#3498db', borderRadius: '50%', marginRight: '4px'}}></span>Apartments</span>
                <span><span style={{display: 'inline-block', width: '8px', height: '8px', background: '#e74c3c', borderRadius: '50%', marginRight: '4px'}}></span>Employers</span>
                <span><span style={{display: 'inline-block', width: '8px', height: '8px', background: '#9b59b6', borderRadius: '50%', marginRight: '4px'}}></span>Pubs</span>
                <span><span style={{display: 'inline-block', width: '8px', height: '8px', background: '#f39c12', borderRadius: '50%', marginRight: '4px'}}></span>Restaurants</span>
              </div>
            </div>
          )}

          {/* Chart area */}
          <div className="chart-area" style={{ flex: 1, minWidth: 950 }}>
          <div className="chart-header">
            <span>{activeView === 'radar' ? 'Seasonal Radar' : 'Activity Calendar'}</span>
            {data?.dateRange && <span style={{opacity:0.7, fontSize:'11px'}}>{data.dateRange.start} — {data.dateRange.end}</span>}
          </div>
          <div className="chart-body">
            {loading && <div className="loading-overlay">Loading...</div>}
            {error && <div className="error-message">{error}</div>}
            <div ref={radarChartRef} style={{ width: '100%', height: '100%', display: activeView === 'radar' ? 'block' : 'none' }} />
            <div ref={calendarChartRef} style={{ width: '100%', height: '100%', display: activeView === 'calendar' ? 'block' : 'none' }} />
          </div>
        </div>

        </div>

        {/* Timeline chart - separate panel */}
        {activeView === 'calendar' && (
          <div className="chart-area timeline-panel">
            <div className="chart-header">
              <span>Activity Timeline</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{fontSize: '10px', opacity: 0.8}}>Granularity:</span>
                <select 
                  value={timelineGranularity} 
                  onChange={e => setTimelineGranularity(e.target.value)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    background: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div className="chart-body">
              <div ref={timelineChartRef} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default SeasonalComparison;
