/**
 * FlowMapChart - D3 Visualization Class
 * Renders animated flow arcs between origin-destination cell pairs
 * with building context and cell intensity visualization
 */

import * as d3 from 'd3';

class FlowMapChart {
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

    // Flow color scale (by purpose or volume)
    this.flowColorScale = d3.scaleSequential(d3.interpolateYlOrRd);
    
    // Cell color scales
    this.originColorScale = d3.scaleSequential(d3.interpolateBlues);
    this.destColorScale = d3.scaleSequential(d3.interpolateOranges);
    this.netFlowColorScale = d3.scaleDiverging(d3.interpolateRdBu);
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    this.svg = d3.select(this.container);
    this.svg.selectAll('*').remove();

    this.svg
      .attr('width', '100%')
      .attr('height', '100%');

    // Create defs for gradients, markers, and filters
    this.defs = this.svg.append('defs');
    
    // Add glow filter for flows
    const glowFilter = this.defs.append('filter')
      .attr('id', 'flow-glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '2')
      .attr('result', 'coloredBlur');
    
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Arrow marker for flow direction
    this.defs.append('marker')
      .attr('id', 'flow-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#ff6b35');

    // Create main group for chart content
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Create groups for layered rendering (order matters for z-index)
    this.buildingsGroup = this.g.append('g').attr('class', 'buildings-layer');
    this.cellsGroup = this.g.append('g').attr('class', 'cells-layer');
    this.flowsGroup = this.g.append('g').attr('class', 'flows-layer');
    this.labelsGroup = this.g.append('g').attr('class', 'labels-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');
  }

  /**
   * Update the chart with new data.
   */
  update({ flows, cells, buildings, bounds, showCells, showFlows, currentHour, maxTrips }) {
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

    // Update color scales
    this.flowColorScale.domain([0, maxTrips || 100]);
    
    const maxDepartures = cells?.length ? d3.max(cells, d => d.departures) || 100 : 100;
    const maxArrivals = cells?.length ? d3.max(cells, d => d.arrivals) || 100 : 100;
    const maxNetFlow = cells?.length ? d3.max(cells, d => Math.abs(d.net_flow)) || 50 : 50;
    
    this.originColorScale.domain([0, maxDepartures]);
    this.destColorScale.domain([0, maxArrivals]);
    this.netFlowColorScale.domain([-maxNetFlow, 0, maxNetFlow]);

    // Render layers
    this.renderBuildings(buildings);
    
    if (showCells && cells) {
      this.renderCells(cells);
    } else {
      this.cellsGroup.selectAll('*').remove();
    }
    
    if (showFlows && flows) {
      this.renderFlows(flows, maxTrips);
    } else {
      this.flowsGroup.selectAll('*').remove();
    }
    
    this.renderAxes(innerWidth, innerHeight);
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
        .attr('fill', d => this.buildingColors[d.buildingtype] || '#95a5a6')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.3)
        .attr('d', d => {
          const points = this.parsePolygon(d.location);
          if (!points || points.length < 3) return null;
          return points.map((p, i) => 
            `${i === 0 ? 'M' : 'L'}${this.scales.x(p.x)},${this.scales.y(p.y)}`
          ).join(' ') + ' Z';
        }),
      update => update
        .attr('fill', d => this.buildingColors[d.buildingtype] || '#95a5a6')
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
   * Render cells showing origin/destination intensity.
   */
  renderCells(cells) {
    if (!cells || cells.length === 0) {
      this.cellsGroup.selectAll('*').remove();
      return;
    }

    // Calculate cell size based on grid
    const cellPixelSize = Math.abs(this.scales.x(300) - this.scales.x(0));

    const cellRects = this.cellsGroup.selectAll('rect.cell')
      .data(cells, d => `${d.cell_x}-${d.cell_y}`);

    cellRects.join(
      enter => enter.append('rect')
        .attr('class', 'cell')
        .attr('x', d => this.scales.x(d.x) - cellPixelSize / 2)
        .attr('y', d => this.scales.y(d.y) - cellPixelSize / 2)
        .attr('width', cellPixelSize)
        .attr('height', cellPixelSize)
        .attr('fill', d => {
          // Color by net flow: blue for origins (negative), orange for destinations (positive)
          if (d.net_flow > 0) {
            return this.destColorScale(d.arrivals);
          } else if (d.net_flow < 0) {
            return this.originColorScale(d.departures);
          }
          return '#ccc';
        })
        .attr('stroke', d => d.net_flow > 0 ? '#e67e22' : '#2980b9')
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)
        .attr('rx', 4)
        .on('mouseenter', (event, d) => {
          d3.select(event.target)
            .attr('opacity', 0.8)
            .attr('stroke-width', 2);
          if (this.controller?.onCellHover) {
            this.controller.onCellHover({ ...d, mouseX: event.offsetX, mouseY: event.offsetY });
          }
        })
        .on('mouseleave', (event, d) => {
          d3.select(event.target)
            .attr('opacity', 0.5)
            .attr('stroke-width', 1);
          if (this.controller?.onCellHover) {
            this.controller.onCellHover(null);
          }
        }),
      update => update
        .transition()
        .duration(300)
        .attr('x', d => this.scales.x(d.x) - cellPixelSize / 2)
        .attr('y', d => this.scales.y(d.y) - cellPixelSize / 2)
        .attr('width', cellPixelSize)
        .attr('height', cellPixelSize)
        .attr('fill', d => {
          if (d.net_flow > 0) {
            return this.destColorScale(d.arrivals);
          } else if (d.net_flow < 0) {
            return this.originColorScale(d.departures);
          }
          return '#ccc';
        }),
      exit => exit
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()
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
    const curvature = Math.min(0.4, distance / 500);
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
   * Render flow arcs between origin-destination pairs.
   */
  renderFlows(flows, maxTrips) {
    if (!flows || flows.length === 0) {
      this.flowsGroup.selectAll('*').remove();
      return;
    }

    // Width scale for flow arcs (log scale to handle large variations)
    const widthScale = d3.scaleLog()
      .domain([1, maxTrips || 100])
      .range([1, 12])
      .clamp(true);

    // Color scale for flow volume
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, maxTrips || 100]);

