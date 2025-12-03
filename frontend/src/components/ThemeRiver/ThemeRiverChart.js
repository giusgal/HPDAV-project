/**
 * ThemeRiverChart - D3 Streamgraph Visualization with Pie Chart Hover
 * 
 * Creates an interactive theme river (streamgraph) showing temporal evolution
 * of different categories over time. Hovering shows a pie chart breakdown
 * for the selected time period.
 */

import * as d3 from 'd3';

class ThemeRiverChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 20, right: 200, bottom: 80, left: 70 };
    
    // Color schemes for different dimensions
    this.colorSchemes = {
      mode: {
        'AtHome': '#3498db',
        'AtWork': '#2ecc71',
        'Transport': '#95a5a6',
        'AtRecreation': '#e74c3c',
        'AtRestaurant': '#f39c12'
      },
      purpose: {
        'Work/Home Commute': '#2ecc71',
        'Eating': '#f39c12',
        'Recreation (Social Gathering)': '#e74c3c',
        'Coming Back From Restaurant': '#e67e22',
        'Going Back to Home': '#3498db'
      },
      spending: {
        'Food': '#f39c12',
        'Recreation': '#e74c3c',
        'Education': '#3498db',
        'Shelter': '#9b59b6',
        'RentAdjustment': '#95a5a6'
      }
    };
    
    this.currentColorScheme = this.colorSchemes.mode;
    this.tooltip = null;
    this.hiddenCategories = new Set();
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
    
    // Create tooltip
    this.tooltip = d3.select('body')
      .append('div')
      .attr('class', 'theme-river-tooltip')
      .style('opacity', 0);
  }

  update({ data, categories, periods, normalize, dimension }) {
    if (!data || data.length === 0) return;

    const container = this.container;
    const self = this;
    
    d3.select(container).selectAll('svg').remove();
    d3.select(container).selectAll('.theme-river-legend').remove();

    const pieRadius = 110;
    const pieAreaWidth = pieRadius * 2 + 100;
    const width = container.clientWidth - this.margin.left - this.margin.right - pieAreaWidth;
    const height = container.clientHeight - this.margin.top - this.margin.bottom - 60;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', container.clientWidth)
      .attr('height', height + this.margin.top + this.margin.bottom + 60)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Determine color scheme based on dimension
    if (dimension === 'mode' || categories.some(c => c in this.colorSchemes.mode)) {
      this.currentColorScheme = this.colorSchemes.mode;
    } else if (dimension === 'purpose' || categories.some(c => c in this.colorSchemes.purpose)) {
      this.currentColorScheme = this.colorSchemes.purpose;
    } else if (dimension === 'spending' || categories.some(c => c in this.colorSchemes.spending)) {
      this.currentColorScheme = this.colorSchemes.spending;
    } else {
      const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
      this.currentColorScheme = {};
      categories.forEach((cat, i) => {
        this.currentColorScheme[cat] = colorScale(i);
      });
    }

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    data.forEach(d => {
      d.parsedDate = parseDate(d.period);
    });

    // X scale
    const xScale = d3.scaleTime()
      .domain(d3.extent(data, d => d.parsedDate))
      .range([0, width]);

    // Filter and clean data
    this.hiddenCategories.clear();
    const visibleCategories = categories.filter(cat => !this.hiddenCategories.has(cat));

    const cleanedData = data.map(d => {
      const cleaned = { ...d };
      visibleCategories.forEach(cat => {
        cleaned[cat] = Math.max(0, cleaned[cat] || 0);
      });
      return cleaned;
    });

    // Stack the data
    const stack = d3.stack()
      .keys(visibleCategories)
      .offset(d3.stackOffsetSilhouette)
      .order(d3.stackOrderInsideOut);

    const series = stack(cleanedData);

    // Y scale
    const yExtent = [
      d3.min(series, s => d3.min(s, d => d[0])),
      d3.max(series, s => d3.max(s, d => d[1]))
    ];
    
    const yScale = d3.scaleLinear()
      .domain(yExtent)
      .range([height, 0])
      .nice();

    // Area generator
    const area = d3.area()
      .x(d => xScale(d.data.parsedDate))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveBasis);

    // Create clip path
    svg.append('defs')
      .append('clipPath')
      .attr('id', 'stream-clip')
      .append('rect')
      .attr('width', width)
      .attr('height', height);

    // Hover line
    const hoverLine = svg.append('line')
      .attr('class', 'hover-line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#2c3e50')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .style('opacity', 0);

    // Date label
    const dateLabel = svg.append('text')
      .attr('class', 'date-label')
      .attr('text-anchor', 'middle')
      .attr('y', -8)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', '#2c3e50')
      .style('opacity', 0);

    // Pie chart group - positioned at far right edge with more margin
    const pieGroup = svg.append('g')
      .attr('class', 'pie-chart-group')
      .attr('transform', `translate(${width + pieRadius + 80}, ${height / 2})`);

    const pieTitle = pieGroup.append('text')
      .attr('class', 'pie-title')
      .attr('text-anchor', 'middle')
      .attr('y', -pieRadius - 15)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', '#2c3e50')
      .text('Hover to see breakdown');

    // Pie arc generators
    const pie = d3.pie()
      .value(d => d.value)
      .sort(null);

    const arc = d3.arc()
      .innerRadius(0)
      .outerRadius(pieRadius);

    const arcLabel = d3.arc()
      .innerRadius(pieRadius * 0.6)
      .outerRadius(pieRadius * 0.6);

    // Draw streams
    const streams = svg.append('g')
      .attr('clip-path', 'url(#stream-clip)')
      .selectAll('path')
      .data(series)
      .join('path')
      .attr('class', 'stream-layer')
      .attr('d', area)
      .attr('fill', d => this.currentColorScheme[d.key] || '#95a5a6')
      .attr('stroke', 'none');

    // Overlay for mouse tracking
    const overlay = svg.append('rect')
      .attr('class', 'overlay')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair');

    // Update pie chart function
    function updatePieChart(dataPoint) {
      if (!dataPoint) return;

      const pieData = visibleCategories.map(cat => ({
        category: cat,
        value: dataPoint[cat] || 0,
        color: self.currentColorScheme[cat] || '#95a5a6'
      })).filter(d => d.value > 0);

      const total = d3.sum(pieData, d => d.value);

      pieTitle.text(dataPoint.period);

      // Remove old slices
      pieGroup.selectAll('.pie-slice').remove();
      pieGroup.selectAll('.pie-legend-group').remove();

      if (pieData.length === 0 || total === 0) return;

      // Draw new slices
      const slices = pieGroup.selectAll('.pie-slice')
        .data(pie(pieData))
        .join('g')
        .attr('class', 'pie-slice');

      slices.append('path')
        .attr('d', arc)
        .attr('fill', d => d.data.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      slices.append('text')
        .attr('transform', d => `translate(${arcLabel.centroid(d)})`)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '12px')
        .style('font-weight', 'normal')
        .style('fill', 'black')
        .style('stroke', 'white')
        .style('stroke-width', '2px')
        .style('paint-order', 'stroke')
        .style('pointer-events', 'none')
        .text(d => {
          const pct = (d.data.value / total * 100);
          return pct >= 6 ? `${pct.toFixed(0)}%` : '';
        });

      // Legend below pie
      const legendGroup = pieGroup.append('g')
        .attr('class', 'pie-legend-group')
        .attr('transform', `translate(${-pieRadius}, ${pieRadius + 20})`);

      pieData.forEach((d, i) => {
        const item = legendGroup.append('g')
          .attr('transform', `translate(0, ${i * 18})`);

        item.append('rect')
          .attr('width', 12)
          .attr('height', 12)
          .attr('rx', 2)
          .attr('fill', d.color);

        const pct = (d.value / total * 100).toFixed(1);
        const shortName = d.category.length > 15 ? d.category.substring(0, 13) + '..' : d.category;
        
        item.append('text')
          .attr('x', 16)
          .attr('y', 10)
          .style('font-size', '12px')
          .style('font-weight', 'normal')
          .style('fill', '#000')
          .text(`${shortName}: ${pct}%`);
      });
    }

    // Mouse events
    overlay
      .on('mousemove', function(event) {
        const [mx] = d3.pointer(event);
        const xDate = xScale.invert(mx);
        
        const bisect = d3.bisector(d => d.parsedDate).left;
        let index = bisect(cleanedData, xDate);
        index = Math.max(0, Math.min(index, cleanedData.length - 1));
        
        if (index > 0) {
          const d0 = cleanedData[index - 1];
          const d1 = cleanedData[index];
          if (d0 && d1 && xDate - d0.parsedDate > d1.parsedDate - xDate) {
            // keep index
          } else {
            index = index - 1;
          }
        }
        
        const dataPoint = cleanedData[index];
        
        if (dataPoint) {
          const xPos = xScale(dataPoint.parsedDate);
          
          hoverLine
            .attr('x1', xPos)
            .attr('x2', xPos)
            .style('opacity', 1);

          dateLabel
            .attr('x', xPos)
            .text(d3.timeFormat('%b %d, %Y')(dataPoint.parsedDate))
            .style('opacity', 1);

          streams.attr('opacity', 0.7);
          updatePieChart(dataPoint);
        }
      })
      .on('mouseout', function() {
        hoverLine.style('opacity', 0);
        dateLabel.style('opacity', 0);
        streams.attr('opacity', 1);
        pieTitle.text('Hover to see breakdown');
        pieGroup.selectAll('.pie-slice').remove();
        pieGroup.selectAll('.pie-legend-group').remove();
      });

    // X axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(d3.timeMonth.every(2))
      .tickFormat(d3.timeFormat('%b %Y'));

    svg.append('g')
      .attr('class', 'axis x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.8em')
      .attr('dy', '0.15em');

    // X axis label
    svg.append('text')
      .attr('class', 'axis-label')
      .attr('x', width / 2)
      .attr('y', height + 65)
      .attr('text-anchor', 'middle')
      .text('Time Period');

    // Y axis label
    svg.append('text')
      .attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', -50)
      .attr('text-anchor', 'middle')
      .text(normalize ? 'Percentage (%)' : 'Volume');

    // Bottom legend
    this.createLegend(container, categories, width);

    // Title
    svg.append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', -5)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', '600')
      .style('fill', '#2c3e50')
      .text('Streamgraph: Temporal Flow of City Patterns');

    // Initialize with middle point
    const midIndex = Math.floor(cleanedData.length / 2);
    updatePieChart(cleanedData[midIndex]);
  }

  createLegend(container, categories, chartWidth) {
    d3.select(container).selectAll('.theme-river-legend').remove();

    const legend = d3.select(container)
      .append('div')
      .attr('class', 'theme-river-legend')
      .style('margin-left', this.margin.left + 'px')
      .style('margin-right', this.margin.right + 'px');

    const legendItems = legend.selectAll('.theme-river-legend-item')
      .data(categories)
      .join('div')
      .attr('class', 'theme-river-legend-item');

    legendItems.append('div')
      .attr('class', 'theme-river-legend-color')
      .style('background-color', d => this.currentColorScheme[d] || '#95a5a6');

    legendItems.append('div')
      .attr('class', 'theme-river-legend-label')
      .text(d => d);
  }

  destroy() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
    d3.select(this.container).selectAll('*').remove();
  }
}

export default ThemeRiverChart;
