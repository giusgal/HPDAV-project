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
    this.svg = null;
    this.g = null;
    
    this.margin = { top: 40, right: 30, bottom: 60, left: 150 };
    this.rowHeight = 60;
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    d3.select(this.container).selectAll('*').remove();
    this.svg = null;
    this.g = null;
  }

  /**
   * Update the chart with new data.
   * 
   * @param {Object} params - Update parameters
   * @param {Object} params.routines - Object keyed by participant ID with routine data
   */
  update({ routines }) {
    if (!routines || Object.keys(routines).length === 0) return;

    const participantIds = Object.keys(routines).map(Number);
    
    const containerWidth = this.container.clientWidth;
    const width = containerWidth;
    const height = this.margin.top + this.margin.bottom + (participantIds.length * this.rowHeight * 2);
    const innerWidth = width - this.margin.left - this.margin.right;

    // Clear and recreate SVG
    d3.select(this.container).selectAll('*').remove();

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    this.g = this.svg.append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Time scale (0-24 hours)
    const xScale = d3.scaleLinear()
      .domain([0, 24])
      .range([0, innerWidth]);

    // Render components
    this.renderTimeAxis(xScale);
    this.renderGridLines(xScale, participantIds.length);
    this.renderTimelines(routines, participantIds, xScale, innerWidth);
    this.renderLegend(height, innerWidth);
  }

  /**
   * Render the time axis at the top.
   */
  renderTimeAxis(xScale) {
    const timeAxis = d3.axisTop(xScale)
      .ticks(24)
      .tickFormat(d => `${d}:00`);

    this.g.append('g')
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

    this.g.selectAll('.grid-line')
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
      const y = idx * this.rowHeight * 2 + 20;
      
      // Participant label
      const participant = routine.participant;
      const labelText = participant 
        ? `ID ${pid} (Age: ${participant.age}, ${participant.education || 'N/A'})`
        : `Participant ${pid}`;
      
      this.g.append('text')
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

        this.g.append('rect')
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

      // Checkin markers
      if (routine.checkins && routine.checkins.length > 0) {
        const checkinY = y + this.rowHeight;
        
        this.g.append('text')
          .attr('x', -10)
          .attr('y', checkinY + 10)
          .attr('text-anchor', 'end')
          .attr('font-size', '10px')
          .attr('fill', '#666')
          .text('Venue visits:');

        routine.checkins.forEach(checkin => {
          const venueColor = checkin.venue_type === 'Restaurant' ? '#E91E63' :
                            checkin.venue_type === 'Pub' ? '#FF5722' :
                            checkin.venue_type === 'Workplace' ? '#2196F3' : '#9E9E9E';
          
          this.g.append('circle')
            .attr('class', 'checkin-marker')
            .attr('cx', xScale(checkin.hour) + hourWidth / 2)
            .attr('cy', checkinY + 10)
            .attr('r', Math.min(8, Math.max(3, Math.sqrt(checkin.visit_count) * 2)))
            .attr('fill', venueColor)
            .attr('opacity', 0.7)
            .style('cursor', 'pointer')
            .on('mouseover', function(event) {
              d3.select(this).attr('stroke', '#000').attr('stroke-width', 2);
              self.controller.onCheckinHover(checkin, event);
            })
            .on('mouseout', function() {
              d3.select(this).attr('stroke', 'none');
              self.controller.onCheckinLeave();
            });
        });
      }
    });
  }

  /**
   * Render the activity legend at the bottom.
   */
  renderLegend(totalHeight, innerWidth) {
    const legend = this.svg.append('g')
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
   * Clean up D3 resources.
   */
  destroy() {
    d3.select(this.container).selectAll('*').remove();
    this.svg = null;
    this.g = null;
  }
}

export { ACTIVITY_COLORS, ACTIVITY_LABELS };
export default DailyRoutinesChart;
