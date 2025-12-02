/**
 * FlowMapChart - D3 Visualization Class
 * Renders animated flow arcs between origin-destination cell pairs
 * with building context and cell intensity visualization
 */

import * as d3 from 'd3';

const positiveFlow = '#e67e22';
const negativeFlow = '#2980b9';

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
      .attr('height', '100%')
      .style('cursor', 'default')
      .on('click', (event) => {
        // Only clear selection if clicking directly on the SVG background
        if (event.target === this.container) {
          if (this.controller?.onCellClick) {
            // Pass null to indicate deselection
            this.controller.onCellClick({ cell_x: null, cell_y: null, _clear: true });
          }
        }
      });

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
  update({ flows, cells, buildings, bounds, showCells, showFlows, currentHour, maxTrips, maxFlowsToShow = 50, gridSize = 300, selectedCell = null }) {
    if (!bounds) return;

    // Store selectedCell for use in rendering
    this.selectedCell = selectedCell;

    // Detect if grid size changed - if so, clear cells and flows immediately (no transitions)
    const gridSizeChanged = this._lastGridSize !== undefined && this._lastGridSize !== gridSize;
    if (gridSizeChanged) {
      // Immediately clear all cells and flows without transitions
      this.cellsGroup.selectAll('*').interrupt().remove();
      this.flowsGroup.selectAll('*').interrupt().remove();
      this.defs.selectAll('linearGradient[id^="flow-gradient-"]').remove();
    }
    this._lastGridSize = gridSize;

    // Store gridSize for cell rendering
    this.gridSize = gridSize;

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
      this.renderFlows(flows, maxTrips, maxFlowsToShow);
    } else {
      this.flowsGroup.selectAll('*').remove();
      this.aggregationInfo = null;
      if (this.controller?.onAggregationChange) {
        this.controller.onAggregationChange(null);
      }
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
        .attr('fill', d => '#afafafb7')
        .attr('stroke', '#666')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.5)
        .attr('d', d => {
          const points = this.parsePolygon(d.location);
          if (!points || points.length < 3) return null;
          return points.map((p, i) => 
            `${i === 0 ? 'M' : 'L'}${this.scales.x(p.x)},${this.scales.y(p.y)}`
          ).join(' ') + ' Z';
        }),
      update => update
        .attr('fill', d => '#afafafb7')
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

    // Use the gridSize to compute cell positions from grid indices
    const gridSize = this.gridSize || 300;
    
    // Calculate max values for opacity scaling
    const maxAbsNetFlow = d3.max(cells, d => Math.abs(d.net_flow)) || 1;
    
    // Store maxAbsNetFlow for use in event handlers
    this._maxAbsNetFlow = maxAbsNetFlow;
    
    // Check if a cell is selected
    const selectedCell = this.selectedCell;
    const hasSelection = selectedCell !== null;

    // Helper to check if a cell is the selected one (uses current this.selectedCell)
    const isSelectedCell = (d) => {
      const sel = this.selectedCell;
      if (!sel) return false;
      return d.cell_x === sel.cell_x && d.cell_y === sel.cell_y;
    };

    // Helper to check if a cell is connected to the selected cell via flows (uses current this.selectedCell)
    const isConnectedCell = (d) => {
      const sel = this.selectedCell;
      if (!sel || !this._currentFlows) return false;
      return this._currentFlows.some(f => 
        (f.start_cell_x === sel.cell_x && f.start_cell_y === sel.cell_y &&
         f.end_cell_x === d.cell_x && f.end_cell_y === d.cell_y) ||
        (f.end_cell_x === sel.cell_x && f.end_cell_y === sel.cell_y &&
         f.start_cell_x === d.cell_x && f.start_cell_y === d.cell_y)
      );
    };

    // Calculate opacity for a cell based on selection state (uses current this.selectedCell)
    const getCellOpacity = (d) => {
      const maxNet = this._maxAbsNetFlow || 1;
      const baseMagnitude = Math.abs(d.net_flow) / maxNet;
      const baseOpacity = 0.15 + baseMagnitude * 0.65;
      
      const sel = this.selectedCell;
      if (!sel) return baseOpacity;
      if (isSelectedCell(d)) return 0.95;
      if (isConnectedCell(d)) return Math.max(baseOpacity, 0.7);
      return 0.1; // Dim unrelated cells
    };

    // Store these functions for use in event handlers
    this._isSelectedCell = isSelectedCell;
    this._isConnectedCell = isConnectedCell;
    this._getCellOpacity = getCellOpacity;

    const cellRects = this.cellsGroup.selectAll('rect.cell')
      .data(cells, d => `${d.cell_x}-${d.cell_y}`);

    // Reference to this for event handlers
    const self = this;

    cellRects.join(
      enter => enter.append('rect')
        .attr('class', 'cell')
        .attr('x', d => {
          // cell_x is the grid index, so the cell starts at cell_x * gridSize
          const cellStartX = d.cell_x * gridSize;
          return this.scales.x(cellStartX);
        })
        .attr('y', d => {
          // cell_y is the grid index, cell starts at cell_y * gridSize
          // Y scale is inverted, so we use the TOP of the cell (cell_y + 1) * gridSize
          const cellTopY = (d.cell_y + 1) * gridSize;
          return this.scales.y(cellTopY);
        })
        .attr('width', Math.abs(this.scales.x(gridSize) - this.scales.x(0)))
        .attr('height', Math.abs(this.scales.y(0) - this.scales.y(gridSize)))
        .attr('fill', d => {
          // Two colors: blue for origins (negative net flow), orange for destinations (positive)
          return d.net_flow >= 0 ? positiveFlow : negativeFlow;
        })
        .attr('stroke', d => {
          if (isSelectedCell(d)) return '#333';
          return d.net_flow >= 0 ? positiveFlow : negativeFlow;
        })
        .attr('stroke-width', d => isSelectedCell(d) ? 3 : 1)
        .attr('opacity', d => getCellOpacity(d))
        .attr('rx', 2)
        .attr('cursor', 'pointer')
        .on('mouseenter', function(event, d) {
          if (!self._isSelectedCell(d)) {
            d3.select(this)
              .attr('opacity', 0.9)
              .attr('stroke-width', 2);
          }
          if (self.controller?.onCellHover) {
            self.controller.onCellHover({ ...d, mouseX: event.offsetX, mouseY: event.offsetY });
          }
        })
        .on('mouseleave', function(event, d) {
          // Always restore to the correct opacity based on current selection state
          const opacity = self._getCellOpacity(d);
          const isSelected = self._isSelectedCell(d);
          d3.select(this)
            .attr('opacity', opacity)
            .attr('stroke-width', isSelected ? 3 : 1);
          if (self.controller?.onCellHover) {
            self.controller.onCellHover(null);
          }
        })
        .on('click', function(event, d) {
          event.stopPropagation();
          if (self.controller?.onCellClick) {
            self.controller.onCellClick(d);
          }
        }),
      update => {
        const maxAbsNetFlow = d3.max(cells, d => Math.abs(d.net_flow)) || 1;
        // Only transition color/opacity changes, not position (position only changes with grid size)
        return update
          .attr('fill', d => d.net_flow >= 0 ? positiveFlow : negativeFlow)
          .attr('stroke', d => {
            if (isSelectedCell(d)) return '#333';
            return d.net_flow >= 0 ? positiveFlow : negativeFlow;
          })
          .attr('stroke-width', d => isSelectedCell(d) ? 3 : 1)
          .attr('cursor', 'pointer')
          .transition()
          .duration(300)
          .attr('opacity', d => getCellOpacity(d));
      },
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
   * Create a unique gradient for a flow line.
   * Green at origin (start) -> Red at destination (end)
   */
  createFlowGradient(flow, index) {
    const gradientId = `flow-gradient-${index}`;
    const gridSize = this.gridSize || 300;
    
    // Remove existing gradient if present
    this.defs.select(`#${gradientId}`).remove();
    
    // Calculate centroid coordinates from cell indices for consistency
    const startCentroidX = flow.start_cell_x * gridSize + gridSize / 2;
    const startCentroidY = flow.start_cell_y * gridSize + gridSize / 2;
    const endCentroidX = flow.end_cell_x * gridSize + gridSize / 2;
    const endCentroidY = flow.end_cell_y * gridSize + gridSize / 2;
    
    const x1 = this.scales.x(startCentroidX);
    const y1 = this.scales.y(startCentroidY);
    const x2 = this.scales.x(endCentroidX);
    const y2 = this.scales.y(endCentroidY);
    
    const gradient = this.defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2);
    
    // Origin (start) color: green/cyan
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', negativeFlow)
      .attr('stop-opacity', 1);
    
    // // Middle transition
    // gradient.append('stop')
    //   .attr('offset', '50%')
    //   .attr('stop-color', '#ffaa00')
    //   .attr('stop-opacity', 1);
    
    // Destination (end) color: red/orange
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', positiveFlow)
      .attr('stop-opacity', 1);
    
    return `url(#${gradientId})`;
  }

  /**
   * Aggregate flows to reduce visual clutter during busy hours.
   * Groups flows and keeps only top N by volume, or aggregates nearby flows.
   */
  aggregateFlows(flows, maxFlowsToShow = 50) {
    if (flows.length <= maxFlowsToShow) {
      return { flows, isAggregated: false };
    }
    
    // Sort by trips (volume) descending and take top flows
    const sortedFlows = [...flows].sort((a, b) => b.trips - a.trips);
    const topFlows = sortedFlows.slice(0, maxFlowsToShow);
    
    // Calculate statistics about what was filtered
    const totalOriginal = flows.reduce((sum, f) => sum + f.trips, 0);
    const totalShown = topFlows.reduce((sum, f) => sum + f.trips, 0);
    const percentShown = Math.round((totalShown / totalOriginal) * 100);
    
    return {
      flows: topFlows,
      isAggregated: true,
      originalCount: flows.length,
      shownCount: topFlows.length,
      percentTripsShown: percentShown
    };
  }

  /**
   * Render flow arcs between origin-destination pairs.
   */
  renderFlows(flows, maxTrips, maxFlowsToShow = 50) {
    if (!flows || flows.length === 0) {
      this.flowsGroup.selectAll('*').remove();
      this._currentFlows = [];
      this.aggregationInfo = null;
      return;
    }

    // Aggregate flows if there are too many
    const { flows: displayFlows, isAggregated, originalCount, shownCount, percentTripsShown } = 
      this.aggregateFlows(flows, maxFlowsToShow);
    
    // Store current flows for cell connectivity checking
    this._currentFlows = displayFlows;
    
    // Store aggregation info for external display
    this.aggregationInfo = isAggregated ? {
      originalCount,
      shownCount,
      percentTripsShown
    } : null;
    
    // Notify controller about aggregation status
    if (this.controller?.onAggregationChange) {
      this.controller.onAggregationChange(this.aggregationInfo);
    }

    // Check if a cell is selected (for initial render)
    const selectedCell = this.selectedCell;
    const hasSelection = selectedCell !== null;

    // Helper to check if a flow is connected to the selected cell (uses current this.selectedCell)
    const isConnectedFlow = (d) => {
      const sel = this.selectedCell;
      if (!sel) return true; // No selection means all flows are "connected"
      return (d.start_cell_x === sel.cell_x && d.start_cell_y === sel.cell_y) ||
             (d.end_cell_x === sel.cell_x && d.end_cell_y === sel.cell_y);
    };

    // Calculate opacity for a flow based on selection state (uses current this.selectedCell)
    const getFlowOpacity = (d) => {
      const sel = this.selectedCell;
      if (!sel) return 0.8;
      if (isConnectedFlow(d)) return 0.95;
      return 0.08; // Dim unrelated flows
    };

    // Store these functions for use in event handlers
    this._isConnectedFlow = isConnectedFlow;
    this._getFlowOpacity = getFlowOpacity;

    // Clear old gradients
    this.defs.selectAll('linearGradient[id^="flow-gradient-"]').remove();

    // Width scale for flow arcs (log scale to handle large variations)
    const widthScale = d3.scaleLog()
      .domain([1, maxTrips || 100])
      .range([1.5, 10])
      .clamp(true);
    
    // Store widthScale for event handlers
    this._flowWidthScale = widthScale;

    // Create gradients for each flow
    displayFlows.forEach((flow, index) => {
      this.createFlowGradient(flow, index);
    });

    const flowPaths = this.flowsGroup.selectAll('path.flow')
      .data(displayFlows, d => `${d.start_cell_x}-${d.start_cell_y}-${d.end_cell_x}-${d.end_cell_y}`);

    const gridSize = this.gridSize || 300;
    
    // Reference to this for event handlers
    const self = this;

    flowPaths.join(
      enter => enter.append('path')
        .attr('class', 'flow')
        .attr('d', d => {
          // Calculate centroids from cell indices for consistency
          const startCentroidX = d.start_cell_x * gridSize + gridSize / 2;
          const startCentroidY = d.start_cell_y * gridSize + gridSize / 2;
          const endCentroidX = d.end_cell_x * gridSize + gridSize / 2;
          const endCentroidY = d.end_cell_y * gridSize + gridSize / 2;
          
          const x1 = this.scales.x(startCentroidX);
          const y1 = this.scales.y(startCentroidY);
          const x2 = this.scales.x(endCentroidX);
          const y2 = this.scales.y(endCentroidY);
          return this.generateBezierPath(x1, y1, x2, y2);
        })
        .attr('fill', 'none')
        .attr('stroke', (d, i) => `url(#flow-gradient-${i})`)
        .attr('stroke-width', d => isConnectedFlow(d) && hasSelection ? widthScale(d.trips) * 1.3 : widthScale(d.trips))
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .attr('filter', d => isConnectedFlow(d) || !hasSelection ? 'url(#flow-glow)' : 'none')
        .on('mouseenter', function(event, d) {
          d3.select(this)
            .attr('opacity', 1)
            .attr('stroke-width', self._flowWidthScale(d.trips) * 1.5);
          if (self.controller?.onFlowHover) {
            self.controller.onFlowHover({ ...d, mouseX: event.offsetX, mouseY: event.offsetY });
          }
        })
        .on('mouseleave', function(event, d) {
          // Always restore to the correct opacity based on current selection state
          const opacity = self._getFlowOpacity(d);
          const isConnected = self._isConnectedFlow(d);
          const hasSel = self.selectedCell !== null;
          d3.select(this)
            .attr('opacity', opacity)
            .attr('stroke-width', isConnected && hasSel ? self._flowWidthScale(d.trips) * 1.3 : self._flowWidthScale(d.trips));
          if (self.controller?.onFlowHover) {
            self.controller.onFlowHover(null);
          }
        })
        .transition()
        .duration(500)
        .attr('opacity', d => getFlowOpacity(d)),
      update => {
        // Update gradients for existing flows
        update.each((d, i) => {
          this.createFlowGradient(d, i);
        });
        const gridSize = this.gridSize || 300;
        return update
          .transition()
          .duration(300)
          .attr('d', d => {
            const startCentroidX = d.start_cell_x * gridSize + gridSize / 2;
            const startCentroidY = d.start_cell_y * gridSize + gridSize / 2;
            const endCentroidX = d.end_cell_x * gridSize + gridSize / 2;
            const endCentroidY = d.end_cell_y * gridSize + gridSize / 2;
            
            const x1 = this.scales.x(startCentroidX);
            const y1 = this.scales.y(startCentroidY);
            const x2 = this.scales.x(endCentroidX);
            const y2 = this.scales.y(endCentroidY);
            return this.generateBezierPath(x1, y1, x2, y2);
          })
          .attr('stroke', (d, i) => `url(#flow-gradient-${i})`)
          .attr('stroke-width', d => isConnectedFlow(d) && hasSelection ? widthScale(d.trips) * 1.3 : widthScale(d.trips))
          .attr('filter', d => isConnectedFlow(d) || !hasSelection ? 'url(#flow-glow)' : 'none')
          .attr('opacity', d => getFlowOpacity(d));
      },
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
