import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi, fetchAreaCharacteristics, fetchBuildingsMapData } from '../../hooks/useApi';

const METRICS = [
  { id: 'population', label: 'Population', category: 'demographics', key: 'population' },
  { id: 'avg_age', label: 'Average Age', category: 'demographics', key: 'avg_age' },
  { id: 'avg_joviality', label: 'Average Joviality', category: 'demographics', key: 'avg_joviality' },
  { id: 'pct_with_kids', label: '% With Kids', category: 'demographics', key: 'pct_with_kids' },
  { id: 'pct_graduate', label: '% Graduate Education', category: 'demographics', key: 'pct_graduate' },
  { id: 'avg_household_size', label: 'Avg Household Size', category: 'demographics', key: 'avg_household_size' },
  { id: 'avg_income', label: 'Average Income', category: 'financial', key: 'avg_income' },
  { id: 'avg_food_spending', label: 'Avg Food Spending', category: 'financial', key: 'avg_food_spending' },
  { id: 'avg_recreation_spending', label: 'Avg Recreation Spending', category: 'financial', key: 'avg_recreation_spending' },
  { id: 'avg_rental_cost', label: 'Average Rent', category: 'apartments', key: 'avg_rental_cost' },
  { id: 'apartment_count', label: 'Apartment Count', category: 'apartments', key: 'apartment_count' },
  { id: 'restaurant_count', label: 'Restaurant Count', category: 'venues', key: 'restaurant_count' },
  { id: 'pub_count', label: 'Pub Count', category: 'venues', key: 'pub_count' },
  { id: 'employer_count', label: 'Employer Count', category: 'venues', key: 'employer_count' },
];

const DEFAULT_GRID_SIZE = 250;
const MIN_GRID_SIZE = 50;
const MAX_GRID_SIZE = 1000;

// IDW interpolation parameters
const DEFAULT_IDW_POWER = 4.5;
const MIN_IDW_POWER = 0.5;
const MAX_IDW_POWER = 5;
const RENDER_SCALE = 0.25; // Render at 25% resolution then scale up (lower = faster)
const K_NEAREST_NEIGHBORS = 8; // Number of nearest points to consider for interpolation

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
 * Build a spatial grid index for fast nearest neighbor queries.
 * @param {Array} dataPoints - Array of {x, y, value} objects
 * @param {Object} bounds - {min_x, max_x, min_y, max_y}
 * @param {number} gridSize - Size of spatial grid cells
 * @returns {Object} Spatial index with grid and metadata
 */
function buildSpatialIndex(dataPoints, bounds, gridSize) {
  const grid = new Map();
  const cellSize = gridSize * 2; // Use 2x the data grid size for spatial index
  
  dataPoints.forEach(point => {
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    const key = `${cellX},${cellY}`;
    
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(point);
  });
  
  return { grid, cellSize };
}

/**
 * Get K nearest neighbors using spatial index.
 * @param {number} x - Query X coordinate
 * @param {number} y - Query Y coordinate
 * @param {Object} spatialIndex - Spatial index from buildSpatialIndex
 * @param {number} k - Number of neighbors to find
 * @returns {Array} K nearest data points
 */
function getKNearestNeighbors(x, y, spatialIndex, k) {
  const { grid, cellSize } = spatialIndex;
  const cellX = Math.floor(x / cellSize);
  const cellY = Math.floor(y / cellSize);
  
  const candidates = [];
  
  // Check current cell and neighboring cells (3x3 grid)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cellX + dx},${cellY + dy}`;
      const points = grid.get(key);
      if (points) {
        candidates.push(...points);
      }
    }
  }
  
  // If we don't have enough candidates, expand search
  if (candidates.length < k) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue; // Skip already checked
        const key = `${cellX + dx},${cellY + dy}`;
        const points = grid.get(key);
        if (points) {
          candidates.push(...points);
        }
      }
    }
  }
  
  // Calculate distances and sort
  const withDistances = candidates.map(point => {
    const dx = x - point.x;
    const dy = y - point.y;
    return {
      ...point,
      distSq: dx * dx + dy * dy
    };
  });
  
  withDistances.sort((a, b) => a.distSq - b.distSq);
  
  return withDistances.slice(0, k);
}

/**
 * Fast IDW interpolation using K nearest neighbors.
 * @param {number} x - X coordinate to interpolate
 * @param {number} y - Y coordinate to interpolate
 * @param {Array} nearestPoints - K nearest points with distSq already calculated
 * @param {number} power - The power parameter (higher = more local influence)
 * @returns {number} Interpolated value
 */
