/**
 * BuildingsMapChart - D3 Visualization Class
 * Renders building polygons and venue location points
 */

import * as d3 from 'd3';

class BuildingsMapChart {
  /**
   * Create a new chart instance.
   * @param {HTMLElement} container - The container element (usually an SVG ref)
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

    // Venue colors matching React component
    this.venueColors = {
      apartments: '#3498db',
      employers: '#e74c3c',
      pubs: '#9b59b6',
      restaurants: '#f39c12',
      schools: '#2ecc71',
    };
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    this.svg = d3.select(this.container);
    this.svg.selectAll('*').remove();

    this.svg
      .attr('width', '100%')
      .attr('height', 500);

    // Create main group for chart content
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Create defs for gradients and clip paths
    this.defs = this.svg.append('defs');

    // Create groups for layered rendering (order matters for z-index)
    this.baseMapGroup = this.g.append('g').attr('class', 'basemap-layer');
    this.buildingsGroup = this.g.append('g').attr('class', 'buildings-layer');
    this.venuesGroup = this.g.append('g').attr('class', 'venues-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');

    // Create sub-groups for each venue type
    this.venueSubGroups = {};
    Object.keys(this.venueColors).forEach(type => {
      this.venueSubGroups[type] = this.venuesGroup.append('g')
        .attr('class', `venue-layer-${type}`);
    });
  }

  /**
   * Update the chart with new data.
   */
  update({ buildings, venues, bounds, visibleLayers }) {
    if (!buildings || !bounds) return;
  
    // Store bounds for use in renderBaseMap
    this.bounds = bounds;
    console.log("DEBUG: " + JSON.stringify(bounds));
  
    // Calculate dimensions
    const containerElement = this.container.parentElement;
    let containerWidth = containerElement ? containerElement.clientWidth : 800;
    if (containerWidth === 0) {
      const rect = containerElement?.getBoundingClientRect();
      containerWidth = rect?.width || 800;
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

    // Render layers
    this.renderClipPath(innerWidth, innerHeight);
    this.renderBaseMap(innerWidth, innerHeight);
    this.renderBuildings(buildings);
    this.renderVenues(venues, visibleLayers);
    this.renderAxes(innerWidth, innerHeight);
  }

  /**
   * Create clip path.
   */
  renderClipPath(width, height) {
    this.defs.select('#buildings-chart-clip').remove();

    this.defs.append('clipPath')
      .attr('id', 'buildings-chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);

    this.buildingsGroup.attr('clip-path', 'url(#buildings-chart-clip)');
    this.venuesGroup.attr('clip-path', 'url(#buildings-chart-clip)');
  }

  /**
   * Render the basemap image.
   */
  renderBaseMap(width, height) {
    const { x: xScale, y: yScale } = this.scales;
  
    // Compute exact mapped position of the basemap using data coordinates
    const x0 = xScale(this.bounds.min_x);
    const x1 = xScale(this.bounds.max_x);
    const y0 = yScale(this.bounds.max_y);  // y inverted because SVG y increases downward
    const y1 = yScale(this.bounds.min_y);
  
    const imgWidth = x1 - x0;
    const imgHeight = y1 - y0;
  
    const image = this.baseMapGroup.selectAll('image')
      .data([1]);
  
    image.join(
      enter => enter.append('image')
        .attr('href', `${process.env.PUBLIC_URL}/BaseMap.png`)
        .attr('opacity', 0.4),
      update => update,
      exit => exit.remove()
    )
    .attr('x', x0)
    .attr('y', y0)
    .attr('width', imgWidth)
    .attr('height', imgHeight)
    // Since we're mapping to exact coordinate corners, aspect ratio stretching is expected
    .attr('preserveAspectRatio', 'none');
  }
  

  /**
   * Parse PostgreSQL polygon string to array of points.
   * Format: "((x1,y1),(x2,y2),...)"
   */
  parsePolygon(polygonStr) {
    if (!polygonStr) return null;

    try {
      // Remove outer parentheses and split by ),(
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
   * Render building polygons.
   */
  renderBuildings(buildings) {
    const { x: xScale, y: yScale } = this.scales;
    const self = this;

    // Line generator for polygons
    const lineGenerator = d3.line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveLinearClosed);

    // Process buildings to get polygon paths
    const buildingsWithPaths = buildings
      .map(b => ({
        ...b,
        points: this.parsePolygon(b.location)
      }))
      .filter(b => b.points && b.points.length >= 3);

    // D3 data binding
    const paths = this.buildingsGroup.selectAll('path.building')
      .data(buildingsWithPaths, d => d.buildingid);

    paths.join(
      enter => enter.append('path')
        .attr('class', 'building')
        .attr('opacity', 0)
        .call(this.bindBuildingEvents.bind(this)),
      update => update,
      exit => exit
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()
    )
    .attr('d', d => lineGenerator(d.points))
    .attr('fill', d => {
      // Color based on building type
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
    .style('cursor', 'pointer')
    .transition()
    .duration(300)
    .attr('opacity', 0.8);
  }

  /**
   * Bind mouse events to buildings.
   */
  bindBuildingEvents(selection) {
    const self = this;

    selection
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('stroke', '#000')
          .attr('stroke-width', 2)
          .attr('opacity', 1);

        self.controller.onBuildingHover(d, event);
      })
      .on('mousemove', function(event) {
        self.controller.onMouseMove(event);
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('stroke', '#333')
          .attr('stroke-width', 0.5)
          .attr('opacity', 0.8);

        self.controller.onItemLeave();
      });
  }

  /**
   * Render venue location points.
   */
  renderVenues(venues, visibleLayers) {
    if (!venues) return;

    const { x: xScale, y: yScale } = this.scales;

    // Render each venue type
    Object.keys(this.venueColors).forEach(venueType => {
      const venueData = visibleLayers[venueType] ? (venues[venueType] || []) : [];
      const color = this.venueColors[venueType];
      const group = this.venueSubGroups[venueType];

      const circles = group.selectAll('circle')
        .data(venueData, d => d.id);

      circles.join(
        enter => enter.append('circle')
          .attr('r', 0)
          .attr('fill', color)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1)
          .style('cursor', 'pointer')
          .call(sel => this.bindVenueEvents(sel, venueType)),
        update => update,
        exit => exit
          .transition()
          .duration(200)
          .attr('r', 0)
          .remove()
      )
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .transition()
      .duration(300)
      .attr('r', 4);
    });
  }

  /**
   * Bind mouse events to venue points.
   */
  bindVenueEvents(selection, venueType) {
    const self = this;

    selection
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('r', 8)
          .attr('stroke-width', 2);

        self.controller.onVenueHover(d, venueType, event);
      })
      .on('mousemove', function(event) {
        self.controller.onMouseMove(event);
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('r', 4)
          .attr('stroke-width', 1);

        self.controller.onItemLeave();
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
      .call(d3.axisBottom(this.scales.x).ticks(15));

    xAxisGroup.append('text')
      .attr('x', width / 2)
      .attr('y', 35)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('X Coordinate');

    // Y Axis
    const yAxisGroup = this.axesGroup.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(this.scales.y).ticks(15));

    yAxisGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -height / 2)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('Y Coordinate');
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

export default BuildingsMapChart;
