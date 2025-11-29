import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi, fetchTrafficPatterns, fetchBuildingsMapData } from '../../hooks/useApi';
import { TrafficPatternsChart, HourlyChart } from './TrafficPatternsChart';
import './TrafficPatterns.css';

const METRICS = [
  { id: 'total_visits', label: 'Total Visits' },
  { id: 'unique_visitors', label: 'Unique Visitors' },
  { id: 'avg_duration', label: 'Avg Duration (min)' },
  { id: 'work_visits', label: 'Work-Related Visits' },
  { id: 'restaurant_visits', label: 'Restaurant Visits' },
  { id: 'pub_visits', label: 'Pub Visits' },
];

const TIME_PERIODS = [
  { id: 'all', label: 'All Day' },
  { id: 'morning', label: 'Morning (6-12)' },
  { id: 'afternoon', label: 'Afternoon (12-18)' },
  { id: 'evening', label: 'Evening (18-24)' },
  { id: 'night', label: 'Night (0-6)' },
];

const DAY_TYPES = [
  { id: 'all', label: 'All Days' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'weekend', label: 'Weekends' },
];

const MIN_GRID_SIZE = 50;
const MAX_GRID_SIZE = 1000;

/**
 * Parse a PostgreSQL polygon string into an array of {x, y} points.
 * Format: ((x1,y1),(x2,y2),...)
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
  
  // If no valid points found, return null
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

function TrafficPatterns() {
  const svgRef = useRef(null);
  const hourlyChartRef = useRef(null);
  const tooltipRef = useRef(null);
  
  // Chart instances
  const chartRef = useRef(null);
  const hourlyChartInstanceRef = useRef(null);
  
  const [selectedMetric, setSelectedMetric] = useState('total_visits');
  const [timePeriod, setTimePeriod] = useState('all');
  const [dayType, setDayType] = useState('all');
  const [gridSize, setGridSize] = useState(100);
  const [gridSizeInput, setGridSizeInput] = useState('100');
  const [debouncedGridSize, setDebouncedGridSize] = useState(100);
  const [showBottlenecks, setShowBottlenecks] = useState(true);
  const [hoveredCell, setHoveredCell] = useState(null);

  // Debounce grid size changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedGridSize(gridSize);
    }, 400);
    return () => clearTimeout(timer);
  }, [gridSize]);

  // Sync gridSizeInput with gridSize (when slider changes)
  useEffect(() => {
    setGridSizeInput(String(gridSize));
  }, [gridSize]);

  // Fetch data
  const { data, loading, error, refetch } = useApi(
    fetchTrafficPatterns,
    { 
      gridSize: debouncedGridSize, 
      timePeriod, 
      dayType 
    },
    true
  );

  // Refetch when parameters change
  useEffect(() => {
    refetch({ gridSize: debouncedGridSize, timePeriod, dayType });
  }, [debouncedGridSize, timePeriod, dayType]);

  const { data: buildingsData } = useApi(fetchBuildingsMapData, {}, true);

  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric) || METRICS[0],
    [selectedMetric]
  );

  // Process data based on selected metric
  const processedData = useMemo(() => {
    if (!data || !data.traffic) return null;

    const cells = data.traffic.map(cell => {
      let value;
      switch (selectedMetric) {
        case 'total_visits': value = cell.total_visits; break;
        case 'unique_visitors': value = cell.unique_visitors; break;
        case 'avg_duration': value = cell.avg_duration || 0; break;
        case 'work_visits': value = cell.work_visits; break;
        case 'restaurant_visits': value = cell.restaurant_visits; break;
        case 'pub_visits': value = cell.pub_visits; break;
        default: value = cell.total_visits;
      }
      
      const isBottleneck = data.statistics && 
        cell.total_visits >= data.statistics.p90_visits;
      
      return { ...cell, value, isBottleneck };
    });

    return {
      cells,
      bounds: data.bounds,
      statistics: data.statistics,
      hourlyPattern: data.hourly_pattern,
    };
  }, [data, selectedMetric]);

  // Controller object for D3 chart callbacks
  const chartController = useMemo(() => ({
    onCellHover: (cellData, event) => {
      setHoveredCell(cellData);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('display', 'block')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      }
    },
    onCellLeave: () => {
      setHoveredCell(null);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current).style('display', 'none');
      }
    },
    onMouseMove: (event) => {
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      }
    },
    getTooltipRef: () => tooltipRef.current,
  }), []);

  // Update chart when data changes (lazy initialization)
  useEffect(() => {
    if (!svgRef.current || !processedData?.cells || !buildingsData?.buildings || !data) return;
    
    // Skip if data is stale (grid_size doesn't match current debouncedGridSize)
    // This prevents rendering old data with new grid size during loading
    if (data.grid_size !== debouncedGridSize) return;

    // Compute bounds from buildings
    const bounds = computeBoundsFromBuildings(buildingsData.buildings);
    if (!bounds) return; // Can't render without valid bounds

    // Always create a fresh chart instance (handles remount after loading)
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    chartRef.current = new TrafficPatternsChart(svgRef.current, chartController);
    chartRef.current.initialize();

    const { cells, statistics } = processedData;

    chartRef.current.update({
      cells,
      bounds,
      gridSize: data.grid_size,
      metricConfig: currentMetricConfig,
      showBottlenecks,
      statistics,
      buildingsData,
    });
  }, [processedData, debouncedGridSize, currentMetricConfig, showBottlenecks, buildingsData, chartController, data]);

  // Update hourly chart when data changes (lazy initialization)
  useEffect(() => {
    if (!hourlyChartRef.current || !processedData?.hourlyPattern) return;

    // Always create a fresh chart instance (handles remount after loading)
    if (hourlyChartInstanceRef.current) {
      hourlyChartInstanceRef.current.destroy();
    }
    hourlyChartInstanceRef.current = new HourlyChart(hourlyChartRef.current);
    hourlyChartInstanceRef.current.initialize();

    hourlyChartInstanceRef.current.update({
      hourlyData: processedData.hourlyPattern,
    });
  }, [processedData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      if (hourlyChartInstanceRef.current) {
        hourlyChartInstanceRef.current.destroy();
        hourlyChartInstanceRef.current = null;
      }
    };
  }, []);

  const formatValue = (value) => {
    if (value == null) return 'N/A';
    return value.toLocaleString();
  };

  if (loading) {
    return (
      <div className="traffic-patterns visualization-container">
        <div className="loading">Loading traffic patterns...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="traffic-patterns visualization-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="traffic-patterns visualization-container">
      <div className="controls">
        <div className="control-group">
          <label htmlFor="metric-select">Metric:</label>
          <select 
            id="metric-select"
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value)}
          >
            {METRICS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="time-select">Time Period:</label>
          <select 
            id="time-select"
            value={timePeriod} 
            onChange={(e) => setTimePeriod(e.target.value)}
          >
            {TIME_PERIODS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="day-select">Day Type:</label>
          <select 
            id="day-select"
            value={dayType} 
            onChange={(e) => setDayType(e.target.value)}
          >
            {DAY_TYPES.map(d => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="grid-slider">Grid Size:</label>
          <input
            type="range"
            id="grid-slider"
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            step={10}
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
            style={{ width: '150px' }}
          />
          <input
            type="text"
            id="grid-input"
            value={gridSizeInput}
            onChange={(e) => setGridSizeInput(e.target.value)}
            onBlur={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (!isNaN(parsed)) {
                const clamped = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, parsed));
                setGridSize(clamped);
                setGridSizeInput(String(clamped));
              } else {
                setGridSizeInput(String(gridSize));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.target.blur();
              }
            }}
            style={{ width: '60px', padding: '4px 8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <span style={{ fontSize: '12px', color: '#666' }}>units</span>
        </div>
        <div className="control-group">
          <label>
            <input 
              type="checkbox" 
              checked={showBottlenecks} 
              onChange={(e) => setShowBottlenecks(e.target.checked)}
            />
            {' '}Highlight Bottlenecks (Top 10%)
          </label>
        </div>
      </div>
      
      <div className="chart-container">
        <svg ref={svgRef}></svg>
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {hoveredCell && (
            <>
              <strong>Area ({hoveredCell.grid_x}, {hoveredCell.grid_y})</strong>
              {hoveredCell.isBottleneck && <span className="bottleneck-badge"> ⚠️ Bottleneck</span>}
              <br />
              {currentMetricConfig.label}: {formatValue(hoveredCell.value)}
              <br />
              <small>
                Total: {formatValue(hoveredCell.total_visits)} | 
                Unique: {formatValue(hoveredCell.unique_visitors)}
              </small>
              <br />
              <small>
                Work: {formatValue(hoveredCell.work_visits)} | 
                Restaurant: {formatValue(hoveredCell.restaurant_visits)} | 
                Pub: {formatValue(hoveredCell.pub_visits)}
              </small>
            </>
          )}
        </div>
      </div>

      {processedData?.statistics && (
        <div className="statistics-panel">
          <h4>Traffic Statistics</h4>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-label">Total Visits:</span>
              <span className="stat-value">{formatValue(processedData.statistics.total_visits)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Busiest Area:</span>
              <span className="stat-value">{formatValue(processedData.statistics.max_visits)} visits</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Average per Area:</span>
              <span className="stat-value">{formatValue(Math.round(processedData.statistics.avg_visits))}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Bottleneck Threshold (P90):</span>
              <span className="stat-value">{formatValue(processedData.statistics.p90_visits)} visits</span>
            </div>
          </div>
        </div>
      )}

      <div className="hourly-chart">
        <h4>Hourly Activity Distribution</h4>
        <div ref={hourlyChartRef} style={{ width: '100%', height: 150 }}></div>
        <p className="chart-note">
          <span style={{ color: '#d62728' }}>■</span> Peak hours (&gt;80% max) 
          <span style={{ color: '#ff7f0e', marginLeft: '10px' }}>■</span> High activity (&gt;60% max)
          <span style={{ color: '#1f77b4', marginLeft: '10px' }}>■</span> Normal activity
        </p>
      </div>

      <div className="info-panel">
        <h3>Identifying Busiest Areas &amp; Traffic Bottlenecks</h3>
        <p>
          This visualization shows traffic patterns across Engagement city. Areas with 
          higher visit counts are shown in warmer colors (yellow to red). 
          <strong>Bottlenecks</strong> (areas in the top 10% of traffic) are highlighted 
          with red borders and dashed circles.
        </p>
        <p>
          <strong>Key insights to look for:</strong>
        </p>
        <ul>
          <li><strong>Busiest areas:</strong> Red/orange cells indicate high traffic zones</li>
          <li><strong>Bottlenecks:</strong> Areas with disproportionately high traffic that may cause congestion</li>
          <li><strong>Time patterns:</strong> Use filters to see how traffic varies by time of day</li>
          <li><strong>Activity types:</strong> Switch metrics to see workplace vs recreational traffic</li>
        </ul>
      </div>
    </div>
  );
}

export default TrafficPatterns;
