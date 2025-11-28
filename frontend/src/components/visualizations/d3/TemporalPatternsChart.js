/**
 * TemporalPatternsChart - D3 Visualization Classes
 * 
 * Contains three chart classes for temporal pattern visualization:
 * - ActivityChart: Line chart showing activity patterns over time
 * - SpendingChart: Stacked area chart showing spending patterns
 * - SocialChart: Combined bar and line chart for social activity
 */

import * as d3 from 'd3';

/**
 * ActivityChart - Line chart for activity patterns over time.
 */
class ActivityChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 40, right: 120, bottom: 60, left: 70 };
    
    this.colors = d3.scaleOrdinal()
      .domain(['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'])
      .range(['#e74c3c', '#9b59b6', '#3498db', '#2ecc71']);
    
    this.labels = {
      'restaurant_visits': 'Restaurant',
      'pub_visits': 'Pub',
      'home_activity': 'Home',
      'work_activity': 'Work'
    };
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ activityData }) {
    if (!activityData || activityData.length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    const width = container.clientWidth - this.margin.left - this.margin.right;
    const height = 400 - this.margin.top - this.margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    const data = activityData.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date))
      .range([0, width]);

    const maxY = d3.max(data, d => Math.max(
      d.restaurant_visits, d.pub_visits, d.home_activity, d.work_activity
    ));

    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d3.format('.2s')));

    // Y axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Check-ins');

    // Lines
    const line = d3.line()
      .x(d => x(d.date))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const metrics = ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'];

    metrics.forEach(metricKey => {
      const lineData = data.map(d => ({ date: d.date, value: d[metricKey] }));
      
      svg.append('path')
        .datum(lineData)
        .attr('fill', 'none')
        .attr('stroke', this.colors(metricKey))
        .attr('stroke-width', 2)
        .attr('d', line);

      // Add dots
      svg.selectAll(`.dot-${metricKey}`)
        .data(lineData)
        .join('circle')
        .attr('class', `dot-${metricKey}`)
        .attr('cx', d => x(d.date))
        .attr('cy', d => y(d.value))
        .attr('r', 3)
        .attr('fill', this.colors(metricKey))
        .style('opacity', 0.7);
    });

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width + 10}, 0)`);

    metrics.forEach((metricKey, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 22})`);
      
      g.append('rect')
        .attr('width', 16)
        .attr('height', 16)
        .attr('fill', this.colors(metricKey));
      
      g.append('text')
        .attr('x', 22)
        .attr('y', 12)
        .style('font-size', '11px')
        .text(this.labels[metricKey]);
    });

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Activity Patterns Over Time');
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

/**
 * SpendingChart - Stacked area chart for spending patterns.
 */
class SpendingChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 40, right: 120, bottom: 60, left: 80 };
    
    this.colors = d3.scaleOrdinal()
      .domain(['food_spending', 'recreation_spending', 'shelter_spending', 'education_spending'])
      .range(['#e67e22', '#9b59b6', '#3498db', '#1abc9c']);
    
    this.labels = {
      'food_spending': 'Food',
      'recreation_spending': 'Recreation',
      'shelter_spending': 'Shelter',
      'education_spending': 'Education'
    };
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ spendingData }) {
    if (!spendingData || spendingData.length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    const width = container.clientWidth - this.margin.left - this.margin.right;
    const height = 400 - this.margin.top - this.margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const data = spendingData.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date))
      .range([0, width]);

    const maxY = d3.max(data, d => Math.max(
      d.food_spending, d.recreation_spending, d.shelter_spending
    ));

    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d => `$${d3.format('.2s')(d)}`));

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -60)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Spending ($)');

    // Stacked area chart
    const keys = ['food_spending', 'recreation_spending', 'shelter_spending', 'education_spending'];
    
    const stack = d3.stack()
      .keys(keys)
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const series = stack(data);

    const area = d3.area()
      .x(d => x(d.data.date))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    svg.selectAll('.area')
      .data(series)
      .join('path')
      .attr('class', 'area')
      .attr('fill', d => this.colors(d.key))
      .attr('opacity', 0.7)
      .attr('d', area);

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width + 10}, 0)`);

    keys.forEach((key, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 22})`);
      
      g.append('rect')
        .attr('width', 16)
        .attr('height', 16)
        .attr('fill', this.colors(key))
        .attr('opacity', 0.7);
      
      g.append('text')
        .attr('x', 22)
        .attr('y', 12)
        .style('font-size', '11px')
        .text(this.labels[key]);
    });

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Spending Patterns Over Time');
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

/**
 * SocialChart - Combined bar and line chart for social activity.
 */
class SocialChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 40, right: 120, bottom: 60, left: 70 };
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ socialData }) {
    if (!socialData || socialData.length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    const width = container.clientWidth - this.margin.left - this.margin.right;
    const height = 400 - this.margin.top - this.margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const data = socialData.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.interactions) * 1.1])
      .range([height, 0]);

    const y2 = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.active_initiators) * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d3.format('.2s')));

    svg.append('g')
      .attr('transform', `translate(${width}, 0)`)
      .call(d3.axisRight(y2).tickFormat(d3.format('.2s')))
      .selectAll('text')
      .style('fill', '#e74c3c');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Interactions');

    // Bar chart for interactions
    const barWidth = Math.max(2, (width / data.length) - 2);
    
    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.date) - barWidth / 2)
      .attr('y', d => y(d.interactions))
      .attr('width', barWidth)
      .attr('height', d => height - y(d.interactions))
      .attr('fill', '#3498db')
      .attr('opacity', 0.6);

    // Line for active participants
    const line = d3.line()
      .x(d => x(d.date))
      .y(d => y2(d.active_initiators))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#e74c3c')
      .attr('stroke-width', 2.5)
      .attr('d', line);

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 150}, -30)`);

    legend.append('rect')
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', '#3498db')
      .attr('opacity', 0.6);
    
    legend.append('text')
      .attr('x', 22)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Interactions');

    legend.append('line')
      .attr('x1', 100)
      .attr('x2', 116)
      .attr('y1', 8)
      .attr('y2', 8)
      .attr('stroke', '#e74c3c')
      .attr('stroke-width', 2.5);
    
    legend.append('text')
      .attr('x', 122)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Active Users');

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Social Activity Over Time');
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

export { ActivityChart, SpendingChart, SocialChart };