    const flowPaths = this.flowsGroup.selectAll('path.flow')
      .data(flows, d => `${d.start_cell_x}-${d.start_cell_y}-${d.end_cell_x}-${d.end_cell_y}`);

    flowPaths.join(
      enter => enter.append('path')
        .attr('class', 'flow')
        .attr('d', d => {
          const x1 = this.scales.x(d.start_x);
          const y1 = this.scales.y(d.start_y);
          const x2 = this.scales.x(d.end_x);
          const y2 = this.scales.y(d.end_y);
          return this.generateBezierPath(x1, y1, x2, y2);
        })
        .attr('fill', 'none')
        .attr('stroke', d => colorScale(d.trips))
        .attr('stroke-width', d => widthScale(d.trips))
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .attr('filter', 'url(#flow-glow)')
        .on('mouseenter', (event, d) => {
          d3.select(event.target)
            .attr('opacity', 1)
            .attr('stroke-width', d => widthScale(d.trips) * 1.5);
          if (this.controller?.onFlowHover) {
            this.controller.onFlowHover({ ...d, mouseX: event.offsetX, mouseY: event.offsetY });
          }
        })
        .on('mouseleave', (event, d) => {
          d3.select(event.target)
            .attr('opacity', 0.7)
            .attr('stroke-width', d => widthScale(d.trips));
          if (this.controller?.onFlowHover) {
            this.controller.onFlowHover(null);
          }
        })
        .transition()
        .duration(500)
        .attr('opacity', 0.7),
      update => update
        .transition()
        .duration(300)
        .attr('d', d => {
          const x1 = this.scales.x(d.start_x);
          const y1 = this.scales.y(d.start_y);
          const x2 = this.scales.x(d.end_x);
          const y2 = this.scales.y(d.end_y);
          return this.generateBezierPath(x1, y1, x2, y2);
        })
        .attr('stroke', d => colorScale(d.trips))
        .attr('stroke-width', d => widthScale(d.trips)),
      exit => exit
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()
    );

    // Add animated flow particles along the paths
    this.animateFlowParticles(flows, widthScale);
  }

  /**
   * Animate particles along flow paths to show direction.
   */
  animateFlowParticles(flows, widthScale) {
    // Only animate top flows to keep performance reasonable
    const topFlows = flows
      .slice()
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 20);

    const particles = this.flowsGroup.selectAll('circle.flow-particle')
      .data(topFlows, d => `particle-${d.start_cell_x}-${d.start_cell_y}-${d.end_cell_x}-${d.end_cell_y}`);

    particles.join(
      enter => enter.append('circle')
        .attr('class', 'flow-particle')
        .attr('r', d => Math.max(2, widthScale(d.trips) / 3))
        .attr('fill', '#fff')
        .attr('opacity', 0.8)
        .each(function(d) {
          const self = d3.select(this);
          const x1 = d.start_x;
          const y1 = d.start_y;
          const x2 = d.end_x;
          const y2 = d.end_y;
          
          // Animate along the path
          function animate() {
            self
              .attr('cx', d => d3.select(this.parentNode.parentNode).select('.chart-content').node() ? 
                parseFloat(d3.select(this.parentNode).datum()?.start_x) : x1)
              .transition()
              .duration(2000 + Math.random() * 1000)
              .ease(d3.easeLinear)
              .attrTween('cx', () => t => {
                const scales = d3.select(this).node().__scales__;
                if (!scales) return 0;
                return scales.x(x1 + (x2 - x1) * t);
              })
              .attrTween('cy', () => t => {
                const scales = d3.select(this).node().__scales__;
                if (!scales) return 0;
                // Add slight curve to match bezier
                const baseY = y1 + (y2 - y1) * t;
                const curveOffset = Math.sin(t * Math.PI) * ((y2 - y1) * 0.2);
                return scales.y(baseY + curveOffset);
              })
              .on('end', animate);
          }
          
          // Store scales reference on element
          this.__scales__ = { x: this.scales?.x, y: this.scales?.y };
        }),
      update => update,
      exit => exit.remove()
    );
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
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis);

    // Y axis
    const yAxis = d3.axisLeft(this.scales.y)
      .ticks(5)
      .tickFormat(d => `${Math.round(d)}m`);

    this.axesGroup.selectAll('.y-axis').remove();
    this.axesGroup.append('g')
      .attr('class', 'y-axis')
      .call(yAxis);
  }

  /**
   * Cleanup - don't remove DOM nodes, React handles that.
   * Just clear references to prevent memory leaks.
   */
  destroy() {
    this.svg = null;
    this.mainGroup = null;
    this.buildingsGroup = null;
    this.cellsGroup = null;
    this.flowsGroup = null;
    this.scales = null;
  }
}

export { FlowMapChart };
