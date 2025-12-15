/**
 * TrafficDensityChart - D3 Visualization Class
 * Renders individual trip lines (origin to destination) without aggregation.
 * Uses thin, semi-transparent lines where overlapping creates density effect.
 */

import * as d3 from 'd3';

const lineColor = '#1e5a8e'; // Darker blue for white background

class TrafficDensityChart {
  /**
   * Create a new chart instance.
   * @param {HTMLElement} container - The container element (SVG ref)
   * @param {Object} controller - Callbacks to React for interactivity
   */
  constructor(container, controller) {
    this.container = container;
    this.controller = controller;
    this.svg = null;
    this.g = null;
    this.scales = {};
    this.dimensions = {};

    this.margin = { top: 20, right: 20, bottom: 40, left: 60 };

    // Building type colors
    this.buildingColors = {
      'Commercial': '#e74c3c',
      'Residential': '#3498db',
      'Residental': '#3498db', // Handle typo in data
      'School': '#2ecc71',
    };
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    // Prevent double initialization
    if (this.initialized) {
      return;
    }
    
    this.svg = d3.select(this.container);
    this.svg.selectAll('*').remove();

    this.svg
      .attr('width', '100%')
      .attr('height', '100%')
      .style('cursor', 'default');

    // Create defs for any filters
    this.defs = this.svg.append('defs');

    // Create main group for chart content
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Create groups for layered rendering (order matters for z-index)
    this.baseMapGroup = this.g.append('g').attr('class', 'basemap-layer');
    this.buildingsGroup = this.g.append('g').attr('class', 'buildings-layer');
    this.linesGroup = this.g.append('g').attr('class', 'lines-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');
    
    this.initialized = true;
  }

  /**
   * Update the chart with new data.
   */
  update({ trips, buildings, bounds, currentHour, lineOpacity = 0.05, lineWidth = 0.5, showBuildings = true }) {
    if (!bounds) return;

    // Calculate dimensions
    const containerElement = this.container.parentElement;
    let containerWidth = containerElement ? containerElement.clientWidth : 800;
    let containerHeight = containerElement ? containerElement.clientHeight : 600;
    
    if (containerWidth === 0) {
      const rect = containerElement?.getBoundingClientRect();
      containerWidth = rect?.width || 800;
      containerHeight = rect?.height || 600;
    }

    const dataWidth = bounds.max_x - bounds.min_x;
    const dataHeight = bounds.max_y - bounds.min_y;
    const dataAspectRatio = dataWidth / dataHeight;

    const innerWidth = containerWidth - this.margin.left - this.margin.right;
    const innerHeight = Math.min(
      containerHeight - this.margin.top - this.margin.bottom,
      innerWidth / dataAspectRatio
    );
    const height = innerHeight + this.margin.top + this.margin.bottom;

    this.dimensions = { 
      width: containerWidth, 
      height, 
      innerWidth, 
      innerHeight 
    };

    // Update SVG size
    this.svg
      .attr('width', containerWidth)
      .attr('height', height);

    // Update scales
    this.scales.x = d3.scaleLinear()
      .domain([bounds.min_x, bounds.max_x])
      .range([0, innerWidth]);

    this.scales.y = d3.scaleLinear()
      .domain([bounds.min_y, bounds.max_y])
      .range([innerHeight, 0]);

    // Render layers
    // Base map removed - not needed
    
    if (showBuildings) {
      this.renderBuildings(buildings);
    } else {
      this.buildingsGroup.selectAll('*').remove();
    }
    
    this.renderLines(trips, lineOpacity, lineWidth);
    this.renderAxes(innerWidth, innerHeight);
  }

  /**
   * Render the basemap image.
   */
  renderBaseMap(width, height) {
    const image = this.baseMapGroup.selectAll('image')
      .data([1]);
  
    image.join(
      enter => enter.append('image')
        .attr('href', `${process.env.PUBLIC_URL || ''}/BaseMap.png`)
        .attr('opacity', 0.4),
      update => update,
      exit => exit.remove()
    )
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', height)
    .attr('preserveAspectRatio', 'none');
  }

