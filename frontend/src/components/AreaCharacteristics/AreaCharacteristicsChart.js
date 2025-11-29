/**
 * AreaCharacteristicsChart - D3 Visualization Class
 */

import * as d3 from 'd3';

class AreaCharacteristicsChart {
  /**
   * Create a new chart instance.
   * @param {HTMLElement} container - The container element (usually an SVG ref)
   * @param {Object} controller - Callbacks to React for interactivity
   * @param {Function} controller.onCellHover - Called with cell data on hover
   * @param {Function} controller.onCellLeave - Called when mouse leaves cell
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
    
    // Set initial SVG dimensions (will be updated in update())
    this.svg
      .attr('width', '100%')
      .attr('height', 500);  // Default height, will be recalculated
    
    // Create main group for chart content
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    
    // Create defs for gradients and clip paths
    this.defs = this.svg.append('defs');
    
    // Create groups for layered rendering
    this.baseMapGroup = this.g.append('g').attr('class', 'basemap-layer');
    this.cellsGroup = this.g.append('g').attr('class', 'cells-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');
    this.legendGroup = this.svg.append('g').attr('class', 'legend-layer');
  }

  /**
   * Update the chart with new data.
   * Uses D3's data binding pattern for efficient updates.
   * 
   * @param {Object} params - Update parameters
   * @param {Array} params.cells - Array of cell data objects
   * @param {Object} params.bounds - { min_x, max_x, min_y, max_y }
   * @param {number} params.gridSize - Size of each grid cell
   * @param {Object} params.metricConfig - { label, id } for the current metric
   */
  update({ cells, bounds, gridSize, metricConfig }) {
    if (!cells || !bounds || cells.length === 0) return;

    // Calculate dimensions - get container width, fallback to reasonable default
    const containerElement = this.container.parentElement;
    let containerWidth = containerElement ? containerElement.clientWidth : 0;
    
    // If container has no width yet, use a default or try getBoundingClientRect
    if (containerWidth === 0 && containerElement) {
      const rect = containerElement.getBoundingClientRect();
      containerWidth = rect.width;
    }
    
    // Still no width? Use a sensible default
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
      .range([innerHeight, 0]); // Inverted for image coordinates

    // Color scale based on values
    const values = cells.map(c => c.value);
    this.scales.color = d3.scaleSequential(d3.interpolateViridis)
      .domain([d3.min(values), d3.max(values)]);

    // Render layers
    this.renderClipPath(innerWidth, innerHeight);
    this.renderBaseMap(innerWidth, innerHeight);
    this.renderCells(cells, gridSize);
    this.renderAxes(innerWidth, innerHeight);
    this.renderLegend(metricConfig, innerHeight, containerWidth);
  }

  /**
   * Create clip path to prevent cells from overflowing.
   */
  renderClipPath(width, height) {
    // Remove existing clip path
    this.defs.select('#chart-clip').remove();
    
    this.defs.append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);
    
    this.cellsGroup.attr('clip-path', 'url(#chart-clip)');
  }

  /**
   * Render the basemap image.
   */
  renderBaseMap(width, height) {
    // Use .join() pattern for enter/update/exit
    const image = this.baseMapGroup.selectAll('image')
      .data([1]); // Single element
    
    image.join(
      enter => enter.append('image')
        .attr('href', `${process.env.PUBLIC_URL}/BaseMap.png`)
        .attr('preserveAspectRatio', 'none')
        .attr('opacity', 0.4),
      update => update,
      exit => exit.remove()
    )
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', height);
  }

  /**
   * Render grid cells using D3 data binding.
   * This is the core of the visualization.
   */
  renderCells(cells, gridSize) {
    const { x: xScale, y: yScale, color: colorScale } = this.scales;
    const cellWidth = Math.abs(xScale(gridSize) - xScale(0));
    const cellHeight = Math.abs(yScale(0) - yScale(gridSize));

    // D3 data binding with .join() pattern
    // This efficiently handles enter (new cells), update (existing), and exit (removed)
    const cellRects = this.cellsGroup.selectAll('rect.cell')
      .data(cells, d => `${d.grid_x}-${d.grid_y}`); // Key function for object constancy

    cellRects.join(
      // ENTER: New cells being added
      enter => enter.append('rect')
        .attr('class', 'cell')
        .attr('opacity', 0) // Start invisible for transition
        .call(this.bindCellEvents.bind(this)),
      
      // UPDATE: Existing cells
      update => update,
      
      // EXIT: Cells being removed
      exit => exit
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()
    )
    // Apply attributes to both enter and update selections
    .attr('x', d => xScale(d.grid_x * gridSize))
    .attr('y', d => yScale((d.grid_y + 1) * gridSize))
    .attr('width', cellWidth)
    .attr('height', cellHeight)
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.5)
    .style('cursor', 'pointer')
    .transition()
    .duration(300)
    .attr('fill', d => colorScale(d.value))
    .attr('opacity', 0.7);
  }

  /**
   * Bind mouse events to cells.
   * Events callback to React via the controller.
   */
  bindCellEvents(selection) {
    const self = this;
    
    selection
      .on('mouseover', function(event, d) {
        // Highlight cell
        d3.select(this)
          .attr('stroke', '#000')
          .attr('stroke-width', 2)
          .attr('opacity', 0.9);
        
        // Callback to React
        self.controller.onCellHover(d, event);
      })
      .on('mousemove', function(event) {
        // Update tooltip position via controller
        self.controller.onMouseMove(event);
      })
      .on('mouseout', function() {
        // Reset cell style
        d3.select(this)
          .attr('stroke', '#fff')
          .attr('stroke-width', 0.5)
          .attr('opacity', 0.7);
        
        // Callback to React
        self.controller.onCellLeave();
      });
  }

  /**
   * Render X and Y axes.
   */
  renderAxes(width, height) {
    this.axesGroup.selectAll('*').remove();
    
    // X Axis
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

    // Y Axis
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
    const gradientId = 'legend-gradient';
    this.defs.select(`#${gradientId}`).remove();
    
    const gradient = this.defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    const colorDomain = this.scales.color.domain();
    const colorRange = d3.range(0, 1.01, 0.1);
    
    gradient.selectAll('stop')
      .data(colorRange)
      .join('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => 
        this.scales.color(colorDomain[0] + d * (colorDomain[1] - colorDomain[0]))
      );

    // Legend rectangle
    this.legendGroup.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', `url(#${gradientId})`);

    // Legend axis
    const legendScale = d3.scaleLinear()
      .domain(colorDomain)
      .range([legendHeight, 0]);

    this.legendGroup.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(d3.axisRight(legendScale).ticks(5));

    // Legend title
    this.legendGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(metricConfig?.label || 'Value');
  }

  /**
   * Resize the chart (e.g., on window resize).
   */
  resize() {
    // Re-render with current data would require storing last update params
    // For now, the React component handles this by calling update() again
  }

  /**
   * Clean up D3 resources.
   * Called when the React component unmounts.
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

export default AreaCharacteristicsChart;
