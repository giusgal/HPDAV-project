/**
 * TrafficPatternsChart - D3 Pandemic-Style Bubble Map
 * 
 * Renders bubbles at exact location coordinates with size based on activity.
 */

import * as d3 from 'd3';

/**
 * Parse PostgreSQL polygon string to array of points.
 */
function parsePolygon(polygonStr) {
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
 * Compute bounds from building polygons with padding.
 */
function computeBoundsFromBuildings(buildings, paddingPercent = 0.05) {
  if (!buildings || buildings.length === 0) return null;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  buildings.forEach(b => {
    const pts = parsePolygon(b.location);
    if (!pts) return;
    pts.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
  });
  
  if (minX === Infinity) return null;
  
  const padX = (maxX - minX) * paddingPercent;
  const padY = (maxY - minY) * paddingPercent;
  return {
    min_x: minX - padX,
    max_x: maxX + padX,
    min_y: minY - padY,
    max_y: maxY + padY,
  };
}

class TrafficPatternsChart {
  /**
   * Create a new pandemic map chart instance.
   */
  constructor(container, controller) {
    this.container = container;
    this.controller = controller;
    this.svg = null;
    this.g = null;
    this.scales = {};
    this.dimensions = {};
    
    this.margin = { top: 20, right: 120, bottom: 40, left: 60 };
  }

  /**
   * Initialize the SVG structure.
   */
  initialize() {
    this.svg = d3.select(this.container);
    this.svg.selectAll('*').remove();
    
    this.svg
      .attr('width', '100%')
      .attr('height', 600);
    
    this.defs = this.svg.append('defs');
    
    this.g = this.svg.append('g')
      .attr('class', 'chart-content')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    
    this.baseMapGroup = this.g.append('g').attr('class', 'basemap-layer');
    this.bubblesGroup = this.g.append('g').attr('class', 'bubbles-layer');
    this.hotspotGroup = this.g.append('g').attr('class', 'hotspot-layer');
    this.axesGroup = this.g.append('g').attr('class', 'axes-layer');
    this.legendGroup = this.svg.append('g').attr('class', 'legend-layer');
  }

  /**
   * Update the chart with new data.
   */
  update({ locations, metricConfig, showBottlenecks, statistics, buildingsData }) {
    if (!locations || locations.length === 0 || !buildingsData?.buildings) return;

    const bounds = computeBoundsFromBuildings(buildingsData.buildings);
    if (!bounds) return;

    // Calculate dimensions
    const containerElement = this.container.parentElement;
    let containerWidth = containerElement ? containerElement.clientWidth : 800;
    
    if (containerWidth === 0 && containerElement) {
      const rect = containerElement.getBoundingClientRect();
      containerWidth = rect.width;
    }
    
    if (containerWidth === 0) containerWidth = 800;
    
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

    // Radius scale - sqrt for better visual perception
    const maxValue = d3.max(locations, d => d.value);
    this.scales.radius = d3.scaleSqrt()
      .domain([0, maxValue])
      .range([3, 40]);

    // Color scale
    this.scales.color = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([0, maxValue]);

    this.currentOptions = { showBottlenecks, statistics };

    // Render layers
    this.renderClipPath(innerWidth, innerHeight);
    this.renderBaseMap(buildingsData, innerWidth, innerHeight);
    this.renderBubbles(locations, showBottlenecks);
    this.renderHotspotMarkers(locations, showBottlenecks, statistics);
    this.renderAxes(innerWidth, innerHeight);
    this.renderLegend(metricConfig, innerHeight, containerWidth);
  }

  /**
   * Create clip path.
   */
  renderClipPath(width, height) {
    this.defs.select('#traffic-clip').remove();
    
    this.defs.append('clipPath')
      .attr('id', 'traffic-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);
    
    this.baseMapGroup.attr('clip-path', 'url(#traffic-clip)');
    this.bubblesGroup.attr('clip-path', 'url(#traffic-clip)');
    this.hotspotGroup.attr('clip-path', 'url(#traffic-clip)');
  }

  /**
   * Render building polygons as basemap.
   */
  renderBaseMap(buildingsData, width, height) {
    this.baseMapGroup.selectAll('*').remove();
    
    if (!buildingsData?.buildings) return;

    const { x: xScale, y: yScale } = this.scales;
    
    const lineGenerator = d3.line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveLinearClosed);

    const buildingsWithPaths = buildingsData.buildings
      .map(b => ({ ...b, points: parsePolygon(b.location) }))
      .filter(b => b.points && b.points.length >= 3);

    this.baseMapGroup.selectAll('path.building')
      .data(buildingsWithPaths)
      .join('path')
      .attr('class', 'building')
      .attr('d', d => lineGenerator(d.points))
      .attr('fill', d => {
        switch (d.buildingtype) {
          case 'Commercial': return 'rgba(52, 152, 219, 0.2)';
          case 'Residential':
          case 'Residental': return 'rgba(46, 204, 113, 0.2)';
          case 'School': return 'rgba(155, 89, 182, 0.2)';
          default: return 'rgba(100, 100, 100, 0.2)';
        }
      })
      .attr('stroke', '#999')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.5);
  }

  /**
   * Render bubbles at exact locations.
   */
  renderBubbles(locations, showBottlenecks) {
    const { x: xScale, y: yScale, radius: radiusScale, color: colorScale } = this.scales;

    this.bubblesGroup.selectAll('circle.bubble').remove();

    this.bubblesGroup.selectAll('circle.bubble')
      .data(locations)
      .join('circle')
      .attr('class', 'bubble')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', d => radiusScale(d.value))
      .attr('fill', d => colorScale(d.value))
      .attr('opacity', 0.7)
      .attr('stroke', d => (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#666')
      .attr('stroke-width', d => (showBottlenecks && d.isBottleneck) ? 2.5 : 0.8)
      .style('cursor', 'pointer')
      .call(this.bindBubbleEvents.bind(this));
  }

  /**
   * Render hotspot markers.
   */
  renderHotspotMarkers(locations, showBottlenecks, statistics) {
    this.hotspotGroup.selectAll('*').remove();
    
    if (!showBottlenecks || !statistics) return;

    const { x: xScale, y: yScale, radius: radiusScale } = this.scales;
    const hotspots = locations.filter(d => d.isBottleneck);

    this.hotspotGroup.selectAll('circle.hotspot-marker')
      .data(hotspots)
      .join('circle')
      .attr('class', 'hotspot-marker')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', d => radiusScale(d.value) + 6)
      .attr('fill', 'none')
      .attr('stroke', '#ff0000')
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '5,3')
      .attr('opacity', 0.8);
  }

  /**
   * Bind mouse events to bubbles.
   */
  bindBubbleEvents(selection) {
    const self = this;
    
    selection
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('stroke', '#000')
          .attr('stroke-width', 2.5)
          .attr('opacity', 0.95);
        
        self.controller.onBubbleHover(d, event);
      })
      .on('mousemove', function(event) {
        self.controller.onMouseMove(event);
      })
      .on('mouseout', function(event, d) {
        const { showBottlenecks } = self.currentOptions || {};
        d3.select(this)
          .attr('stroke', (showBottlenecks && d.isBottleneck) ? '#ff0000' : '#666')
          .attr('stroke-width', (showBottlenecks && d.isBottleneck) ? 2.5 : 0.8)
          .attr('opacity', 0.7);
        
        self.controller.onBubbleLeave();
      });
  }

  /**
   * Render X and Y axes.
   */
  renderAxes(width, height) {
    this.axesGroup.selectAll('*').remove();
    
    const xAxisGroup = this.axesGroup.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(this.scales.x).ticks(5));
    
    xAxisGroup.append('text')
      .attr('x', width / 2)
      .attr('y', 35)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('X Coordinate');

    const yAxisGroup = this.axesGroup.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(this.scales.y).ticks(5));
    
    yAxisGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -height / 2)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('Y Coordinate');
  }

  /**
   * Render the color legend.
   */
  renderLegend(metricConfig, height, containerWidth) {
    this.legendGroup.selectAll('*').remove();
    
    const legendWidth = 20;
    const legendHeight = height - this.margin.top - this.margin.bottom;
    
    this.legendGroup.attr('transform', 
      `translate(${containerWidth - this.margin.right + 20},${this.margin.top})`);

    const gradientId = 'pandemic-gradient';
    this.defs.select(`#${gradientId}`).remove();
    
    const gradient = this.defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    const colorDomain = this.scales.color.domain();
    
    gradient.selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .join('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => this.scales.color(d * colorDomain[1]));

    this.legendGroup.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', `url(#${gradientId})`);

    const legendScale = d3.scaleLinear()
      .domain(colorDomain)
      .range([legendHeight, 0]);

    this.legendGroup.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(d3.axisRight(legendScale).ticks(5).tickFormat(d3.format('.0f')));

    this.legendGroup.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(metricConfig?.label || 'Value');
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

/**
 * HourlyChart - D3 Visualization Class for hourly distribution.
 */
class HourlyChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 20, right: 20, bottom: 30, left: 50 };
  }

  initialize() {
    d3.select(this.container).selectAll('*').remove();
  }

  update({ hourlyData }) {
    if (!hourlyData || hourlyData.length === 0) return;

    const container = this.container;
    const width = container.clientWidth;
    const height = 150;
    const { top, right, bottom, left } = this.margin;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${left},${top})`);

    const xScale = d3.scaleBand()
      .domain(hourlyData.map(d => d.hour))
      .range([0, innerWidth])
      .padding(0.1);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(hourlyData, d => d.visits)])
      .range([innerHeight, 0]);

    const maxVisits = d3.max(hourlyData, d => d.visits);

    g.selectAll('rect')
      .data(hourlyData)
      .join('rect')
      .attr('x', d => xScale(d.hour))
      .attr('y', d => yScale(d.visits))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerHeight - yScale(d.visits))
      .attr('fill', d => {
        if (d.visits > maxVisits * 0.8) return '#d62728';
        if (d.visits > maxVisits * 0.6) return '#ff7f0e';
        return '#1f77b4';
      });

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues([0, 6, 12, 18, 23]))
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', 25)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .text('Hour of Day');

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('.2s')));
  }

  destroy() {
    d3.select(this.container).selectAll('*').remove();
  }
}

export { TrafficPatternsChart, HourlyChart };
export default TrafficPatternsChart;