  /**
   * Parse a PostgreSQL polygon string.
   */
  parsePolygon(polygonStr) {
    if (!polygonStr) return null;
    try {
      const cleaned = polygonStr.replace(/^\(\(/, '').replace(/\)\)$/, '');
      const pointStrings = cleaned.split('),(');
      return pointStrings.map(pointStr => {
        const [x, y] = pointStr.replace(/[()]/g, '').split(',').map(Number);
        return { x, y };
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * Render buildings as context layer.
   */
  renderBuildings(buildings) {
    if (!buildings || buildings.length === 0) {
      this.buildingsGroup.selectAll('*').remove();
      return;
    }

    const polygons = this.buildingsGroup.selectAll('path.building')
      .data(buildings, d => d.buildingid);

    polygons.join(
      enter => enter.append('path')
        .attr('class', 'building')
        .attr('fill', '#d0d0d0')
        .attr('stroke', '#999999')
        .attr('stroke-width', 0.8)
        .attr('opacity', 0.6)
        .attr('d', d => {
          const points = this.parsePolygon(d.location);
          if (!points || points.length < 3) return null;
          return points.map((p, i) => 
            `${i === 0 ? 'M' : 'L'}${this.scales.x(p.x)},${this.scales.y(p.y)}`
          ).join(' ') + ' Z';
        }),
      update => update
        .attr('fill', '#d0d0d0')
        .attr('stroke', '#999999')
        .attr('d', d => {
          const points = this.parsePolygon(d.location);
          if (!points || points.length < 3) return null;
          return points.map((p, i) => 
            `${i === 0 ? 'M' : 'L'}${this.scales.x(p.x)},${this.scales.y(p.y)}`
          ).join(' ') + ' Z';
        }),
      exit => exit.remove()
    );
  }

  /**
   * Generate a Bezier curve path between two points.
   */
  generateBezierPath(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Control point offset perpendicular to the line
    const curvature = Math.min(0.3, distance / 600);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    // Perpendicular offset for the control point
    const perpX = -dy * curvature;
    const perpY = dx * curvature;
    
    const ctrlX = midX + perpX;
    const ctrlY = midY + perpY;
    
    return `M${x1},${y1} Q${ctrlX},${ctrlY} ${x2},${y2}`;
  }

  /**
   * Render all individual trip lines.
   * Lines are thin and semi-transparent so density is visible through overlapping.
   */
  renderLines(trips, lineOpacity, lineWidth) {
    if (!trips || trips.length === 0) {
      this.linesGroup.selectAll('*').remove();
      if (this.controller?.onLinesCountChange) {
        this.controller.onLinesCountChange(0);
      }
      return;
    }

    // Notify about the number of lines
    if (this.controller?.onLinesCountChange) {
      this.controller.onLinesCountChange(trips.length);
    }

    // Clear and redraw all lines at once (using a single path for performance)
    // For very large datasets, we batch the lines
    this.linesGroup.selectAll('*').remove();

    const batchSize = 5000;
    const numBatches = Math.ceil(trips.length / batchSize);

    for (let batch = 0; batch < numBatches; batch++) {
      const startIdx = batch * batchSize;
      const endIdx = Math.min((batch + 1) * batchSize, trips.length);
      const batchTrips = trips.slice(startIdx, endIdx);

      // Create curved paths for this batch
      const lines = this.linesGroup.selectAll(`path.trip-line-batch-${batch}`)
        .data(batchTrips);

      lines.enter()
        .append('path')
        .attr('class', `trip-line trip-line-batch-${batch}`)
        .attr('d', d => {
          const x1 = this.scales.x(d.start_x);
          const y1 = this.scales.y(d.start_y);
          const x2 = this.scales.x(d.end_x);
          const y2 = this.scales.y(d.end_y);
          return this.generateBezierPath(x1, y1, x2, y2);
        })
        .attr('fill', 'none')
        .attr('stroke', lineColor)
        .attr('stroke-width', lineWidth)
        .attr('stroke-opacity', lineOpacity)
        .attr('stroke-linecap', 'round');
    }
  }

  /**
   * Render axes.
   */
  renderAxes(width, height) {
    // X axis
    const xAxis = d3.axisBottom(this.scales.x)
      .ticks(5)
      .tickFormat(d => `${Math.round(d)}m`);

    this.axesGroup.selectAll('.x-axis').remove();
    this.axesGroup.append('g')
      .attr('class', 'x-axis axis')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis);

    // Y axis
    const yAxis = d3.axisLeft(this.scales.y)
      .ticks(5)
      .tickFormat(d => `${Math.round(d)}m`);

    this.axesGroup.selectAll('.y-axis').remove();
    this.axesGroup.append('g')
      .attr('class', 'y-axis axis')
      .call(yAxis);
  }

  /**
   * Cleanup - don't remove DOM nodes, React handles that.
   * Just clear references to prevent memory leaks.
   */
  destroy() {
    this.initialized = false;
    this.svg = null;
    this.mainGroup = null;
    this.buildingsGroup = null;
    this.linesGroup = null;
    this.scales = null;
  }
}

export { TrafficDensityChart };
