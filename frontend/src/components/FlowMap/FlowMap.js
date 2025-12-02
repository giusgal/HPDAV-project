import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useApi, fetchFlowMapData } from '../../hooks/useApi';
import { FlowMapChart } from './FlowMapChart';
import './FlowMap.css';

const DAY_TYPES = [
  { id: 'all', label: 'All Days' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'weekend', label: 'Weekends' },
];

const MIN_GRID_SIZE = 100;
const MAX_GRID_SIZE = 600;

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

function FlowMap() {
  const svgRef = useRef(null);
  const chartRef = useRef(null);
  
  // State
  const [dayType, setDayType] = useState('weekday');
  const [purpose, setPurpose] = useState('all');
  const [gridSize, setGridSize] = useState(300);
  const [gridSizeInput, setGridSizeInput] = useState('300');
  const [debouncedGridSize, setDebouncedGridSize] = useState(300);
  const [minTrips, setMinTrips] = useState(10);
  const [currentHour, setCurrentHour] = useState(8);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1000);
  const [showCells, setShowCells] = useState(true);
  const [showFlows, setShowFlows] = useState(true);
  const [hoveredFlow, setHoveredFlow] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [maxFlowsToShow, setMaxFlowsToShow] = useState(50);
  const [aggregationInfo, setAggregationInfo] = useState(null);
  
  const animationRef = useRef(null);
  
  // Debounce grid size
  useEffect(() => {
    const timer = setTimeout(() => {
      const newSize = parseInt(gridSizeInput, 10);
      if (!isNaN(newSize) && newSize >= MIN_GRID_SIZE && newSize <= MAX_GRID_SIZE) {
        setDebouncedGridSize(newSize);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [gridSizeInput]);
  
  // Fetch data - autoFetch=false, we control fetching via useEffect
  const { data, loading, error, refetch } = useApi(
    fetchFlowMapData, 
    { gridSize: debouncedGridSize, dayType, purpose, minTrips },
    false  // Don't auto-fetch on mount
  );
  
  // Single effect to handle all fetching - skip the first render in Strict Mode
  const isFirstRender = useRef(true);
  const lastParams = useRef(null);
  
  useEffect(() => {
    const currentParams = JSON.stringify({ debouncedGridSize, dayType, purpose, minTrips });
    
    // Skip if params haven't changed (prevents duplicate fetches)
    if (lastParams.current === currentParams) {
      return;
    }
    
    // In Strict Mode, first render happens twice - skip if it's the unmount/remount cycle
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
    
    lastParams.current = currentParams;
    refetch({ gridSize: debouncedGridSize, dayType, purpose, minTrips });
  }, [debouncedGridSize, dayType, purpose, minTrips, refetch]);
  
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
  
  // Filter flows by current hour
  const hourlyFlows = useMemo(() => {
    if (!data?.flows) return [];
    return data.flows.filter(f => f.hour_bucket === currentHour);
  }, [data, currentHour]);
  
  // Filter cells by current hour
  const hourlyCells = useMemo(() => {
    if (!data?.cells) return [];
    return data.cells.filter(c => c.hour_bucket === currentHour);
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
    
    chartRef.current = new FlowMapChart(svgRef.current, {
      onFlowHover: (flow) => setHoveredFlow(flow),
      onCellHover: (cell) => setHoveredCell(cell),
      onAggregationChange: (info) => setAggregationInfo(info),
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
    if (!chartRef.current || !bounds) return;
    
    chartRef.current.update({
      flows: hourlyFlows,
      cells: hourlyCells,
      buildings: data?.buildings || [],
      bounds,
      showCells,
      showFlows,
      currentHour,
      maxTrips: data?.statistics?.max_trips || 100,
      maxFlowsToShow,
      gridSize: debouncedGridSize,
    });
  }, [hourlyFlows, hourlyCells, data?.buildings, bounds, showCells, showFlows, currentHour, data?.statistics, maxFlowsToShow, debouncedGridSize]);
  
  // Handle grid size slider
  const handleGridSizeChange = useCallback((e) => {
    const value = e.target.value;
    setGridSizeInput(value);
    setGridSize(parseInt(value, 10));
  }, []);
  
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
    <div className="flow-map-container">
      {/* Controls Panel */}
      <div className="flow-map-controls">
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
        </div>
        
        <div className="control-section">
          <h3>Display Settings</h3>
          <div className="filter-group">
            <label>Grid Size: {gridSize}m</label>
            <input
              type="range"
              min={MIN_GRID_SIZE}
              max={MAX_GRID_SIZE}
              value={gridSize}
              onChange={handleGridSizeChange}
            />
          </div>
          
          <div className="filter-group">
            <label>Min Trips: {minTrips}</label>
            <input
              type="range"
              min={1}
              max={50}
              value={minTrips}
              onChange={(e) => setMinTrips(parseInt(e.target.value, 10))}
            />
          </div>
          
          <div className="filter-group">
            <label>Max Flows Displayed: {maxFlowsToShow}</label>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={maxFlowsToShow}
              onChange={(e) => setMaxFlowsToShow(parseInt(e.target.value, 10))}
            />
            <small className="filter-hint">Limits visible flows during busy hours</small>
          </div>
          
          <div className="toggle-group">
            <label>
              <input
                type="checkbox"
                checked={showCells}
                onChange={(e) => setShowCells(e.target.checked)}
              />
              Show Origin/Destination Cells
            </label>
            <label>
              <input
                type="checkbox"
                checked={showFlows}
                onChange={(e) => setShowFlows(e.target.checked)}
              />
              Show Flow Arcs
            </label>
          </div>
        </div>
        
        {/* Statistics */}
        {data?.statistics && (
          <div className="control-section stats-section">
            <h3>Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Flows</span>
                <span className="stat-value">{data.statistics.total_flows.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Total Trips</span>
                <span className="stat-value">{data.statistics.total_trips.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Max Trips/Flow</span>
                <span className="stat-value">{data.statistics.max_trips.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">This Hour</span>
                <span className="stat-value">{hourlyFlows.length} flows</span>
              </div>
              {aggregationInfo && (
                <div className="stat-item aggregation-info">
                  <span className="stat-label">Showing</span>
                  <span className="stat-value highlight">{aggregationInfo.shownCount} / {aggregationInfo.originalCount}</span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Legend */}
        <div className="control-section legend-section">
          <h3>Legend</h3>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-icon flow-arc-gradient"></div>
              <span>Flow Arc (green→red = start→end)</span>
            </div>
            <div className="legend-item">
              <div className="legend-icon origin-cell"></div>
              <span>Net Origin (departures &gt; arrivals)</span>
            </div>
            <div className="legend-item">
              <div className="legend-icon destination-cell"></div>
              <span>Net Destination (arrivals &gt; departures)</span>
            </div>
          </div>
          <div className="legend-colors">
            <div className="color-scale">
              <span>Origin</span>
              <div className="gradient-bar flow-direction"></div>
              <span>Dest</span>
            </div>
            <div className="color-scale">
              <span>Low</span>
              <div className="gradient-bar"></div>
              <span>High</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Map Visualization */}
      <div className="flow-map-chart">
        {loading && <div className="loading-overlay">Loading flow data...</div>}
        {error && <div className="error-message">Error: {error}</div>}
        
        {/* Aggregation notice banner */}
        {aggregationInfo && (
          <div className="aggregation-banner">
            <span className="aggregation-icon">⚡</span>
            <span>
              Showing top <strong>{aggregationInfo.shownCount}</strong> of <strong>{aggregationInfo.originalCount}</strong> flows 
              ({aggregationInfo.percentTripsShown}% of trips)
            </span>
          </div>
        )}
        
        <svg ref={svgRef} className="flow-map-svg"></svg>
        
        {/* Tooltip - positioned based on mouse coordinates from D3 */}
        {(hoveredFlow || hoveredCell) && (
          <div 
            className="flow-map-tooltip" 
            style={{ 
              display: 'block',
              left: `${(hoveredFlow?.mouseX || hoveredCell?.mouseX || 0) + 15}px`,
              top: `${(hoveredFlow?.mouseY || hoveredCell?.mouseY || 0) - 10}px`
            }}
          >
            {hoveredFlow && (
              <div className="tooltip-content">
                <div className="tooltip-title">Flow Details</div>
                <div className="tooltip-row">
                  <span>Trips:</span>
                  <span>{hoveredFlow.trips}</span>
                </div>
                <div className="tooltip-row">
                  <span>Avg Travel Time:</span>
                  <span>{hoveredFlow.avg_travel_time != null ? parseFloat(hoveredFlow.avg_travel_time).toFixed(1) : 'N/A'} min</span>
                </div>
                {hoveredFlow.commute_trips > 0 && (
                  <div className="tooltip-row">
                    <span>Commute:</span>
                    <span>{hoveredFlow.commute_trips}</span>
                  </div>
                )}
                {hoveredFlow.recreation_trips > 0 && (
                  <div className="tooltip-row">
                    <span>Recreation:</span>
                    <span>{hoveredFlow.recreation_trips}</span>
                  </div>
                )}
              </div>
            )}
            {hoveredCell && (
              <div className="tooltip-content">
                <div className="tooltip-title">Cell Details</div>
                <div className="tooltip-row">
                  <span>Departures:</span>
                  <span>{hoveredCell.departures}</span>
                </div>
                <div className="tooltip-row">
                  <span>Arrivals:</span>
                  <span>{hoveredCell.arrivals}</span>
                </div>
                <div className="tooltip-row">
                  <span>Net Flow:</span>
                  <span className={hoveredCell.net_flow >= 0 ? 'positive' : 'negative'}>
                    {hoveredCell.net_flow >= 0 ? '+' : ''}{hoveredCell.net_flow}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Hour indicator */}
        <div className={`hour-indicator ${getHourColorClass(currentHour)}`}>
          <span className="hour-text">{formatHour(currentHour)}</span>
          <span className="hour-period">
            {currentHour >= 6 && currentHour < 10 ? 'Morning Rush' : 
             currentHour >= 16 && currentHour < 20 ? 'Evening Rush' :
             currentHour >= 10 && currentHour < 16 ? 'Midday' : 'Night'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default FlowMap;
