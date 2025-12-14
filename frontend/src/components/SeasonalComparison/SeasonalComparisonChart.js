/**
 * SeasonalComparisonChart - D3 Visualizations for Seasonal Pattern Analysis
 * 
 * Contains multiple chart classes for comparing seasonal patterns:
 * - RadarChart: Multi-dimensional comparison across seasons
 * - CalendarHeatmap: Activity calendar showing daily patterns across months
 * - SeasonalBarChart: Grouped bar chart comparing metrics by season
 */

import * as d3 from 'd3';

// Season definitions
const SEASONS = {
  spring: { name: 'Spring', months: [3, 4, 5], color: '#27ae60' },
  summer: { name: 'Summer', months: [6, 7, 8], color: '#f39c12' },
  fall: { name: 'Fall', months: [9, 10, 11], color: '#e67e22' },
  winter: { name: 'Winter', months: [12, 1, 2], color: '#3498db' }
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * RadarChart - Multi-dimensional seasonal comparison
 */
export class RadarChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 60, right: 180, bottom: 60, left: 60 };
    this.tooltip = null;
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
    
    this.tooltip = d3.select('body')
      .append('div')
      .attr('class', 'seasonal-tooltip')
      .style('opacity', 0);
  }

  update({ seasonalData, dimensions }) {
    if (!seasonalData || Object.keys(seasonalData).length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    // Use fixed large size for the radar
    const size = Math.min(container.clientWidth - this.margin.left - this.margin.right, 500);
    const width = size;
    const height = size;
    const radius = size / 2 - 20;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${width/2 + this.margin.left},${height/2 + this.margin.top})`);

    // Dimension labels for radar
    const dimensionLabels = {
      restaurant_visits: 'Restaurants',
      pub_visits: 'Pubs',
      home_activity: 'Home',
      work_activity: 'Work',
      morning_activity: 'Morning',
      evening_activity: 'Evening'
    };

    const dims = dimensions || Object.keys(dimensionLabels);
    const angleSlice = (Math.PI * 2) / dims.length;

    // Create separate scale for each dimension (independent axes)
    const dimensionScales = {};
    dims.forEach(dim => {
      const values = Object.values(seasonalData).map(s => s[dim] || 0);
      const max = d3.max(values) || 1;
      dimensionScales[dim] = d3.scaleLinear()
        .domain([0, max])
        .range([0, radius]);
    });

    // Draw circular grid
    const levels = 5;
    for (let level = 1; level <= levels; level++) {
      const r = (radius / levels) * level;
      svg.append('circle')
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', level === levels ? '#bbb' : '#eee')
        .attr('stroke-dasharray', level === levels ? 'none' : '2,2');
    }

    // Draw axis lines and labels
    dims.forEach((dim, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      svg.append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', x)
        .attr('y2', y)
        .attr('stroke', '#ddd');

      // Labels with max value
      const labelRadius = radius + 30;
      const labelX = Math.cos(angle) * labelRadius;
      const labelY = Math.sin(angle) * labelRadius;
      const maxValue = dimensionScales[dim].domain()[1];

      svg.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .text(dimensionLabels[dim] || dim);
      
      // Add max value label
      svg.append('text')
        .attr('x', labelX)
        .attr('y', labelY + 15)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#999')
        .text(`max: ${d3.format('.2s')(maxValue)}`);
    });

    // Draw radar areas for each season using per-dimension scales
    const radarLine = d3.lineRadial()
      .radius((d, i) => dimensionScales[dims[i]](d.value))
      .angle((d, i) => i * angleSlice)
      .curve(d3.curveLinearClosed);

    const seasons = Object.keys(SEASONS);
    const tooltip = this.tooltip;

    seasons.forEach((seasonKey) => {
      const season = SEASONS[seasonKey];
      const data = seasonalData[seasonKey];
      if (!data) return;

      const points = dims.map(dim => ({
        axis: dim,
        value: data[dim] || 0
      }));

      // Draw area with global scale
      svg.append('path')
        .datum(points)
        .attr('d', radarLine)
        .attr('fill', season.color)
        .attr('fill-opacity', 0.15)
        .attr('stroke', season.color)
        .attr('stroke-width', 2.5)
        .on('mouseover', function(event) {
          d3.select(this).attr('fill-opacity', 0.35);
          
          let tooltipContent = `<h4>${season.name}</h4>`;
          points.forEach(p => {
            tooltipContent += `<div class="tooltip-row">
              <span class="tooltip-label">${dimensionLabels[p.axis] || p.axis}:</span>
              <span class="tooltip-value">${d3.format(',')(Math.round(p.value))}</span>
            </div>`;
          });
          
          tooltip
            .style('opacity', 1)
            .html(tooltipContent)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
          d3.select(this).attr('fill-opacity', 0.15);
          tooltip.style('opacity', 0);
        });

      // Draw points using per-dimension scales
      points.forEach((point, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        const r = dimensionScales[point.axis](point.value);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        svg.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', 5)
          .attr('fill', season.color)
          .attr('stroke', 'white')
          .attr('stroke-width', 2);
      });
    });

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${radius + 50}, ${-radius + 30})`);

    seasons.forEach((seasonKey, i) => {
      const season = SEASONS[seasonKey];
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 28})`);

      g.append('rect')
        .attr('width', 20)
        .attr('height', 20)
        .attr('fill', season.color)
        .attr('rx', 3);

      g.append('text')
        .attr('x', 26)
        .attr('y', 15)
        .attr('font-size', '14px')
        .text(season.name);
    });
  }

  destroy() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }
}

/**
 * CalendarHeatmap - GitHub-style horizontal calendar showing activity patterns
 * Supports filtering by day type and time period, plus compare mode
 */
export class CalendarHeatmap {
  constructor(container) {
    this.container = container;
    this.margin = { top: 50, right: 40, bottom: 30, left: 50 };
    this.tooltip = null;
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
    
    this.tooltip = d3.select('body')
      .append('div')
      .attr('class', 'seasonal-tooltip')
      .style('opacity', 0);
  }

  update({ dailyData, metric = 'total_checkins', dayTypeFilter = 'all', timePeriodFilter = 'all', compareMode = false, compareMetric = 'pub_visits', activeCategories = null }) {
    if (!dailyData || dailyData.length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    
    // Default categories if not provided
    const categories = activeCategories || { restaurant: true, pub: true, home: true, work: true };
    
    // Calculate combined value based on active categories
    const getCombinedCategoryValue = (d) => {
      let total = 0;
      if (categories.restaurant) total += d.restaurant_visits || 0;
      if (categories.pub) total += d.pub_visits || 0;
      if (categories.home) total += d.home_activity || 0;
      if (categories.work) total += d.work_activity || 0;
      return total;
    };
    
    // Get metric value
    const getMetricValue = (d) => {
      if (timePeriodFilter !== 'all') {
        const timeMetricMap = {
          morning: 'morning_activity',
          afternoon: 'midday_activity',
          evening: 'evening_activity',
          night: 'night_activity'
        };
        return d[timeMetricMap[timePeriodFilter]] || 0;
      }
      return getCombinedCategoryValue(d);
    };

    // Filter and process data
    let data = dailyData.map(d => {
      const date = parseDate(d.period);
      if (!date) return null;
      
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      // Apply day type filter
      if (dayTypeFilter === 'weekday' && isWeekend) return null;
      if (dayTypeFilter === 'weekend' && !isWeekend) return null;
      
      return {
        ...d,
        date,
        value: getMetricValue(d),
        isWeekend
      };
    }).filter(d => d !== null);

    // Get date extent
    const dateExtent = d3.extent(data, d => d.date);
    
    // Calculate dimensions for GitHub-style calendar - LARGER cells
    const cellSize = compareMode ? 12 : 16;
    const cellPadding = 3;
    const yearHeight = (cellSize + cellPadding) * 7 + 40;
    
    // Group by year
    const years = d3.groups(data, d => d.date.getFullYear()).sort((a, b) => a[0] - b[0]);
    
    // In compare mode, we need space for two calendars side by side
    const calendarWidth = compareMode ? (container.clientWidth - this.margin.left - this.margin.right - 50) / 2 : container.clientWidth - this.margin.left - this.margin.right;
    const totalHeight = years.length * yearHeight + this.margin.top + this.margin.bottom + 30;
    const width = container.clientWidth - this.margin.left - this.margin.right;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', totalHeight)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Color scale - simple sequential (light to dark blue)
    const nonZeroValues = data.map(d => d.value).filter(v => v > 0);
    const minValue = d3.min(nonZeroValues) || 0;
    const maxValue = d3.max(nonZeroValues) || 100;
    
    const colorScale = d3.scaleSequential(d3.interpolateBlues)
      .domain([0, maxValue]);

    // Create lookup for fast data access
    const dataLookup = new Map(data.map(d => [d3.timeFormat('%Y-%m-%d')(d.date), d]));

    const tooltip = this.tooltip;
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Metric labels for display
    const metricLabels = {
      total_checkins: 'Selected Categories',
      unique_visitors: 'Unique Visitors',
      restaurant_visits: 'Restaurant',
      pub_visits: 'Pub',
      home_activity: 'Home',
      work_activity: 'Work',
      morning_activity: 'Morning',
      evening_activity: 'Evening',
      categories: 'Selected Categories'
    };
    
    // Category colors for legend
    const categoryColors = {
      work: '#2ecc71',
      home: '#3498db',
      restaurant: '#e74c3c',
      pub: '#f39c12'
    };

    // Build active categories label
    const getActiveCategoriesLabel = () => {
      const active = [];
      if (categories.work) active.push('Work');
      if (categories.home) active.push('Home');
      if (categories.restaurant) active.push('Restaurant');
      if (categories.pub) active.push('Pub');
      return active.length > 0 ? active.join(' + ') : 'None';
    };

    // Add title for primary metric
    svg.append('text')
      .attr('x', compareMode ? calendarWidth / 2 : width / 2)
      .attr('y', -25)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .attr('fill', '#2c3e50')
      .text(metric === 'total_checkins' ? getActiveCategoriesLabel() : (metricLabels[metric] || metric));

    // Add title for compare metric if in compare mode
    if (compareMode) {
      svg.append('text')
        .attr('x', calendarWidth + 50 + calendarWidth / 2)
        .attr('y', -25)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('font-weight', '600')
        .attr('fill', '#3498db')
        .text(metricLabels[compareMetric] || compareMetric);
    }

    // Function to draw a calendar
    const drawCalendar = (offsetX, useCompareValue, scale) => {
      years.forEach(([year, yearData], yearIndex) => {
        const yearGroup = svg.append('g')
          .attr('transform', `translate(${offsetX}, ${yearIndex * yearHeight})`);

        // Year label
        yearGroup.append('text')
          .attr('x', -5)
          .attr('y', (cellSize + cellPadding) * 3.5)
          .attr('text-anchor', 'end')
          .attr('font-size', '11px')
          .attr('font-weight', '700')
          .attr('fill', '#333')
          .text(year);

        // Get all days in this year that we have data for
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31);
        const startDate = new Date(Math.max(yearStart, dateExtent[0]));
        const endDate = new Date(Math.min(yearEnd, dateExtent[1]));
        
        // Get first Sunday on or before start date for alignment
        const firstSunday = d3.timeSunday.floor(startDate);
        
        // Generate all days
        const days = d3.timeDays(firstSunday, d3.timeDay.offset(endDate, 1));

        // Draw day cells
        days.forEach((day) => {
          const dayOfWeek = day.getDay();
          const weekIndex = d3.timeWeek.count(firstSunday, day);
          const dateKey = d3.timeFormat('%Y-%m-%d')(day);
          const dayData = dataLookup.get(dateKey);
          const value = dayData ? (useCompareValue ? dayData.compareValue : dayData.value) : 0;
          const hasData = dataLookup.has(dateKey);

          yearGroup.append('rect')
            .attr('class', 'day-cell')
            .attr('x', weekIndex * (cellSize + cellPadding) + 25)
            .attr('y', dayOfWeek * (cellSize + cellPadding))
            .attr('width', cellSize)
            .attr('height', cellSize)
            .attr('fill', hasData ? (value > 0 ? scale(value) : '#ebedf0') : '#f6f6f6')
            .attr('rx', 2)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .style('cursor', hasData ? 'pointer' : 'default')
            .on('mouseover', function(event) {
              if (!hasData) return;
              d3.select(this).attr('stroke', '#2c3e50').attr('stroke-width', 2);
              
              const fullData = dataLookup.get(dateKey);
              const dayType = fullData?.isWeekend ? 'Weekend' : 'Weekday';
              
              let tooltipContent = `
                <h4>${d3.timeFormat('%B %d, %Y')(day)} (${dayType})</h4>
                <div class="tooltip-row">
                  <span class="tooltip-label">Activity:</span>
                  <span class="tooltip-value" style="font-weight:bold">${d3.format(',')(value)}</span>
                </div>
              `;
              
              // Show breakdown by category
              if (metric === 'total_checkins') {
                tooltipContent += '<div style="margin-top:5px; border-top: 1px solid rgba(255,255,255,0.3); padding-top:5px; font-size:11px;">';
                if (categories.work) {
                  tooltipContent += `<div class="tooltip-row"><span class="tooltip-label" style="color:#2ecc71">💼 Work:</span><span class="tooltip-value">${d3.format(',')(fullData?.work_activity || 0)}</span></div>`;
                }
                if (categories.home) {
                  tooltipContent += `<div class="tooltip-row"><span class="tooltip-label" style="color:#3498db">🏠 Home:</span><span class="tooltip-value">${d3.format(',')(fullData?.home_activity || 0)}</span></div>`;
                }
                if (categories.restaurant) {
                  tooltipContent += `<div class="tooltip-row"><span class="tooltip-label" style="color:#e74c3c">🍽️ Restaurant:</span><span class="tooltip-value">${d3.format(',')(fullData?.restaurant_visits || 0)}</span></div>`;
                }
                if (categories.pub) {
                  tooltipContent += `<div class="tooltip-row"><span class="tooltip-label" style="color:#f39c12">🍺 Pub:</span><span class="tooltip-value">${d3.format(',')(fullData?.pub_visits || 0)}</span></div>`;
                }
                tooltipContent += '</div>';
              }
              
              tooltip
                .style('opacity', 1)
                .html(tooltipContent)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function() {
              d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
              tooltip.style('opacity', 0);
            });
        });

        // Add month labels
        const monthStarts = d3.timeMonths(startDate, d3.timeMonth.offset(endDate, 1));
        monthStarts.forEach(monthStart => {
          const weekIndex = d3.timeWeek.count(firstSunday, monthStart);
          yearGroup.append('text')
            .attr('x', weekIndex * (cellSize + cellPadding) + 25)
            .attr('y', -8)
            .attr('font-size', '9px')
            .attr('fill', '#666')
            .text(monthLabels[monthStart.getMonth()]);
        });
      });
    };

    // Draw primary calendar
    drawCalendar(0, false, colorScale);

    // Add day labels on the left (only once)
    const dayLabelGroup = svg.append('g');
    [1, 3, 5].forEach(i => {
      dayLabelGroup.append('text')
        .attr('x', 20)
        .attr('y', i * (cellSize + cellPadding) + cellSize / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#666')
        .text(dayLabels[i]);
    });

    // Simple color legend
    this.drawLegend(svg, colorScale, minValue, maxValue, width - 160, -25);
  }

  drawLegend(svg, colorScale, minValue, maxValue, x, y) {
    const legendWidth = 120;
    const legendHeight = 8;
    const legend = svg.append('g')
      .attr('transform', `translate(${x}, ${y})`);

    // Labels
    legend.append('text')
      .attr('x', -5)
      .attr('y', legendHeight / 2 + 3)
      .attr('font-size', '9px')
      .attr('fill', '#666')
      .attr('text-anchor', 'end')
      .text('Low');

    legend.append('text')
      .attr('x', legendWidth + 5)
      .attr('y', legendHeight / 2 + 3)
      .attr('font-size', '9px')
      .attr('fill', '#666')
      .text('High');

    // Legend gradient squares
    const legendSteps = 7;
    const legendSquareSize = legendWidth / legendSteps;
    for (let i = 0; i < legendSteps; i++) {
      const value = minValue + (i / (legendSteps - 1)) * (maxValue - minValue);
      legend.append('rect')
        .attr('x', i * legendSquareSize)
        .attr('y', 0)
        .attr('width', legendSquareSize - 1)
        .attr('height', legendHeight)
        .attr('fill', colorScale(value))
        .attr('rx', 1);
    }
  }

  destroy() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }
}

/**
 * TimelineChart - Line/Area chart showing temporal patterns
 * Synchronized with calendar filters
 */
export class TimelineChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 20, right: 30, bottom: 30, left: 50 };
    this.tooltip = null;
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
    
    this.tooltip = d3.select('body')
      .append('div')
      .attr('class', 'seasonal-tooltip')
      .style('opacity', 0);
  }

  update({ dailyData, granularity = 'daily', activeCategories = null }) {
    if (!dailyData || dailyData.length === 0) return;

    const container = this.container;
    d3.select(container).selectAll('*').remove();

    const width = container.clientWidth - this.margin.left - this.margin.right;
    const height = container.clientHeight - this.margin.top - this.margin.bottom - 10;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const categories = activeCategories || { restaurant: true, pub: true, home: true, work: true };

    // Category colors and labels
    const categoryConfig = {
      restaurant: { key: 'restaurant_visits', color: '#e74c3c', label: 'Restaurant' },
      pub: { key: 'pub_visits', color: '#f39c12', label: 'Pub' },
      home: { key: 'home_activity', color: '#3498db', label: 'Home' },
      work: { key: 'work_activity', color: '#2ecc71', label: 'Work' }
    };

    // Process data
    let data = dailyData.map(d => {
      const date = parseDate(d.period);
      if (!date) return null;
      
      return {
        date,
        restaurant_visits: d.restaurant_visits || 0,
        pub_visits: d.pub_visits || 0,
        home_activity: d.home_activity || 0,
        work_activity: d.work_activity || 0
      };
    }).filter(d => d !== null);

    // Sort by date
    data.sort((a, b) => a.date - b.date);

    // Get active categories for display
    const activeKeys = Object.entries(categories)
      .filter(([_, active]) => active)
      .map(([cat, _]) => categoryConfig[cat]);

    if (activeKeys.length === 0) return;

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date))
      .range([0, width]);

    const maxY = d3.max(data, d => {
      return d3.max(activeKeys.map(k => d[k.key]));
    });

    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    // Line generator
    const line = d3.line()
      .x(d => x(d.date))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    // Draw a line for each active category
    activeKeys.forEach(cat => {
      const lineData = data.map(d => ({ date: d.date, value: d[cat.key] }));
      
      // Draw line
      svg.append('path')
        .datum(lineData)
        .attr('fill', 'none')
        .attr('stroke', cat.color)
        .attr('stroke-width', 2)
        .attr('d', line);
    });

    // X axis with appropriate date format based on granularity
    const dateFormat = granularity === 'daily' ? '%b %d' : granularity === 'weekly' ? '%b %d' : '%b %Y';
    const tickCount = granularity === 'daily' ? (width > 500 ? 15 : 8) : granularity === 'weekly' ? 10 : 12;
    
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(tickCount).tickFormat(d3.timeFormat(dateFormat)))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('fill', '#666')
      .attr('transform', granularity === 'daily' ? 'rotate(-45)' : 'rotate(0)')
      .style('text-anchor', granularity === 'daily' ? 'end' : 'middle');

    // Y axis
    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2s')))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('fill', '#666');

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 100}, 5)`);

    activeKeys.forEach((cat, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 18})`);
      
      g.append('line')
        .attr('x1', 0)
        .attr('x2', 16)
        .attr('y1', 6)
        .attr('y2', 6)
        .attr('stroke', cat.color)
        .attr('stroke-width', 2);
      
      g.append('text')
        .attr('x', 22)
        .attr('y', 10)
        .attr('font-size', '10px')
        .attr('fill', '#666')
        .text(cat.label);
    });

    // Add hover interaction
    const tooltip = this.tooltip;
    const bisect = d3.bisector(d => d.date).left;

    const focus = svg.append('g').style('display', 'none');
    
    // Vertical line
    focus.append('line')
      .attr('class', 'focus-line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#999')
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-width', 1);

    // Dots for each category
    activeKeys.forEach(cat => {
      focus.append('circle')
        .attr('class', `focus-dot-${cat.key}`)
        .attr('r', 4)
        .attr('fill', cat.color)
        .attr('stroke', 'white')
        .attr('stroke-width', 2);
    });

    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => {
        focus.style('display', 'none');
        tooltip.style('opacity', 0);
      })
      .on('mousemove', function(event) {
        const x0 = x.invert(d3.pointer(event)[0]);
        const i = bisect(data, x0, 1);
        const d0 = data[i - 1];
        const d1 = data[i];
        if (!d0 || !d1) return;
        const d = x0 - d0.date > d1.date - x0 ? d1 : d0;
        
        // Move vertical line
        focus.select('.focus-line')
          .attr('transform', `translate(${x(d.date)}, 0)`);
        
        // Move dots
        activeKeys.forEach(cat => {
          focus.select(`.focus-dot-${cat.key}`)
            .attr('transform', `translate(${x(d.date)}, ${y(d[cat.key])})`);
        });
        
        // Build tooltip content with appropriate date format
        const tooltipDateFormat = granularity === 'monthly' ? '%B %Y' : '%b %d, %Y';
        let tooltipContent = `<strong>${d3.timeFormat(tooltipDateFormat)(d.date)}</strong><br/>`;
        activeKeys.forEach(cat => {
          tooltipContent += `<span style="color:${cat.color}">●</span> ${cat.label}: ${d3.format(',')(d[cat.key])}<br/>`;
        });
        
        tooltip
          .style('opacity', 1)
          .html(tooltipContent)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 30) + 'px');
      });
  }

  destroy() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }
}

export default { RadarChart, CalendarHeatmap, TimelineChart };
