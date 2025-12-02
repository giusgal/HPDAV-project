/**
 * DailyRoutinesChart - D3 Visualization Class
 * 
 * Renders a timeline visualization of participant daily routines.
 */

import * as d3 from 'd3';

const ACTIVITY_COLORS = {
  'AtHome': '#4CAF50',
  'AtWork': '#2196F3',
  'AtRecreation': '#FF9800',
  'AtRestaurant': '#E91E63',
  'Transport': '#9C27B0',
  'Unknown': '#BDBDBD'
};

const ACTIVITY_LABELS = {
  'AtHome': 'At Home',
  'AtWork': 'At Work',
  'AtRecreation': 'Recreation',
  'AtRestaurant': 'Restaurant',
  'Transport': 'Commuting',
  'Unknown': 'Unknown'
};

class DailyRoutinesChart {
  /**
   * Create a new chart instance.
   * @param {HTMLElement} container - The container element
   * @param {Object} controller - Callbacks to React for interactivity
   * @param {Function} controller.onActivityHover - Called with activity data on hover
   * @param {Function} controller.onActivityLeave - Called when mouse leaves activity
   * @param {Function} controller.onCheckinHover - Called with checkin data on hover
   * @param {Function} controller.onCheckinLeave - Called when mouse leaves checkin
   */
  constructor(container, controller) {
    this.container = container;
    this.controller = controller;
    this.timelineSvg = null;
    this.timelineG = null;
    this.mapSvg = null;
    this.mapG = null;
    
    this.margin = { top: 40, right: 30, bottom: 60, left: 150 };
    this.rowHeight = 60;
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    d3.select(this.container).selectAll('*').remove();
    this.timelineSvg = null;
    this.timelineG = null;
    this.mapSvg = null;
    this.mapG = null;
  }

