import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useApi, fetchTrafficDensityData } from '../../hooks/useApi';
import { TrafficDensityChart } from './TrafficDensityChart';
import './TrafficDensity.css';

const DAY_TYPES = [
  { id: 'all', label: 'All Days' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'weekend', label: 'Weekends' },
];

const DEBOUNCE_DELAY = 800;

/**
 * Parse a PostgreSQL polygon string into an array of {x, y} points.
 */
function parsePolygon(polygonStr) {
  if (!polygonStr) return null;
  try {
    const cleaned = polygonStr.replace(/^\(\(/, '').replace(/\)\)$/, '');
    const pointStrings = cleaned.split('),(');
    return pointStrings.map(pointStr => {
      const [x, y] = pointStr.replace(/[()]/g, '').split(',').map(Number);
      return { x, y };
    });
  } catch (e) {
    console.warn('Failed to parse polygon:', polygonStr, e);
    return null;
  }
}

/**
 * Compute bounds from building polygons with padding.
 */
function computeBoundsFromBuildings(buildings, paddingPercent = 0.05) {
  if (!buildings || buildings.length === 0) return null;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  buildings.forEach(b => {
    const pts = parsePolygon(b.location);
    if (!pts) return;
    pts.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
  });
  
  if (minX === Infinity) return null;
  
  const padX = (maxX - minX) * paddingPercent;
  const padY = (maxY - minY) * paddingPercent;
  return {
    min_x: minX - padX,
    max_x: maxX + padX,
    min_y: minY - padY,
    max_y: maxY + padY,
  };
}

