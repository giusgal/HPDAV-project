/**
 * AreaCharacteristics - React Container Component
 */


// TODO: Al primo caricamente della pagina, l'inizializzazione del SVG di D3 viene fatta 4 volte
// Sistemare in modo che venga fatta solo una volta

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useApi, fetchAreaCharacteristics } from '../../hooks/useApi';
import AreaCharacteristicsChart from './d3/AreaCharacteristicsChart';
import './AreaCharacteristics.css';

// Metric configuration - could be moved to a constants file
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
  // Refs - Persist values across renders without causing re-renders
  const svgRef = useRef(null);           // Reference to SVG DOM element
  const tooltipRef = useRef(null);       // Reference to tooltip DOM element
  const chartRef = useRef(null);         // Reference to D3 chart instance

  // State - UI state managed by React
  const [selectedMetric, setSelectedMetric] = useState('population');
  const [gridSize, setGridSize] = useState(500);
  const [hoveredCell, setHoveredCell] = useState(null);
  
  // API Data Fetching - Via useApi hook
  const { data, loading, error, refetch } = useApi(
    fetchAreaCharacteristics, 
    { gridSize }, 
    true  // autoFetch on mount
  );

  // Memoized Values - Only recompute when dependencies change
  
  // Current metric configuration object
  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric), 
    [selectedMetric]
  );

  // Process raw API data into format needed by D3
  const processedData = useMemo(() => {
    if (!data || !currentMetricConfig) return null;
    
    const categoryData = data[currentMetricConfig.category];
    if (!categoryData) return null;

    // Transform cells with current metric's value
    const cells = categoryData.map(cell => ({
      ...cell,
      value: cell[currentMetricConfig.key]
    })).filter(cell => cell.value != null);

    return { cells, bounds: data.bounds };
  }, [data, currentMetricConfig]);

  // Controller object - bridges D3 events to React state
  // useMemo ensures stable reference (D3 won't rebind events unnecessarily)
  const controller = useMemo(() => ({
    // Called by D3 when user hovers over a cell
    onCellHover: (cell, event) => {
      setHoveredCell(cell);
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${event.clientX + 10}px`;
        tooltipRef.current.style.top = `${event.clientY - 10}px`;
      }
    },
    
    // Called by D3 on mouse move (update tooltip position)
    onMouseMove: (event) => {
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${event.clientX + 10}px`;
        tooltipRef.current.style.top = `${event.clientY - 10}px`;
      }
    },
    
    // Called by D3 when mouse leaves a cell
    onCellLeave: () => {
      setHoveredCell(null);
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    },
  }), []); // Empty deps - controller is stable

  // Effects - Side effects and lifecycle management

  // Create D3 chart instance when SVG is available and data is ready
  // We need processedData as a dependency to re-run when loading finishes
  useEffect(() => {
    // Only initialize when SVG is available AND we have data (not loading)
    if (svgRef.current && processedData && !chartRef.current) {
      console.log('[AreaCharacteristics] Initializing D3 chart');
      chartRef.current = new AreaCharacteristicsChart(svgRef.current, controller);
      chartRef.current.initialize();
      
      // Immediately update with data
      requestAnimationFrame(() => {
        if (chartRef.current) {
          console.log('[AreaCharacteristics] Updating chart with data:', processedData.cells.length, 'cells');
          chartRef.current.update({
            cells: processedData.cells,
            bounds: processedData.bounds,
            gridSize,
            metricConfig: currentMetricConfig,
          });
        }
      });
    }

    // Cleanup function - runs on unmount
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [controller, processedData, gridSize, currentMetricConfig]);

  // Update D3 chart when data or metric changes (after initial render)
  useEffect(() => {
    if (chartRef.current && processedData) {
      // Use requestAnimationFrame to ensure DOM is ready and has dimensions
      const rafId = requestAnimationFrame(() => {
        if (chartRef.current) {
          console.log('[AreaCharacteristics] Updating chart:', processedData.cells.length, 'cells');
          chartRef.current.update({
            cells: processedData.cells,
            bounds: processedData.bounds,
            gridSize,
            metricConfig: currentMetricConfig,
          });
        }
      });
      
      return () => cancelAnimationFrame(rafId);
    }
  }, [processedData, gridSize, currentMetricConfig]);

  // Refetch data when gridSize changes
  useEffect(() => {
    refetch({ gridSize });
  }, [gridSize, refetch]);

  // Helper Functions to format values for tooltip display
  const formatValue = (value, metricId) => {
    if (value == null) return 'N/A';
    if (metricId.includes('pct')) return `${(value * 100).toFixed(1)}%`;
    if (metricId.includes('income') || metricId.includes('spending') || metricId.includes('cost') || metricId.includes('rent')) {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="visualization-container">
      {/* Controls - React handles UI, state changes trigger D3 updates */}
      <div className="controls">
        <div className="control-group">
          <label htmlFor="metric-select">Metric:</label>
          <select 
            id="metric-select"
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value)}
            disabled={loading}
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
            disabled={loading}
          >
            {GRID_SIZES.map(size => (
              <option key={size} value={size}>{size} units</option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Chart Container - SVG is always rendered so ref is available */}
      <div className="chart-container">
        {loading && (
          <div className="loading-overlay">Loading area characteristics...</div>
        )}
        {error && (
          <div className="error-overlay">Error: {error}</div>
        )}
        <svg ref={svgRef}></svg>
        
        {/* Tooltip - React renders content, D3 controls visibility/position */}
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {hoveredCell && (
            <>
              <strong>Area ({hoveredCell.grid_x}, {hoveredCell.grid_y})</strong>
              <br />
              {currentMetricConfig?.label}: {formatValue(hoveredCell.value, selectedMetric)}
              {hoveredCell.population && (
                <><br />Population: {hoveredCell.population}</>
              )}
            </>
          )}
        </div>
      </div>

      {/* Info Panel - Pure React rendering */}
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
