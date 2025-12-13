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
    this.routines = routines; // Store for use in map rendering
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
    this.participantMarkersLayer = this.mapG.append('g').attr('class', 'participant-markers-layer');
    
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
      
    this.renderMapContent(this.mapG, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight, this.visibleVenueLayers, this.routines);
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
  renderMapContent(mapGroup, travelRoutes, participantIds, buildingsData, xScale, yScale, actualMapWidth, innerHeight, visibleVenueLayers, routines = {}) {
    
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
    
    // Render home (green star) and work (red star) markers for each participant
    this.renderParticipantMarkers(routines, participantIds, xScale, yScale, participantColors);
    
    // Legend with white background - positioned at top right
    const legendGroup = mapGroup.append('g')
      .attr('transform', `translate(${actualMapWidth - 160}, 20)`);
    
    // Legend background - increased height for home/work markers
    const legendHeight = participantIds.length * 25 + 70;
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
    
    // Add home/work markers legend
    const markersLegendY = participantIds.length * 25 + 20;
    
    // Home star (green)
    legendGroup.append('path')
      .attr('d', this.getStarPath(20, markersLegendY, 8))
      .attr('fill', '#4CAF50')
      .attr('stroke', '#2E7D32')
      .attr('stroke-width', 1.5);
    
    legendGroup.append('text')
      .attr('x', 40)
      .attr('y', markersLegendY + 4)
      .attr('font-size', '12px')
      .text('Home');
    
    // Work star (red)
    legendGroup.append('path')
      .attr('d', this.getStarPath(20, markersLegendY + 25, 8))
      .attr('fill', '#F44336')
      .attr('stroke', '#C62828')
      .attr('stroke-width', 1.5);
    
    legendGroup.append('text')
      .attr('x', 40)
      .attr('y', markersLegendY + 29)
      .attr('font-size', '12px')
      .text('Work');
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
   * Generate SVG path for a 5-pointed star.
   * @param {number} cx - Center x coordinate
   * @param {number} cy - Center y coordinate
   * @param {number} r - Outer radius of the star
   * @returns {string} SVG path string
   */
  getStarPath(cx, cy, r) {
    const innerRadius = r * 0.4;
    const points = 5;
    let path = '';
    
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? r : innerRadius;
      const angle = (i * Math.PI / points) - (Math.PI / 2); // Start from top
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      path += (i === 0 ? 'M' : 'L') + x + ',' + y;
    }
    path += 'Z';
    return path;
  }

  /**
   * Render home and work markers (stars) for each participant.
   */
  renderParticipantMarkers(routines, participantIds, xScale, yScale, participantColors) {
    if (!routines || !this.participantMarkersLayer) return;
    
    const self = this;
    
    participantIds.forEach((pid, idx) => {
      const routine = routines[pid];
      if (!routine) return;
      
      const participantColor = participantColors(pid);
      
      // Render home location (green star)
      if (routine.home_location) {
        const homeX = xScale(routine.home_location.x);
        const homeY = yScale(routine.home_location.y);
        
        // Add glow effect
        this.participantMarkersLayer.append('path')
          .attr('class', `home-marker-glow-${pid}`)
          .attr('d', this.getStarPath(homeX, homeY, 14))
          .attr('fill', 'none')
          .attr('stroke', '#4CAF50')
          .attr('stroke-width', 3)
          .attr('opacity', 0.3);
        
        // Main star
        this.participantMarkersLayer.append('path')
          .attr('class', `home-marker-${pid}`)
          .attr('d', this.getStarPath(homeX, homeY, 12))
          .attr('fill', '#4CAF50')
          .attr('stroke', '#2E7D32')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function(event) {
            d3.select(this).attr('d', self.getStarPath(homeX, homeY, 15));
            if (self.controller.onVenueHover) {
              self.controller.onVenueHover({
                x: routine.home_location.x,
                y: routine.home_location.y,
                apartmentid: routine.home_location.apartmentid,
                participantId: pid
              }, 'home', event);
            }
          })
          .on('mouseout', function() {
            d3.select(this).attr('d', self.getStarPath(homeX, homeY, 12));
            if (self.controller.onVenueLeave) {
              self.controller.onVenueLeave();
            }
          });
        
        // Participant ID label near home
        this.participantMarkersLayer.append('text')
          .attr('x', homeX + 15)
          .attr('y', homeY + 4)
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .attr('fill', participantColor)
          .text(`P${pid}`);
      }
      
      // Render work location (red star)
      if (routine.work_location) {
        const workX = xScale(routine.work_location.x);
        const workY = yScale(routine.work_location.y);
        
        // Add glow effect
        this.participantMarkersLayer.append('path')
          .attr('class', `work-marker-glow-${pid}`)
          .attr('d', this.getStarPath(workX, workY, 14))
          .attr('fill', 'none')
          .attr('stroke', '#F44336')
          .attr('stroke-width', 3)
          .attr('opacity', 0.3);
        
        // Main star
        this.participantMarkersLayer.append('path')
          .attr('class', `work-marker-${pid}`)
          .attr('d', this.getStarPath(workX, workY, 12))
          .attr('fill', '#F44336')
          .attr('stroke', '#C62828')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function(event) {
            d3.select(this).attr('d', self.getStarPath(workX, workY, 15));
            if (self.controller.onVenueHover) {
              self.controller.onVenueHover({
                x: routine.work_location.x,
                y: routine.work_location.y,
                employerid: routine.work_location.employerid,
                participantId: pid
              }, 'work', event);
            }
          })
          .on('mouseout', function() {
            d3.select(this).attr('d', self.getStarPath(workX, workY, 12));
            if (self.controller.onVenueLeave) {
              self.controller.onVenueLeave();
            }
          });
        
        // Participant ID label near work
        this.participantMarkersLayer.append('text')
          .attr('x', workX + 15)
          .attr('y', workY + 4)
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .attr('fill', participantColor)
          .text(`P${pid}`);
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