function TrafficDensity() {
  const svgRef = useRef(null);
  const chartRef = useRef(null);
  
  // State
  const [dayType, setDayType] = useState('weekday');
  const [purpose, setPurpose] = useState('all');
  const [currentHour, setCurrentHour] = useState(8);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1000);
  const [showBuildings, setShowBuildings] = useState(true);
  const [lineOpacity, setLineOpacity] = useState(0.05);
  const [lineWidth, setLineWidth] = useState(0.5);
  const [maxLines, setMaxLines] = useState(50000);
  const [linesCount, setLinesCount] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [debouncedStartDate, setDebouncedStartDate] = useState('');
  const [debouncedEndDate, setDebouncedEndDate] = useState('');
  
  const animationRef = useRef(null);
  const datesInitialized = useRef(false);
  
  // Debounce date inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStartDate(startDate);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [startDate]);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEndDate(endDate);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [endDate]);
  
  // Fetch data
  const { data, loading, error, refetch } = useApi(
    fetchTrafficDensityData, 
    { dayType, purpose, startDate: debouncedStartDate, endDate: debouncedEndDate, maxLines },
    false
  );
  
  // Initialize dates from available data when it first loads
  useEffect(() => {
    if (data?.available_dates && !datesInitialized.current) {
      if (data.available_dates.min && data.available_dates.max) {
        setStartDate(data.available_dates.min);
        setEndDate(data.available_dates.max);
        setDebouncedStartDate(data.available_dates.min);
        setDebouncedEndDate(data.available_dates.max);
        datesInitialized.current = true;
      }
    }
  }, [data?.available_dates]);
  
  // Single effect to handle all fetching
  const lastParams = useRef(null);
  
  useEffect(() => {
    const currentParams = JSON.stringify({ dayType, purpose, debouncedStartDate, debouncedEndDate, maxLines });
    
    if (lastParams.current === currentParams) {
      return;
    }
    
    lastParams.current = currentParams;
    refetch({ dayType, purpose, startDate: debouncedStartDate, endDate: debouncedEndDate, maxLines });
  }, [dayType, purpose, debouncedStartDate, debouncedEndDate, maxLines, refetch]);
  
  // Compute bounds from buildings
  const bounds = useMemo(() => {
    if (!data?.buildings) return data?.bounds || null;
    return computeBoundsFromBuildings(data.buildings) || data?.bounds;
  }, [data]);
  
  // Get purpose options from data
  const purposeOptions = useMemo(() => {
    if (!data?.purposes) return [{ id: 'all', label: 'All Purposes' }];
    return [
      { id: 'all', label: 'All Purposes' },
      ...data.purposes.map(p => ({ id: p.purpose, label: p.purpose }))
    ];
  }, [data]);
  
  // Filter trips by current hour
  const hourlyTrips = useMemo(() => {
    if (!data?.trips) {
      return [];
    }
    const filtered = data.trips.filter(t => t.hour_bucket === currentHour);
    return filtered;
  }, [data, currentHour]);
  
  // Animation logic
  useEffect(() => {
    if (isAnimating) {
      animationRef.current = setInterval(() => {
        setCurrentHour(h => (h + 1) % 24);
      }, animationSpeed);
    } else {
      clearInterval(animationRef.current);
    }
    return () => clearInterval(animationRef.current);
  }, [isAnimating, animationSpeed]);
  
  // Initialize chart
  useEffect(() => {
    if (!svgRef.current) return;
    
    chartRef.current = new TrafficDensityChart(svgRef.current, {
      onLinesCountChange: (count) => setLinesCount(count),
    });
    chartRef.current.initialize();
    
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, []);
  
  // Update chart when data changes
  useEffect(() => {
    if (!chartRef.current || !bounds) {
      return;
    }
    
    chartRef.current.update({
      trips: hourlyTrips,
      buildings: data?.buildings || [],
      bounds,
      currentHour,
      lineOpacity,
      lineWidth,
      showBuildings,
    });
  }, [hourlyTrips, data?.buildings, bounds, currentHour, lineOpacity, lineWidth, showBuildings]);
  
  // Format hour for display
  const formatHour = (hour) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:00 ${period}`;
  };
  
  // Get hour color class
  const getHourColorClass = (hour) => {
    if (hour >= 6 && hour < 10) return 'morning-rush';
    if (hour >= 10 && hour < 16) return 'midday';
    if (hour >= 16 && hour < 20) return 'evening-rush';
    if (hour >= 20 || hour < 6) return 'night';
    return '';
  };

  return (
    <div className="traffic-density-container">
      {/* Controls Panel */}
      <div className="traffic-density-controls">
        <div className="control-section">
          <h3>Time Controls</h3>
          <div className="time-slider-container">
            <label>Hour: <span className={`hour-display ${getHourColorClass(currentHour)}`}>{formatHour(currentHour)}</span></label>
            <input
              type="range"
              min="0"
              max="23"
              value={currentHour}
              onChange={(e) => setCurrentHour(parseInt(e.target.value, 10))}
              className="hour-slider"
            />
            <div className="hour-labels">
              <span>12 AM</span>
              <span>6 AM</span>
              <span>12 PM</span>
              <span>6 PM</span>
              <span>11 PM</span>
            </div>
          </div>
          
          <div className="animation-controls">
            <button 
              className={`animate-btn ${isAnimating ? 'active' : ''}`}
              onClick={() => setIsAnimating(!isAnimating)}
            >
              {isAnimating ? '⏸ Pause' : '▶ Play'}
            </button>
            <label>
              Speed:
              <select 
                value={animationSpeed} 
                onChange={(e) => setAnimationSpeed(parseInt(e.target.value, 10))}
              >
                <option value={2000}>Slow</option>
                <option value={1000}>Normal</option>
                <option value={500}>Fast</option>
                <option value={250}>Very Fast</option>
              </select>
            </label>
          </div>
        </div>
        
        <div className="control-section">
          <h3>Filters</h3>
          <div className="filter-group">
            <label>Day Type:</label>
            <div className="button-group">
              {DAY_TYPES.map(dt => (
                <button
                  key={dt.id}
                  className={`filter-btn ${dayType === dt.id ? 'active' : ''}`}
                  onClick={() => setDayType(dt.id)}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-group">
            <label>Purpose:</label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {purposeOptions.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Date Range:</label>
            <div className="date-range-inputs column">
              <div className="date-input-row">
                <span className="date-label">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={data?.available_dates?.min}
                  max={data?.available_dates?.max}
                />
              </div>
              <div className="date-input-row">
                <span className="date-label">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={data?.available_dates?.min}
                  max={data?.available_dates?.max}
                />
              </div>
              {(startDate || endDate) && data?.available_dates && (
                <button 
                  onClick={() => {
                    setStartDate(data.available_dates.min);
                    setEndDate(data.available_dates.max);
                  }}
                  className="filter-btn"
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    padding: '6px 12px',
                    fontSize: '13px'
                  }}
                >
                  Show All
                </button>
              )}
            </div>
          </div>
        </div>
        
        <div className="control-section">
          <h3>Display Settings</h3>
          
          <div className="filter-group">
            <label>Line Opacity: {(lineOpacity * 100).toFixed(0)}%</label>
            <div className="slider-with-value">
              <input
                type="range"
                min={0.01}
                max={0.3}
                step={0.01}
                value={lineOpacity}
                onChange={(e) => setLineOpacity(parseFloat(e.target.value))}
              />
            </div>
            <small className="filter-hint">Lower values show density better</small>
          </div>
          
          <div className="filter-group">
            <label>Line Width: {lineWidth.toFixed(1)}px</label>
            <div className="slider-with-value">
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.1}
                value={lineWidth}
                onChange={(e) => setLineWidth(parseFloat(e.target.value))}
              />
            </div>
          </div>
          
          <div className="filter-group">
            <label>Max Lines: {maxLines.toLocaleString()}</label>
            <input
              type="range"
              min={10000}
              max={200000}
              step={10000}
              value={maxLines}
              onChange={(e) => setMaxLines(parseInt(e.target.value, 10))}
            />
            <small className="filter-hint">Limit total lines for performance</small>
          </div>
          
          <div className="toggle-group">
            <label>
              <input
                type="checkbox"
                checked={showBuildings}
                onChange={(e) => setShowBuildings(e.target.checked)}
              />
              Show Buildings
            </label>
          </div>
        </div>
        
        {/* Statistics */}
        {data?.statistics && (
          <div className="control-section stats-section">
            <h3>Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Trips</span>
                <span className="stat-value">{data.statistics.total_trips?.toLocaleString() || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Loaded Trips</span>
                <span className="stat-value">{data.trips?.length?.toLocaleString() || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">This Hour</span>
                <span className="stat-value">{hourlyTrips.length.toLocaleString()} lines</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Visible</span>
                <span className="stat-value">{linesCount.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Legend */}
        <div className="control-section legend-section">
          <h3>Legend</h3>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-icon density-line"></div>
              <span>Trip line (origin → destination)</span>
            </div>
            <div className="legend-item">
              <div className="legend-icon building-residential"></div>
              <span>Building footprint</span>
            </div>
          </div>
          <div className="legend-tips">
            <p><strong>Tip:</strong> Areas with many overlapping lines appear darker, revealing traffic bottlenecks and high-density corridors.</p>
            <p><strong>Tip:</strong> Reduce line opacity to see density patterns more clearly.</p>
          </div>
        </div>
      </div>
      
      {/* Map Visualization */}
      <div className="traffic-density-chart">
        {loading && <div className="loading-overlay">Loading trip data...</div>}
        {error && <div className="error-message">Error: {error}</div>}
        
        
        
        <svg ref={svgRef} className="traffic-density-svg"></svg>
        
      </div>
    </div>
  );
}

export default TrafficDensity;
