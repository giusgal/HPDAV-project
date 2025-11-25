import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi } from '../../hooks/useApi';
import { fetchAreaCharacteristics } from '../../api';

const METRICS = [
  { id: 'population', label: 'Population', category: 'demographics', key: 'population' },
  { id: 'avg_age', label: 'Average Age', category: 'demographics', key: 'avg_age' },
  { id: 'avg_joviality', label: 'Average Joviality', category: 'demographics', key: 'avg_joviality' },
  { id: 'pct_with_kids', label: '% With Kids', category: 'demographics', key: 'pct_with_kids' },
  { id: 'pct_graduate', label: '% Graduate Education', category: 'demographics', key: 'pct_graduate' },
  { id: 'avg_household_size', label: 'Avg Household Size', category: 'demographics', key: 'avg_household_size' },
  { id: 'avg_income', label: 'Average Income', category: 'financial', key: 'avg_income' },
  { id: 'avg_food_spending', label: 'Avg Food Spending', category: 'financial', key: 'avg_food_spending' },
  { id: 'avg_recreation_spending', label: 'Avg Recreation Spending', category: 'financial', key: 'avg_recreation_spending' },
  { id: 'avg_rental_cost', label: 'Average Rent', category: 'apartments', key: 'avg_rental_cost' },
  { id: 'apartment_count', label: 'Apartment Count', category: 'apartments', key: 'apartment_count' },
  { id: 'restaurant_count', label: 'Restaurant Count', category: 'venues', key: 'restaurant_count' },
  { id: 'pub_count', label: 'Pub Count', category: 'venues', key: 'pub_count' },
  { id: 'employer_count', label: 'Employer Count', category: 'venues', key: 'employer_count' },
];

const GRID_SIZES = [250, 500, 750, 1000];

