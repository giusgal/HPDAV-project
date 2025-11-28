/**
 * TrafficPatternsChart - D3 Visualization Class
 * 
 * Renders a heatmap of traffic patterns with building polygons as basemap.
 */

import * as d3 from 'd3';

class TrafficPatternsChart {
  /**
   * Create a new chart instance.
   * @param {HTMLElement} container - The SVG container element
   * @param {Object} controller - Callbacks to React for interactivity
   * @param {Function} controller.onCellHover - Called with cell data on hover
   * @param {Function} controller.onCellLeave - Called when mouse leaves cell
   * @param {Function} controller.onMouseMove - Called on mouse move for tooltip positioning
   * @param {Function} controller.getTooltipRef - Returns the tooltip DOM element
   */
  constructor(container, controller) {
    this.container = container;
    this.controller = controller;
    this.svg = null;
    this.g = null;
    this.scales = {};
    this.dimensions = {};
    
    this.margin = { top: 20, right: 120, bottom: 40, left: 60 };
  }

  /**
   * Initialize the SVG structure.
   * Called once when the component mounts.
   */
  initialize() {
    this.svg = d3.select(this.container);
    this.svg.selectAll('*').remove();
    
    this.svg
      .attr('width', '100%')
      .attr('height', 500);
    
    // Create defs for gradients and clip paths
    this.defs = this.svg.append('defs');
    
    // Create main group for chart content
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    
    // Create groups for layered rendering
    this.baseMapGroup = this.g.append('g').attr('class', 'basemap-layer');
    this.cellsGroup = this.g.append('g').attr('class', 'cells-layer');
    this.bottleneckGroup = this.g.append('g').attr('class', 'bottleneck-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');
    this.legendGroup = this.svg.append('g').attr('class', 'legend-layer');
  }