  /**
   * Update the chart with new data.
   * 
   * @param {Object} params - Update parameters
   * @param {Object} params.routines - Object keyed by participant ID with routine data
   * @param {Object} params.travelRoutes - Travel routes for participants
   * @param {Object} params.buildingsData - Building data for map background
   */
  update({ routines, travelRoutes = {}, buildingsData = null }) {
    if (!routines || Object.keys(routines).length === 0) return;

    const participantIds = Object.keys(routines).map(Number);
    
    const containerWidth = this.container.clientWidth;
    const width = containerWidth;
    const height = this.margin.top + this.margin.bottom + (participantIds.length * this.rowHeight);
    const innerWidth = width - this.margin.left - this.margin.right;

    // Clear and recreate SVG elements
    d3.select(this.container).selectAll('*').remove();

    // Create timeline SVG
    this.timelineSvg = d3.select(this.container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('display', 'block');

    this.timelineG = this.timelineSvg.append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Time scale (0-24 hours)
    const xScale = d3.scaleLinear()
      .domain([0, 24])
      .range([0, innerWidth]);

    // Render timeline components
    this.renderTimeAxis(xScale);
    this.renderGridLines(xScale, participantIds.length);
    this.renderTimelines(routines, participantIds, xScale, innerWidth);
    this.renderLegend(height, innerWidth);
    
    // Render travel routes map if data is available
    if (Object.keys(travelRoutes).length > 0 && buildingsData) {
      this.renderTravelMap(travelRoutes, participantIds, buildingsData, width);
    }
  }

  /**
   * Render the time axis at the top.
   */
  renderTimeAxis(xScale) {
    const timeAxis = d3.axisTop(xScale)
      .ticks(24)
      .tickFormat(d => `${d}:00`);

    this.timelineG.append('g')
      .attr('class', 'time-axis')
      .call(timeAxis)
      .selectAll('text')
      .style('font-size', '10px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'start');
  }

  /**
   * Render vertical grid lines.
   */
  renderGridLines(xScale, participantCount) {
    const totalHeight = participantCount * this.rowHeight * 2;

    this.timelineG.selectAll('.grid-line')
      .data(d3.range(0, 25, 3))
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', totalHeight)
      .attr('stroke', '#e0e0e0')
      .attr('stroke-dasharray', '2,2');
  }

  /**
   * Render timelines for each participant.
   */
  renderTimelines(routines, participantIds, xScale, innerWidth) {
    const hourWidth = innerWidth / 24;
    const self = this;

    participantIds.forEach((pid, idx) => {
      const routine = routines[pid];
      const y = idx * this.rowHeight + 20;
      
      // Participant label
      const participant = routine.participant;
      const labelText = participant 
        ? `ID ${pid} (Age: ${participant.age}, ${participant.education || 'N/A'})`
        : `Participant ${pid}`;
      
      this.timelineG.append('text')
        .attr('x', -10)
        .attr('y', y + this.rowHeight / 2)
        .attr('text-anchor', 'end')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text(labelText);

      // Activity timeline bars
      const timeline = routine.timeline || [];

      timeline.forEach((hour, hourIdx) => {
        const activity = hour.dominant_activity;
        const color = ACTIVITY_COLORS[activity] || ACTIVITY_COLORS['Unknown'];
        const confidence = hour.confidence || 0;

        this.timelineG.append('rect')
          .attr('class', 'activity-bar')
          .attr('x', xScale(hourIdx))
          .attr('y', y)
          .attr('width', hourWidth - 1)
          .attr('height', this.rowHeight - 10)
          .attr('fill', color)
          .attr('opacity', Math.max(0.3, confidence / 100))
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function(event) {
            d3.select(this).attr('stroke', '#000').attr('stroke-width', 2);
            self.controller.onActivityHover({
              hour: hourIdx,
              activity,
              confidence,
              activities: hour.activities
            }, event);
          })
          .on('mouseout', function() {
            d3.select(this).attr('stroke', 'none');
            self.controller.onActivityLeave();
          });
      });
    });
  }

  /**
   * Render the activity legend at the bottom.
   */
  renderLegend(totalHeight, innerWidth) {
    const legend = this.timelineSvg.append('g')
      .attr('transform', `translate(${this.margin.left}, ${totalHeight - 30})`);

    const activities = Object.entries(ACTIVITY_COLORS).filter(([key]) => key !== 'Unknown');
    
    activities.forEach(([activity, color], idx) => {
      legend.append('rect')
        .attr('x', idx * 120)
        .attr('y', 0)
        .attr('width', 15)
        .attr('height', 15)
        .attr('fill', color);

      legend.append('text')
        .attr('x', idx * 120 + 20)
        .attr('y', 12)
        .attr('font-size', '11px')
        .text(ACTIVITY_LABELS[activity]);
    });
  }

  /**
   * Parse PostgreSQL polygon string to array of points.
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
   * Compute bounds from routes and buildings.
   */
  computeBounds(travelRoutes, buildingsData) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    // Include route points
    Object.values(travelRoutes).forEach(routes => {
      routes.forEach(route => {
        if (route.start_x < minX) minX = route.start_x;
        if (route.start_x > maxX) maxX = route.start_x;
        if (route.start_y < minY) minY = route.start_y;
        if (route.start_y > maxY) maxY = route.start_y;
        if (route.end_x < minX) minX = route.end_x;
        if (route.end_x > maxX) maxX = route.end_x;
        if (route.end_y < minY) minY = route.end_y;
        if (route.end_y > maxY) maxY = route.end_y;
      });
    });
    
    // Include buildings if routes didn't provide bounds
    if (minX === Infinity && buildingsData?.buildings) {
      buildingsData.buildings.forEach(b => {
        const pts = this.parsePolygon(b.location);
        if (!pts) return;
        pts.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      });
    }
    
    if (minX === Infinity) return null;
    
    const padX = (maxX - minX) * 0.1;
    const padY = (maxY - minY) * 0.1;
    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY
    };
  }

  /**
   * Render travel routes map.
   */
  renderTravelMap(travelRoutes, participantIds, buildingsData, containerWidth) {
    const bounds = this.computeBounds(travelRoutes, buildingsData);
    if (!bounds) return;
    
    // Map dimensions with margins
    const mapMargin = { top: 80, right: 200, bottom: 40, left: 200 };
    const maxMapWidth = 1000;
    const maxMapHeight = 700;
    
    // Available space for the actual map content
    const availableWidth = containerWidth - mapMargin.left - mapMargin.right;
    const mapWidth = Math.min(maxMapWidth, availableWidth);
    
    // Scales with aspect ratio preserved but constrained
    const dataWidth = bounds.maxX - bounds.minX;
    const dataHeight = bounds.maxY - bounds.minY;
    const dataAspectRatio = dataWidth / dataHeight;
    
    // Calculate height based on width and aspect ratio, but cap it
    let actualMapWidth = mapWidth;
    let innerHeight = mapWidth / dataAspectRatio;
    if (innerHeight > maxMapHeight) {
      innerHeight = maxMapHeight;
      actualMapWidth = innerHeight * dataAspectRatio;
    }
    
    // Calculate total SVG dimensions - use full container width
    const totalMapWidth = containerWidth;
    const totalMapHeight = innerHeight + mapMargin.top + mapMargin.bottom;
    
    // Create separate SVG for the map
    this.mapSvg = d3.select(this.container)
      .append('svg')
      .attr('width', totalMapWidth)
      .attr('height', totalMapHeight)
      .style('display', 'block')
      .style('margin-top', '40px');
    
    // Center the map content within the SVG
    const mapOffsetX = (containerWidth - actualMapWidth) / 2;
    
    // Create map group - centered
    this.mapG = this.mapSvg.append('g')
      .attr('class', 'travel-map')
      .attr('transform', `translate(${mapOffsetX}, ${mapMargin.top})`);
    
    // Title - centered above the map
    this.mapG.append('text')
      .attr('x', actualMapWidth / 2)
      .attr('y', -30)
      .attr('text-anchor', 'middle')
      .attr('font-size', '16px')
      .attr('font-weight', 'bold')
      .text('Travel Routes');
    
    const xScale = d3.scaleLinear()
      .domain([bounds.minX, bounds.maxX])
      .range([0, actualMapWidth]);
    
    const yScale = d3.scaleLinear()
      .domain([bounds.minY, bounds.maxY])
      .range([innerHeight, 0]);
      
    this.renderMapContent(this.mapG, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight);
  }

  /**
   * Render the actual map content (buildings and routes).
   */
  renderMapContent(mapGroup, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight) {
    
    // Add white background
    mapGroup.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', actualMapWidth)
      .attr('height', innerHeight)
      .attr('fill', 'white');
    
    // Render buildings
    if (buildingsData?.buildings) {
      const lineGenerator = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinearClosed);
      
      const buildingsWithPaths = buildingsData.buildings
        .map(b => ({ ...b, points: this.parsePolygon(b.location) }))
        .filter(b => b.points && b.points.length >= 3);
      
      mapGroup.selectAll('path.building')
        .data(buildingsWithPaths)
        .join('path')
        .attr('class', 'building')
        .attr('d', d => lineGenerator(d.points))
        .attr('fill', 'rgba(200, 200, 200, 0.3)')
        .attr('stroke', '#999')
        .attr('stroke-width', 0.5);
    }
    
    // Color scale for participants
    const participantColors = d3.scaleOrdinal()
      .domain(participantIds)
      .range(['#2196F3', '#FF9800', '#4CAF50', '#E91E63']);
    
    // Render routes for each participant
    participantIds.forEach((pid, idx) => {
      const routes = travelRoutes[pid] || [];
      const color = participantColors(pid);
      
      routes.forEach(route => {
        const count = route.movement_count || route.trip_count || 1;
        
        // Draw straight line (no curves)
        mapGroup.append('line')
          .attr('x1', xScale(route.start_x))
          .attr('y1', yScale(route.start_y))
          .attr('x2', xScale(route.end_x))
          .attr('y2', yScale(route.end_y))
          .attr('stroke', color)
          .attr('stroke-width', Math.min(Math.sqrt(count) * 2, 7))
          .attr('opacity', 0.6);
      });
    });
      
    
    // Legend with white background - positioned at top right
    const legendGroup = mapGroup.append('g')
      .attr('transform', `translate(${actualMapWidth - 160}, 20)`);
    
    // Legend background
    const legendHeight = participantIds.length * 25 + 10;
    legendGroup.append('rect')
      .attr('x', -5)
      .attr('y', -5)
      .attr('width', 150)
      .attr('height', legendHeight)
      .attr('fill', 'white')
      .attr('stroke', '#ccc')
      .attr('stroke-width', 1)
      .attr('opacity', 0.9);
    
    participantIds.forEach((pid, idx) => {
      legendGroup.append('line')
        .attr('x1', 5)
        .attr('x2', 35)
        .attr('y1', idx * 25 + 5)
        .attr('y2', idx * 25 + 5)
        .attr('stroke', participantColors(pid))
        .attr('stroke-width', 3);
      
      legendGroup.append('text')
        .attr('x', 40)
        .attr('y', idx * 25 + 10)
        .attr('font-size', '12px')
        .text(`Participant ${pid}`);
    });
  }

  /**
   * Clean up D3 resources.
   */
  destroy() {
    d3.select(this.container).selectAll('*').remove();
    this.timelineSvg = null;
    this.timelineG = null;
    this.mapSvg = null;
    this.mapG = null;
  }
}

export { ACTIVITY_COLORS, ACTIVITY_LABELS };
export default DailyRoutinesChart;
