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
    
    // Venue colors for map points
    this.venueColors = {
      'apartments': '#3498db',
      'employers': '#e74c3c',
      'pubs': '#9b59b6',
      'restaurants': '#f39c12',
      'schools': '#2ecc71',
    };
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
   * @param {Object} params.visibleVenueLayers - Which venue layers to show on map
   */
  update({ routines, travelRoutes = {}, buildingsData = null, visibleVenueLayers = null }) {
    this.visibleVenueLayers = visibleVenueLayers;
    this.routineData = routines;
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
    
    // Create sub-groups for layering
    this.buildingsLayer = this.mapG.append('g').attr('class', 'buildings-layer');
    this.routesLayer = this.mapG.append('g').attr('class', 'routes-layer');
    this.venuesLayer = this.mapG.append('g').attr('class', 'venues-layer');
    
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
      
    this.renderMapContent(this.mapG, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight, this.visibleVenueLayers, this.routineData);
  }

  /**
   * Get building fill color based on type.
   */
  getBuildingColor(buildingType) {
    const colors = {
      'Apartments': 'rgba(100, 149, 237, 0.15)',      // Cornflower blue - residential
      'Common Areas': 'rgba(60, 179, 113, 0.15)',     // Medium sea green - parks/common
      'Restaurants': 'rgba(255, 140, 0, 0.15)',       // Dark orange - dining
      'Pubs': 'rgba(220, 20, 60, 0.15)',              // Crimson - entertainment
      'Schools': 'rgba(255, 215, 0, 0.15)',           // Gold - education
      'Employers': 'rgba(138, 43, 226, 0.15)'         // Blue violet - workplace
    };
    return colors[buildingType] || 'rgba(200, 200, 200, 0.15)';
  }

  /**
   * Get building stroke color based on type.
   */
  getBuildingStroke(buildingType) {
    const strokes = {
      'Apartments': '#6495ED',      // Cornflower blue
      'Common Areas': '#3CB371',    // Medium sea green
      'Restaurants': '#FF8C00',     // Dark orange
      'Pubs': '#DC143C',            // Crimson
      'Schools': '#FFD700',         // Gold
      'Employers': '#8A2BE2'        // Blue violet
    };
    return strokes[buildingType] || '#999';
  }

  /**
   * Render the actual map content (buildings and routes).
   */
  renderMapContent(mapGroup, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight, visibleVenueLayers, routineData) {
    
    // Render buildings with type-based colors
    if (buildingsData?.buildings) {
      const lineGenerator = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinearClosed);
      
      const buildingsWithPaths = buildingsData.buildings
        .map(b => ({ ...b, points: this.parsePolygon(b.location) }))
        .filter(b => b.points && b.points.length >= 3);
      
      this.buildingsLayer.selectAll('path.building')
        .data(buildingsWithPaths)
        .join('path')
        .attr('class', 'building')
        .attr('d', d => lineGenerator(d.points))
        .attr('fill', d => this.getBuildingColor(d.buildingtype))
        .attr('stroke', d => this.getBuildingStroke(d.buildingtype))
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.8);
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
        this.routesLayer.append('line')
          .attr('x1', xScale(route.start_x))
          .attr('y1', yScale(route.start_y))
          .attr('x2', xScale(route.end_x))
          .attr('y2', yScale(route.end_y))
          .attr('stroke', color)
          .attr('stroke-width', Math.min(Math.sqrt(count) * 2, 7))
          .attr('opacity', 0.6);
      });
    });
    
    // Render venues if available
    this.renderVenuesOnMap(buildingsData, xScale, yScale, visibleVenueLayers);
    
    // Render workplace markers for selected participants
    this.renderWorkplaceMarkers(participantIds, routineData, xScale, yScale, participantColors);
      
    
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
   * Render workplace markers for selected participants.
   */
  renderWorkplaceMarkers(participantIds, routineData, xScale, yScale, participantColors) {
    if (!routineData) return;
    
    const self = this;
    const workplaceData = [];
    
    participantIds.forEach(pid => {
      const routine = routineData[pid];
      if (routine?.workplace) {
        workplaceData.push({
          participantId: pid,
          x: routine.workplace.x,
          y: routine.workplace.y,
          visitCount: routine.workplace.visit_count
        });
      }
    });
    
    if (workplaceData.length === 0) return;
    
    // Create a group for workplace markers
    const workplaceGroup = this.venuesLayer.append('g').attr('class', 'workplace-markers');
    
    workplaceGroup.selectAll('rect.workplace-marker')
      .data(workplaceData)
      .join('rect')
      .attr('class', 'workplace-marker')
      .attr('x', d => xScale(d.x) - 12)
      .attr('y', d => yScale(d.y) - 12)
      .attr('width', 24)
      .attr('height', 24)
      .attr('fill', 'rgba(220, 20, 60, 0.7)')  // Red color
      .attr('stroke', '#fff')
      .attr('stroke-width', 2.5)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('width', 28)
          .attr('height', 28)
          .attr('x', d => xScale(d.x) - 14)
          .attr('y', d => yScale(d.y) - 14)
          .attr('stroke-width', 3);
        
        if (self.controller.onWorkplaceHover) {
          self.controller.onWorkplaceHover(d, event);
        }
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .attr('width', 24)
          .attr('height', 24)
          .attr('x', d => xScale(d.x) - 12)
          .attr('y', d => yScale(d.y) - 12)
          .attr('stroke-width', 2.5);
        
        if (self.controller.onWorkplaceLeave) {
          self.controller.onWorkplaceLeave();
        }
      });
  }

  /**
   * Render venue points on the map.
   */
  renderVenuesOnMap(buildingsData, xScale, yScale, visibleVenueLayers) {
    if (!buildingsData?.venues) return;
    
    const self = this;
    const venues = buildingsData.venues;
    
    // Render each venue type
    Object.keys(this.venueColors).forEach(venueType => {
      const isVisible = visibleVenueLayers ? visibleVenueLayers[venueType] : true;
      const venueData = isVisible ? (venues[venueType] || []) : [];
      const color = this.venueColors[venueType];
      
      this.venuesLayer.selectAll(`circle.venue-${venueType}`)
        .data(venueData, d => d.id)
        .join(
          enter => enter.append('circle')
            .attr('class', `venue-${venueType}`)
            .attr('r', 0)
            .attr('fill', color)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .call(sel => self.bindVenueEvents(sel, venueType))
            .transition()
            .duration(300)
            .attr('r', 5),
          update => update,
          exit => exit
            .transition()
            .duration(200)
            .attr('r', 0)
            .remove()
        )
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y));
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
          .attr('stroke-width', 2.5);
        
        if (self.controller.onVenueHover) {
          self.controller.onVenueHover(d, venueType, event);
        }
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('r', 5)
          .attr('stroke-width', 1.5);
        
        if (self.controller.onVenueLeave) {
          self.controller.onVenueLeave();
        }
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