function idwInterpolationFast(nearestPoints, power = 2) {
  if (nearestPoints.length === 0) return 0;
  
  // If we're very close to a point, return its value
  if (nearestPoints[0].distSq < 0.01) {
    return nearestPoints[0].value;
  }
  
  let weightedSum = 0;
  let weightSum = 0;
  
  for (const point of nearestPoints) {
    const dist = Math.sqrt(point.distSq);
    const weight = 1 / Math.pow(dist, power);
    weightedSum += weight * point.value;
    weightSum += weight;
  }
  
  return weightSum > 0 ? weightedSum / weightSum : 0;
}

/**
 * Check if a point is inside any building polygon using ray casting algorithm.
 */
function isPointInPolygon(x, y, polygon) {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Check if a point is inside any of the building polygons.
 */
function isPointInsideBuildings(x, y, buildingPolygons) {
  for (const polygon of buildingPolygons) {
    if (isPointInPolygon(x, y, polygon)) {
      return true;
    }
  }
  return false;
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

function AreaCharacteristics() {
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const [selectedMetric, setSelectedMetric] = useState('population');
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [gridSizeInput, setGridSizeInput] = useState(DEFAULT_GRID_SIZE.toString());
  const [debouncedGridSize, setDebouncedGridSize] = useState(DEFAULT_GRID_SIZE);
  const [hoveredValue, setHoveredValue] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [opacity, setOpacity] = useState(1.0);
  const [debouncedOpacity, setDebouncedOpacity] = useState(0.7);
  const [idwPower, setIdwPower] = useState(DEFAULT_IDW_POWER);
  const [debouncedIdwPower, setDebouncedIdwPower] = useState(DEFAULT_IDW_POWER);
  const [showBuildings, setShowBuildings] = useState(true);
  
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
  
  // Debounce opacity changes - wait 200ms after user stops sliding
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOpacity(opacity);
    }, 200);
    return () => clearTimeout(timer);
  }, [opacity]);
  
  // Debounce IDW power changes - wait 300ms after user stops sliding
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIdwPower(idwPower);
    }, 300);
    return () => clearTimeout(timer);
  }, [idwPower]);
  
  const { data, loading, error, refetch } = useApi(fetchAreaCharacteristics, { gridSize: debouncedGridSize }, true);
  const { data: buildingsData } = useApi(fetchBuildingsMapData, {}, true);

  // Track if initial load is complete
  const initialLoadComplete = useRef(false);
  
  // Refetch when grid size or excludeOutliers changes (but skip initial load)
  useEffect(() => {
    // Skip the first render - the useApi hook already fetched on mount
    if (!initialLoadComplete.current) {
      initialLoadComplete.current = true;
      return;
    }
    
    refetch({ gridSize: debouncedGridSize, excludeOutliers });
  }, [debouncedGridSize, excludeOutliers]);

  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric), [selectedMetric]);

  const processedData = useMemo(() => {
    if (!data || !currentMetricConfig) return null;
    
    const categoryData = data[currentMetricConfig.category];
    if (!categoryData) return null;

    // Create a map for quick lookup
    const dataMap = new Map();
    categoryData.forEach(cell => {
      const key = `${cell.grid_x},${cell.grid_y}`;
      dataMap.set(key, cell);
    });

    // Get all grid cells with values - filter out null and 0 values
    // Convert grid coordinates to actual coordinates (center of each cell)
    const cells = categoryData.map(cell => ({
      ...cell,
      value: cell[currentMetricConfig.key],
      // Convert grid indices to actual coordinates (center of cell)
      x: (cell.grid_x + 0.5) * debouncedGridSize,
      y: (cell.grid_y + 0.5) * debouncedGridSize
    })).filter(cell => cell.value != null && cell.value !== 0);

    return { cells, dataMap, bounds: data.bounds };
  }, [data, currentMetricConfig, debouncedGridSize]);

  // Pre-parse building polygons for hit testing
  const buildingPolygons = useMemo(() => {
    if (!buildingsData?.buildings) return [];
    return buildingsData.buildings
      .map(b => parsePolygon(b.location))
      .filter(p => p && p.length >= 3);
  }, [buildingsData]);

  useEffect(() => {
    if (!processedData || !svgRef.current || !canvasRef.current) return;

    const { cells } = processedData;
    
    // Compute bounds from building polygon vertices with padding
    const bounds = buildingsData?.buildings 
      ? computeBoundsFromBuildings(buildingsData.buildings)
      : processedData.bounds;
    
    if (!bounds) return;
    
    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    
    // Calculate data dimensions to maintain aspect ratio
    const dataWidth = bounds.max_x - bounds.min_x;
    const dataHeight = bounds.max_y - bounds.min_y;
    const dataAspectRatio = dataWidth / dataHeight;
    
    // Set height based on width to maintain aspect ratio
    const margin = { top: 20, right: 120, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = innerWidth / dataAspectRatio;
    const height = innerHeight + margin.top + margin.bottom;

    // Setup canvas for continuous heatmap - render at lower resolution for performance
    const canvas = canvasRef.current;
    const renderWidth = Math.floor(innerWidth * RENDER_SCALE);
    const renderHeight = Math.floor(innerHeight * RENDER_SCALE);
    
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    canvas.style.position = 'absolute';
    canvas.style.left = `${margin.left}px`;
    canvas.style.top = `${margin.top}px`;
    canvas.style.imageRendering = 'auto'; // Smooth scaling
    
    const ctx = canvas.getContext('2d');
    
    // Build spatial index for fast nearest neighbor queries
    const spatialIndex = buildSpatialIndex(cells, bounds, debouncedGridSize);

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleLinear()
      .domain([bounds.min_x, bounds.max_x])
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain([bounds.min_y, bounds.max_y])
      .range([innerHeight, 0]);

    // Color scale
    const values = cells.map(c => c.value);
    const minValue = d3.min(values);
    const maxValue = d3.max(values);
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([minValue, maxValue]);

    // Render continuous heatmap on canvas using fast IDW interpolation
    const imageData = ctx.createImageData(renderWidth, renderHeight);
    const pixelData = imageData.data;
    
    // Render at lower resolution for performance
    for (let py = 0; py < renderHeight; py++) {
      for (let px = 0; px < renderWidth; px++) {
        // Convert pixel coordinates to data coordinates (accounting for render scale)
        const screenX = px / RENDER_SCALE;
        const screenY = py / RENDER_SCALE;
        const dataX = xScale.invert(screenX);
        const dataY = yScale.invert(screenY);
        
        // Check if point is inside any building (if filtering enabled)
        const insideBuilding = showBuildings && buildingPolygons.length > 0 
          ? isPointInsideBuildings(dataX, dataY, buildingPolygons)
          : true;
        
        if (insideBuilding || !showBuildings) {
          // Get K nearest neighbors
          const nearestPoints = getKNearestNeighbors(dataX, dataY, spatialIndex, K_NEAREST_NEIGHBORS);
          
          if (nearestPoints.length > 0) {
            // Interpolate value using nearest neighbors
            const value = idwInterpolationFast(nearestPoints, debouncedIdwPower);
            
            // Get color for this value
            const color = d3.color(colorScale(value));
            
            // Set pixel color
            const idx = (py * renderWidth + px) * 4;
            pixelData[idx] = color.r;
            pixelData[idx + 1] = color.g;
            pixelData[idx + 2] = color.b;
            pixelData[idx + 3] = Math.round(debouncedOpacity * 255);
          }
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0);

    // Add clipping path for SVG elements
    svg.append('defs')
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Draw building outlines on SVG (on top of canvas)
    if (buildingsData?.buildings && showBuildings) {
      const lineGenerator = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinearClosed);

      const buildingsWithPaths = buildingsData.buildings
        .map(b => ({ ...b, points: parsePolygon(b.location) }))
        .filter(b => b.points && b.points.length >= 3);

      g.append('g')
        .attr('class', 'buildings-layer')
        .attr('clip-path', 'url(#chart-clip)')
        .selectAll('path.building')
        .data(buildingsWithPaths)
        .enter()
        .append('path')
        .attr('class', 'building')
        .attr('d', d => lineGenerator(d.points))
        .attr('fill', 'none')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.8);
    }

    // Invisible overlay for mouse tracking
    g.append('rect')
      .attr('class', 'mouse-overlay')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [px, py] = d3.pointer(event);
        const dataX = xScale.invert(px);
        const dataY = yScale.invert(py);
        
        // Check if inside buildings
        const insideBuilding = showBuildings && buildingPolygons.length > 0 
          ? isPointInsideBuildings(dataX, dataY, buildingPolygons)
          : true;
        
        if (insideBuilding || !showBuildings) {
          const nearestPoints = getKNearestNeighbors(dataX, dataY, spatialIndex, K_NEAREST_NEIGHBORS);
          if (nearestPoints.length > 0) {
            const value = idwInterpolationFast(nearestPoints, debouncedIdwPower);
            setHoveredValue({ value, x: dataX, y: dataY });
            setMousePos({ x: event.clientX, y: event.clientY });
            
            d3.select(tooltipRef.current)
              .style('display', 'block')
              .style('left', `${event.clientX + 10}px`)
              .style('top', `${event.clientY - 10}px`);
          } else {
            setHoveredValue(null);
            d3.select(tooltipRef.current).style('display', 'none');
          }
        } else {
          setHoveredValue(null);
          d3.select(tooltipRef.current).style('display', 'none');
        }
      })
      .on('mouseout', () => {
        setHoveredValue(null);
        setMousePos(null);
        d3.select(tooltipRef.current).style('display', 'none');
      });

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

    const legendAxis = d3.axisRight(legendScale).ticks(5);

    const legend = svg.append('g')
      .attr('transform', `translate(${width - margin.right + 20},${margin.top})`);

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'legend-gradient')
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    gradient.selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .enter()
      .append('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => colorScale(minValue + d * (maxValue - minValue)));

    legend.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', 'url(#legend-gradient)');

    legend.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(legendAxis);

    legend.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(currentMetricConfig.label);

  }, [processedData, debouncedGridSize, currentMetricConfig, buildingsData, debouncedOpacity, debouncedIdwPower, showBuildings, buildingPolygons]);

  const formatValue = (value, metricId) => {
    if (value == null) return 'N/A';
    if (metricId.includes('pct')) return `${(value * 100).toFixed(1)}%`;
    if (metricId.includes('income') || metricId.includes('spending') || metricId.includes('cost') || metricId.includes('rent')) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  if (loading && !data) {
    return (
      <div className="visualization-container">
        <div className="loading">Loading area characteristics...</div>
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
            <optgroup label="Demographics">
              {METRICS.filter(m => m.category === 'demographics').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Financial">
              {METRICS.filter(m => m.category === 'financial').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Housing">
              {METRICS.filter(m => m.category === 'apartments').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Venues">
              {METRICS.filter(m => m.category === 'venues').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
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
            style={{ width: '120px' }}
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
            style={{ width: '50px', padding: '4px 6px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
        </div>
        <div className="control-group">
          <label htmlFor="idw-slider">Smoothness:</label>
          <input
            type="range"
            id="idw-slider"
            min={MIN_IDW_POWER}
            max={MAX_IDW_POWER}
            step={0.1}
            value={idwPower}
            onChange={(e) => setIdwPower(Number(e.target.value))}
            style={{ width: '100px' }}
          />
          <span style={{ fontSize: '12px', color: '#666', minWidth: '30px' }}>{idwPower.toFixed(1)}</span>
        </div>
        <div className="control-group">
          <label htmlFor="opacity-slider">Opacity:</label>
          <input
            type="range"
            id="opacity-slider"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: '80px' }}
          />
          <span style={{ fontSize: '12px', color: '#666', minWidth: '35px' }}>{(opacity * 100).toFixed(0)}%</span>
        </div>
        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={showBuildings}
              onChange={(e) => setShowBuildings(e.target.checked)}
            />
            <span style={{ marginLeft: '4px' }}>Buildings Only</span>
          </label>
        </div>
        {loading && <span className="loading-indicator">Updating...</span>}
      </div>
      
      <div className="chart-container" style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ pointerEvents: 'none' }}></canvas>
        <svg ref={svgRef}></svg>
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {hoveredValue && (
            <>
              <strong>Location ({hoveredValue.x.toFixed(0)}, {hoveredValue.y.toFixed(0)})</strong>
              <br />
              {currentMetricConfig.label}: {formatValue(hoveredValue.value, selectedMetric)}
              <br />
              <span style={{ fontSize: '11px', color: '#888' }}>(Interpolated value)</span>
            </>
          )}
        </div>
      </div>

      <div className="info-panel">
        <h3>About This Visualization</h3>
        <p>
          This continuous heatmap uses Inverse Distance Weighting (IDW) interpolation 
          to create a smooth surface from the grid-based data. Each point's color is 
          calculated as a weighted average of nearby data points, where closer points 
          have more influence.
        </p>
        <p>
          <strong>Controls:</strong>
        </p>
        <ul>
          <li><strong>Grid Size:</strong> Adjusts the underlying data sampling resolution</li>
          <li><strong>Smoothness:</strong> Higher values create sharper transitions (more local), lower values create smoother gradients (more global)</li>
          <li><strong>Buildings Only:</strong> When checked, only shows data within building boundaries</li>
        </ul>
      </div>
    </div>
  );
}

export default AreaCharacteristics;