function AreaCharacteristics() {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const [selectedMetric, setSelectedMetric] = useState('population');
  const [gridSize, setGridSize] = useState(500);
  const [hoveredCell, setHoveredCell] = useState(null);
  
  const { data, loading, error, refetch } = useApi(fetchAreaCharacteristics, { gridSize }, true);

  useEffect(() => {
    refetch({ gridSize });
  }, [gridSize]);

  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric), [selectedMetric]);

  const processedData = useMemo(() => {
    if (!data || !currentMetricConfig) return null;
    
    const categoryData = data[currentMetricConfig.category];
    if (!categoryData) return null;

    // Create a map for quick lookup
    const dataMap = new Map();
    categoryData.forEach(cell => {
      const key = `${cell.grid_x},${cell.grid_y}`;
      dataMap.set(key, cell);
    });

    // Get all grid cells with values
    const cells = categoryData.map(cell => ({
      ...cell,
      value: cell[currentMetricConfig.key]
    })).filter(cell => cell.value != null);

    return { cells, dataMap, bounds: data.bounds };
  }, [data, currentMetricConfig]);

  useEffect(() => {
    if (!processedData || !svgRef.current) return;

    const { cells, bounds } = processedData;
    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    
    // Calculate data dimensions to maintain aspect ratio
    const dataWidth = bounds.max_x - bounds.min_x;
    const dataHeight = bounds.max_y - bounds.min_y;
    const dataAspectRatio = dataWidth / dataHeight;
    
    // Set height based on width to maintain aspect ratio
    const margin = { top: 20, right: 120, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = innerWidth / dataAspectRatio; // Maintain aspect ratio
    const height = innerHeight + margin.top + margin.bottom;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales - Y-axis inverted to match image coordinates (top-down)
    const xExtent = [bounds.min_x, bounds.max_x];
    const yExtent = [bounds.min_y, bounds.max_y];
    
    const xScale = d3.scaleLinear()
      .domain(xExtent)
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain(yExtent)
      .range([innerHeight, 0]); // Inverted for image coordinates

    // Add clipping path to prevent cells from going outside the chart area
    svg.append('defs')
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Add basemap image as background
    // The basemap PNG is 1076x1144 pixels and should map to the full coordinate space
    g.append('image')
      .attr('href', `${process.env.PUBLIC_URL}/BaseMap.png`)
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('opacity', 0.4)
      .attr('preserveAspectRatio', 'none');

    const values = cells.map(c => c.value);
    const colorScale = d3.scaleSequential(d3.interpolateViridis)
      .domain([d3.min(values), d3.max(values)]);

    // Calculate cell dimensions in pixels
    const cellWidth = Math.abs(xScale(gridSize) - xScale(0));
    const cellHeight = Math.abs(yScale(0) - yScale(gridSize));

    // Create a group for cells with clipping
    const cellsGroup = g.append('g')
      .attr('clip-path', 'url(#chart-clip)');

    // Draw cells with transparency
    cellsGroup.selectAll('rect.cell')
      .data(cells)
      .enter()
      .append('rect')
      .attr('class', 'cell')
      .attr('x', d => xScale(d.grid_x * gridSize))
      .attr('y', d => yScale((d.grid_y + 1) * gridSize)) // +1 because Y is inverted
      .attr('width', cellWidth)
      .attr('height', cellHeight)
      .attr('fill', d => colorScale(d.value))
      .attr('opacity', 0.7)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        setHoveredCell(d);
        d3.select(event.target).attr('stroke', '#000').attr('stroke-width', 2);
        
        const tooltip = d3.select(tooltipRef.current);
        tooltip.style('display', 'block')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', (event) => {
        d3.select(tooltipRef.current)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', (event) => {
        setHoveredCell(null);
        d3.select(event.target).attr('stroke', '#fff').attr('stroke-width', 0.5);
        d3.select(tooltipRef.current).style('display', 'none');
      });

    // Axes - bottom for X
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', 35)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('X Coordinate');

    // Y axis - at top since Y increases downward in data space
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -innerHeight / 2)
      .attr('fill', '#000')
      .attr('text-anchor', 'middle')
      .text('Y Coordinate');

    // Color legend
    const legendWidth = 20;
    const legendHeight = innerHeight;
    const legendScale = d3.scaleLinear()
      .domain(colorScale.domain())
      .range([legendHeight, 0]);

    const legendAxis = d3.axisRight(legendScale).ticks(5);

    const legend = svg.append('g')
      .attr('transform', `translate(${width - margin.right + 20},${margin.top})`);

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'legend-gradient')
      .attr('x1', '0%').attr('y1', '100%')
      .attr('x2', '0%').attr('y2', '0%');

    gradient.selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .enter()
      .append('stop')
      .attr('offset', d => `${d * 100}%`)
      .attr('stop-color', d => colorScale(d3.min(values) + d * (d3.max(values) - d3.min(values))));

    legend.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', 'url(#legend-gradient)');

    legend.append('g')
      .attr('transform', `translate(${legendWidth},0)`)
      .call(legendAxis);

    legend.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -5)
      .attr('x', -legendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .text(currentMetricConfig.label);

  }, [processedData, gridSize, currentMetricConfig]);

  const formatValue = (value, metricId) => {
    if (value == null) return 'N/A';
    if (metricId.includes('pct')) return `${(value * 100).toFixed(1)}%`;
    if (metricId.includes('income') || metricId.includes('spending') || metricId.includes('cost') || metricId.includes('rent')) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div className="visualization-container">
        <div className="loading">Loading area characteristics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="visualization-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="visualization-container">
      <div className="controls">
        <div className="control-group">
          <label htmlFor="metric-select">Metric:</label>
          <select 
            id="metric-select"
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value)}
          >
            <optgroup label="Demographics">
              {METRICS.filter(m => m.category === 'demographics').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Financial">
              {METRICS.filter(m => m.category === 'financial').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Housing">
              {METRICS.filter(m => m.category === 'apartments').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="Venues">
              {METRICS.filter(m => m.category === 'venues').map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="grid-select">Grid Size:</label>
          <select 
            id="grid-select"
            value={gridSize} 
            onChange={(e) => setGridSize(Number(e.target.value))}
          >
            {GRID_SIZES.map(size => (
              <option key={size} value={size}>{size} units</option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="chart-container">
        <svg ref={svgRef}></svg>
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {hoveredCell && (
            <>
              <strong>Area ({hoveredCell.grid_x}, {hoveredCell.grid_y})</strong>
              <br />
              {currentMetricConfig.label}: {formatValue(hoveredCell.value, selectedMetric)}
              {hoveredCell.population && (
                <><br />Population: {hoveredCell.population}</>
              )}
            </>
          )}
        </div>
      </div>

      <div className="info-panel">
        <h3>About This Visualization</h3>
        <p>
          This heatmap shows the city divided into grid cells, with each cell colored 
          according to the selected metric. The data represents characteristics of 
          participants (volunteers) living in each area, assuming they are representative 
          of the city's population.
        </p>
        <p>
          <strong>Distinct areas can be identified by:</strong>
        </p>
        <ul>
          <li><strong>Demographics:</strong> Age distribution, education levels, household sizes</li>
          <li><strong>Financial:</strong> Income levels and spending patterns</li>
          <li><strong>Housing:</strong> Rental costs and apartment availability</li>
          <li><strong>Venues:</strong> Concentration of restaurants, pubs, and employers</li>
        </ul>
      </div>
    </div>
  );
}

export default AreaCharacteristics;
