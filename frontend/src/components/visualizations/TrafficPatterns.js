import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useApi, fetchTrafficPatterns, fetchBuildingsMapData } from '../../hooks/useApi';

const METRICS = [
  { id: 'total_visits', label: 'Total Visits', key: 'total_visits' },
  { id: 'unique_visitors', label: 'Unique Visitors', key: 'unique_visitors' },
  { id: 'restaurant_visits', label: 'Restaurant Visits', key: 'restaurant_visits' },
  { id: 'pub_visits', label: 'Pub Visits', key: 'pub_visits' },
  { id: 'work_visits', label: 'Workplace Visits', key: 'work_visits' },
  { id: 'home_visits', label: 'Home Visits', key: 'home_visits' },
];

const TIME_PERIODS = [
  { id: 'all', label: 'All Day' },
  { id: 'morning', label: 'Morning (6-10)' },
  { id: 'midday', label: 'Midday (10-14)' },
  { id: 'afternoon', label: 'Afternoon (14-18)' },
  { id: 'evening', label: 'Evening (18-22)' },
  { id: 'night', label: 'Night (22-6)' },
];

const DAY_TYPES = [
  { id: 'all', label: 'All Days' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'weekend', label: 'Weekends' },
];

const DEFAULT_GRID_SIZE = 300;
const MIN_GRID_SIZE = 50;
const MAX_GRID_SIZE = 1000;

/**
 * Parse PostgreSQL polygon string to array of points.
 * Format: "((x1,y1),(x2,y2),...)"
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
 * Compute bounds from building polygon vertices with padding.
 */
function computeBoundsFromBuildings(buildings, paddingPercent = 0.02) {
  if (!buildings || buildings.length === 0) return null;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  buildings.forEach(building => {
    const points = parsePolygon(building.location);
    if (points) {
      points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    }
  });
  
  if (minX === Infinity) return null;
  
  // Add padding
  const width = maxX - minX;
  const height = maxY - minY;
  const padX = width * paddingPercent;
  const padY = height * paddingPercent;
  
  return {
    min_x: minX - padX,
    max_x: maxX + padX,
    min_y: minY - padY,
    max_y: maxY + padY
  };
}

