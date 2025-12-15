/**
 * VenueVisitsChart - D3 Visualization for venue visits over time
 * 
 * Displays a bar/line chart showing visit counts to a specific venue over time.
 */

import * as d3 from 'd3';

class VenueVisitsChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 50, right: 30, bottom: 80, left: 70 };
    this.barColor = '#3498db';
    this.lineColor = '#e74c3c';
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ visitsData, venueName, granularity }) {
    if (!visitsData || visitsData.length === 0) {
      this.showNoData();
      return;
    }

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    const width = container.clientWidth - this.margin.left - this.margin.right;
    const height = 450 - this.margin.top - this.margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    const data = visitsData.map(d => ({
      ...d,
      date: parseDate(d.period),
      visits: +d.visits,
      unique_visitors: +d.unique_visitors
    })).filter(d => d.date);

    // X Scale - time scale
    const x = d3.scaleBand()
      .domain(data.map(d => d.period))
      .range([0, width])
      .padding(0.2);

    // Y Scale
    const maxY = d3.max(data, d => Math.max(d.visits, d.unique_visitors));
    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    // X Axis
    const xAxis = svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));
    
    // Rotate labels based on granularity
    if (granularity === 'daily' || data.length > 20) {
      xAxis.selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end')
        .attr('dx', '-0.8em')
        .attr('dy', '0.15em')
        .style('font-size', '9px');
    } else {
      xAxis.selectAll('text')
        .style('font-size', '10px');
    }

    // Y Axis
    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d3.format(',.0f')));

    // Y axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -55)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Number of Visits');

    // X axis label
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height + 65)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Time Period');

    // Create tooltip
    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'venue-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(0, 0, 0, 0.85)')
      .style('color', 'white')
      .style('padding', '10px')
      .style('border-radius', '5px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000');

    // Draw bars for total visits
    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.period))
      .attr('y', d => y(d.visits))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(d.visits))
      .attr('fill', this.barColor)
      .attr('opacity', 0.7)
      .on('mouseover', (event, d) => {
        tooltip
          .style('visibility', 'visible')
          .html(`
            <strong>${d.period}</strong><br/>
            Total Visits: ${d.visits.toLocaleString()}<br/>
            Unique Visitors: ${d.unique_visitors.toLocaleString()}
          `);
        d3.select(event.currentTarget).attr('opacity', 1);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      .on('mouseout', (event) => {
        tooltip.style('visibility', 'hidden');
        d3.select(event.currentTarget).attr('opacity', 0.7);
      });

    // Draw line for unique visitors
    const line = d3.line()
      .x(d => x(d.period) + x.bandwidth() / 2)
      .y(d => y(d.unique_visitors))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', this.lineColor)
      .attr('stroke-width', 2.5)
      .attr('d', line);

    // Add dots for unique visitors
    svg.selectAll('.dot')
      .data(data)
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', d => x(d.period) + x.bandwidth() / 2)
      .attr('cy', d => y(d.unique_visitors))
      .attr('r', 4)
      .attr('fill', this.lineColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5);

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 150}, -30)`);

    // Total visits legend
    legend.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', this.barColor)
      .attr('opacity', 0.7);

    legend.append('text')
      .attr('x', 22)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Total Visits');

    // Unique visitors legend
    legend.append('line')
      .attr('x1', 80)
      .attr('y1', 8)
      .attr('x2', 96)
      .attr('y2', 8)
      .attr('stroke', this.lineColor)
      .attr('stroke-width', 2.5);

    legend.append('circle')
      .attr('cx', 88)
      .attr('cy', 8)
      .attr('r', 4)
      .attr('fill', this.lineColor);

    legend.append('text')
      .attr('x', 102)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Unique Visitors');

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -25)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text(`Visits Over Time: ${venueName}`);
  }

  showNoData() {
    d3.select(this.container).selectAll('*').remove();
    d3.select(this.container)
      .append('div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('height', '400px')
      .style('color', '#666')
      .style('font-size', '16px')
      .text('No visit data available for this venue');
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

export default VenueVisitsChart;