  /**
   * Update the chart with new data.
   * 
   * @param {Object} params - Update parameters
   * @param {Array} params.cells - Array of cell data objects
   * @param {Object} params.bounds - { min_x, max_x, min_y, max_y }
   * @param {number} params.gridSize - Size of each grid cell
   * @param {Object} params.metricConfig - { label, id } for the current metric
   * @param {boolean} params.showBottlenecks - Whether to highlight bottleneck cells
   * @param {Object} params.statistics - Statistics for bottleneck calculation
   * @param {Object} params.buildingsData - Building polygon data
   */
  update({ cells, bounds, gridSize, metricConfig, showBottlenecks, statistics, buildingsData }) {
    if (!cells || !bounds || cells.length === 0) return;

    // Calculate dimensions
    const containerElement = this.container.parentElement;
    let containerWidth = containerElement ? containerElement.clientWidth : 0;
    
    if (containerWidth === 0 && containerElement) {
      const rect = containerElement.getBoundingClientRect();
      containerWidth = rect.width;
    }
    
    if (containerWidth === 0) {
      containerWidth = 800;
    }
    
    const dataWidth = bounds.max_x - bounds.min_x;
    const dataHeight = bounds.max_y - bounds.min_y;
    const dataAspectRatio = dataWidth / dataHeight;

    const innerWidth = containerWidth - this.margin.left - this.margin.right;
    const innerHeight = innerWidth / dataAspectRatio;
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

    // Color scale based on values
    const values = cells.map(c => c.value);
    this.scales.color = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, d3.max(values)]);

    // Store current options for event handlers
    this.currentOptions = { showBottlenecks, statistics };

    // Render layers
    this.renderClipPath(innerWidth, innerHeight);
    this.renderBaseMap(buildingsData, innerWidth, innerHeight);
    this.renderCells(cells, gridSize, showBottlenecks);
    this.renderBottleneckMarkers(cells, gridSize, showBottlenecks, statistics);
    this.renderAxes(innerWidth, innerHeight);
    this.renderLegend(metricConfig, innerHeight, containerWidth);
  }

  /**
   * Create clip path to prevent cells from overflowing.
   */
  renderClipPath(width, height) {
    this.defs.select('#traffic-clip').remove();
    
    this.defs.append('clipPath')
      .attr('id', 'traffic-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);
    
    this.baseMapGroup.attr('clip-path', 'url(#traffic-clip)');
    this.cellsGroup.attr('clip-path', 'url(#traffic-clip)');
    this.bottleneckGroup.attr('clip-path', 'url(#traffic-clip)');
  }

  /**
   * Parse PostgreSQL polygon string to array of points.
   * Format: ((x1,y1),(x2,y2),...)
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
      console.warn('Failed to parse polygon:', polygonStr, e);
      return null;
    }
  }

  /**
   * Render building polygons as basemap.
   */
  renderBaseMap(buildingsData, width, height) {
    this.baseMapGroup.selectAll('*').remove();
    
    if (!buildingsData?.buildings) return;

    const { x: xScale, y: yScale } = this.scales;
    
    const lineGenerator = d3.line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveLinearClosed);

    const buildingsWithPaths = buildingsData.buildings
      .map(b => ({ ...b, points: this.parsePolygon(b.location) }))
      .filter(b => b.points && b.points.length >= 3);

    this.baseMapGroup.selectAll('path.building')
      .data(buildingsWithPaths)
      .join('path')
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

  /**
   * Render grid cells using D3 data binding.
   */
  renderCells(cells, gridSize, showBottlenecks) {
    const { x: xScale, y: yScale, color: colorScale } = this.scales;
    const cellWidth = Math.abs(xScale(gridSize) - xScale(0));
    const cellHeight = Math.abs(yScale(0) - yScale(gridSize));

    // Clear all existing cells and redraw
    this.cellsGroup.selectAll('rect.cell').remove();

    this.cellsGroup.selectAll('rect.cell')
      .data(cells)
      .join('rect')
      .attr('class', 'cell')
      .attr('x', d => xScale(Number(d.grid_x) * gridSize))
      .attr('y', d => yScale((Number(d.grid_y) + 1) * gridSize))
      .attr('width', cellWidth)
      .attr('height', cellHeight)
      .attr('fill', d => colorScale(d.value))
      .attr('opacity', 0.7)
      .attr('stroke', d => (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#fff')
      .attr('stroke-width', d => (showBottlenecks && d.isBottleneck) ? 2 : 0.5)
      .style('cursor', 'pointer')
      .call(this.bindCellEvents.bind(this));
  }

  /**
   * Render bottleneck markers for cells in top 10%.
   */
  renderBottleneckMarkers(cells, gridSize, showBottlenecks, statistics) {
    this.bottleneckGroup.selectAll('*').remove();
    
    if (!showBottlenecks || !statistics) return;

    const { x: xScale, y: yScale } = this.scales;
    const bottlenecks = cells.filter(c => c.isBottleneck);

    this.bottleneckGroup.selectAll('circle.bottleneck-marker')
      .data(bottlenecks)
      .join('circle')
      .attr('class', 'bottleneck-marker')
      // Center of cell: (grid_x + 0.5) * gridSize, (grid_y + 0.5) * gridSize
      .attr('cx', d => xScale((d.grid_x + 0.5) * gridSize))
      .attr('cy', d => yScale((d.grid_y + 0.5) * gridSize))
      .attr('r', 8)
      .attr('fill', 'none')
      .attr('stroke', '#ff0000')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2');
  }

  /**
   * Bind mouse events to cells.
   */
  bindCellEvents(selection) {
    const self = this;
    
    selection
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('stroke', '#000')
          .attr('stroke-width', 2);
        
        self.controller.onCellHover(d, event);
      })
      .on('mousemove', function(event) {
        self.controller.onMouseMove(event);
      })
      .on('mouseout', function(event, d) {
        const { showBottlenecks } = self.currentOptions || {};
        d3.select(this)
          .attr('stroke', (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#fff')
          .attr('stroke-width', (showBottlenecks && d.isBottleneck) ? 2 : 0.5);
        
        self.controller.onCellLeave();
      });
  }

  /**
   * Render X and Y axes.
   */
  renderAxes(width, height) {
    this.axesGroup.selectAll('*').remove();
    
    const xAxisGroup = this.axesGroup.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(this.scales.x).ticks(5));
    
    xAxisGroup.append('text')
      .attr('x', width / 2)
      .attr('y', 35)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('X Coordinate');

    const yAxisGroup = this.axesGroup.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(this.scales.y).ticks(5));
    
    yAxisGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -height / 2)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('Y Coordinate');
  }

  /**
   * Render the color legend.
   */
  renderLegend(metricConfig, height, containerWidth) {
    this.legendGroup.selectAll('*').remove();
    
    const legendWidth = 20;
    const legendHeight = height - this.margin.top - this.margin.bottom;
    
    this.legendGroup.attr('transform', 
      `translate(${containerWidth - this.margin.right + 20},${this.margin.top})`);

    // Create gradient
    const gradientId = 'traffic-gradient';
    this.defs.select(`#${gradientId}`).remove();
    
    const gradient = this.defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    const colorDomain = this.scales.color.domain();
    
    gradient.selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .join('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => this.scales.color(d * colorDomain[1]));

    this.legendGroup.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', `url(#${gradientId})`);

    const legendScale = d3.scaleLinear()
      .domain(colorDomain)
      .range([legendHeight, 0]);

    this.legendGroup.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(d3.axisRight(legendScale).ticks(5));

    this.legendGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(metricConfig?.label || 'Value');
  }

  /**
   * Clean up D3 resources.
   */
  destroy() {
    if (this.svg) {
      this.svg.selectAll('*').remove();
    }
    this.svg = null;
    this.g = null;
    this.scales = {};
  }
}

/**
 * HourlyChart - D3 Visualization Class for hourly distribution.
 */
class HourlyChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 20, right: 20, bottom: 30, left: 50 };
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ hourlyData }) {
    if (!hourlyData || hourlyData.length === 0) return;

    const container = this.container;
    const width = container.clientWidth;
    const height = 150;
    const { top, right, bottom, left } = this.margin;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${left},${top})`);

    const xScale = d3.scaleBand()
      .domain(hourlyData.map(d => d.hour))
      .range([0, innerWidth])
      .padding(0.1);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(hourlyData, d => d.visits)])
      .range([innerHeight, 0]);

    const maxVisits = d3.max(hourlyData, d => d.visits);

    g.selectAll('rect')
      .data(hourlyData)
      .join('rect')
      .attr('x', d => xScale(d.hour))
      .attr('y', d => yScale(d.visits))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerHeight - yScale(d.visits))
      .attr('fill', d => {
        if (d.visits > maxVisits * 0.8) return '#d62728';
        if (d.visits > maxVisits * 0.6) return '#ff7f0e';
        return '#1f77b4';
      });

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
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

export { TrafficPatternsChart, HourlyChart };
export default TrafficPatternsChart;