function TrafficPatterns() {
  const svgRef = useRef(null);
  const hourlyChartRef = useRef(null);
  const tooltipRef = useRef(null);
  const [selectedMetric, setSelectedMetric] = useState('total_visits');
  const [timePeriod, setTimePeriod] = useState('all');
  const [dayType, setDayType] = useState('all');
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [gridSizeInput, setGridSizeInput] = useState(DEFAULT_GRID_SIZE.toString());
  const [debouncedGridSize, setDebouncedGridSize] = useState(DEFAULT_GRID_SIZE);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [showBottlenecks, setShowBottlenecks] = useState(true);
  
  // Sync text input when slider changes
  useEffect(() => {
    setGridSizeInput(String(gridSize));
  }, [gridSize]);
  
  // Debounce grid size changes - wait 400ms after user stops sliding
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedGridSize(gridSize);
    }, 400);
    return () => clearTimeout(timer);
  }, [gridSize]);
  
  const { data, loading, error, refetch } = useApi(
    fetchTrafficPatterns, 
    { gridSize: debouncedGridSize, timePeriod, dayType }, 
    true
  );
  const { data: buildingsData } = useApi(fetchBuildingsMapData, {}, true);

  useEffect(() => {
    refetch({ gridSize: debouncedGridSize, timePeriod, dayType });
  }, [debouncedGridSize, timePeriod, dayType]);

  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric), [selectedMetric]);

  const processedData = useMemo(() => {
    if (!data || !data.traffic || !currentMetricConfig) return null;
    
    const cells = data.traffic.map(cell => ({
      ...cell,
      value: cell[currentMetricConfig.key],
      isBottleneck: data.statistics && cell.total_visits > data.statistics.p90_visits
    })).filter(cell => cell.value != null && cell.value > 0);

    return { 
      cells, 
      bounds: data.bounds, 
      statistics: data.statistics,
      hourlyPattern: data.hourly_pattern,
      flows: data.flows 
    };
  }, [data, currentMetricConfig]);

  // Main heatmap
  useEffect(() => {
    if (!processedData || !svgRef.current) return;

    const { cells, statistics } = processedData;
    
    // Compute bounds from building polygon vertices with padding
    const bounds = buildingsData?.buildings 
      ? computeBoundsFromBuildings(buildingsData.buildings)
      : processedData.bounds;
    
    if (!bounds) return;
    
    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    
    const dataWidth = bounds.max_x - bounds.min_x;
    const dataHeight = bounds.max_y - bounds.min_y;
    const dataAspectRatio = dataWidth / dataHeight;
    
    const margin = { top: 20, right: 120, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = innerWidth / dataAspectRatio;
    const height = innerHeight + margin.top + margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleLinear()
      .domain([bounds.min_x, bounds.max_x])
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain([bounds.min_y, bounds.max_y])
      .range([innerHeight, 0]);

    // Clipping path
    svg.append('defs')
      .append('clipPath')
      .attr('id', 'traffic-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Draw building polygons as background
    if (buildingsData?.buildings) {
      const lineGenerator = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinearClosed);

      const buildingsWithPaths = buildingsData.buildings
        .map(b => ({ ...b, points: parsePolygon(b.location) }))
        .filter(b => b.points && b.points.length >= 3);

      g.append('g')
        .attr('class', 'buildings-layer')
        .attr('clip-path', 'url(#traffic-clip)')
        .selectAll('path.building')
        .data(buildingsWithPaths)
        .enter()
        .append('path')
        .attr('class', 'building')
        .attr('d', d => lineGenerator(d.points))
        .attr('fill', d => {
          switch (d.buildingtype) {
            case 'Commercial': return 'rgba(52, 152, 219, 0.3)';
            case 'Residential':
            case 'Residental': return 'rgba(46, 204, 113, 0.3)';
            case 'School': return 'rgba(155, 89, 182, 0.3)';
            default: return 'rgba(100, 100, 100, 0.3)';
          }
        })
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.6);
    }

    const values = cells.map(c => c.value);
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, d3.max(values)]);

    const cellWidth = Math.abs(xScale(debouncedGridSize) - xScale(0));
    const cellHeight = Math.abs(yScale(0) - yScale(debouncedGridSize));

    const cellsGroup = g.append('g')
      .attr('clip-path', 'url(#traffic-clip)');

    // Draw cells
    cellsGroup.selectAll('rect.cell')
      .data(cells)
      .enter()
      .append('rect')
      .attr('class', 'cell')
      .attr('x', d => xScale(d.grid_x * debouncedGridSize))
      .attr('y', d => yScale((d.grid_y + 1) * debouncedGridSize))
      .attr('width', cellWidth)
      .attr('height', cellHeight)
      .attr('fill', d => colorScale(d.value))
      .attr('opacity', 0.7)
      .attr('stroke', d => (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#fff')
      .attr('stroke-width', d => (showBottlenecks && d.isBottleneck) ? 2 : 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        setHoveredCell(d);
        d3.select(event.target).attr('stroke', '#000').attr('stroke-width', 2);
        
        d3.select(tooltipRef.current)
          .style('display', 'block')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', (event) => {
        d3.select(tooltipRef.current)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', (event, d) => {
        setHoveredCell(null);
        d3.select(event.target)
          .attr('stroke', (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#fff')
          .attr('stroke-width', (showBottlenecks && d.isBottleneck) ? 2 : 0.5);
        d3.select(tooltipRef.current).style('display', 'none');
      });

    // Highlight bottleneck areas with markers
    if (showBottlenecks && statistics) {
      const bottlenecks = cells.filter(c => c.isBottleneck);
      cellsGroup.selectAll('circle.bottleneck-marker')
        .data(bottlenecks)
        .enter()
        .append('circle')
        .attr('class', 'bottleneck-marker')
        .attr('cx', d => xScale(d.grid_x * debouncedGridSize + debouncedGridSize / 2))
        .attr('cy', d => yScale(d.grid_y * debouncedGridSize + debouncedGridSize / 2))
        .attr('r', 8)
        .attr('fill', 'none')
        .attr('stroke', '#ff0000')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2');
    }

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', 35)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('X Coordinate');

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -innerHeight / 2)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('Y Coordinate');

    // Color legend
    const legendWidth = 20;
    const legendHeight = innerHeight;
    const legendScale = d3.scaleLinear()
      .domain(colorScale.domain())
      .range([legendHeight, 0]);

    const legend = svg.append('g')
      .attr('transform', `translate(${width - margin.right + 20},${margin.top})`);

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'traffic-gradient')
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    gradient.selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .enter()
      .append('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => colorScale(d * d3.max(values)));

    legend.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', 'url(#traffic-gradient)');

    legend.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(d3.axisRight(legendScale).ticks(5));

    legend.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(currentMetricConfig.label);

  }, [processedData, debouncedGridSize, currentMetricConfig, showBottlenecks, buildingsData]);

  // Hourly distribution chart
  useEffect(() => {
    if (!processedData?.hourlyPattern || !hourlyChartRef.current) return;

    const hourlyData = processedData.hourlyPattern;
    const container = hourlyChartRef.current;
    const width = container.clientWidth;
    const height = 150;
    const margin = { top: 20, right: 20, bottom: 30, left: 50 };

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const xScale = d3.scaleBand()
      .domain(hourlyData.map(d => d.hour))
      .range([0, innerWidth])
      .padding(0.1);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(hourlyData, d => d.visits)])
      .range([innerHeight, 0]);

    // Bars
    g.selectAll('rect')
      .data(hourlyData)
      .enter()
      .append('rect')
      .attr('x', d => xScale(d.hour))
      .attr('y', d => yScale(d.visits))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerHeight - yScale(d.visits))
      .attr('fill', d => {
        // Highlight peak hours
        if (d.visits > d3.max(hourlyData, h => h.visits) * 0.8) return '#d62728';
        if (d.visits > d3.max(hourlyData, h => h.visits) * 0.6) return '#ff7f0e';
        return '#1f77b4';
      });

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues([0, 6, 12, 18, 23]))
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', 25)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .text('Hour of Day');

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('.2s')));

  }, [processedData]);

  const formatValue = (value) => {
    if (value == null) return 'N/A';
    return value.toLocaleString();
  };

  if (loading) {
    return (
      <div className="visualization-container">
        <div className="loading">Loading traffic patterns...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="visualization-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="visualization-container">
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
