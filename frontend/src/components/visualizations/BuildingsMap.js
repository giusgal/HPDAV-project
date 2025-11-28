/**
 * BuildingsMap - React Container Component
 * Displays city map with building polygons and venue location points
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useApi, fetchBuildingsMapData } from '../../hooks/useApi';
import BuildingsMapChart from './d3/BuildingsMapChart';
import './BuildingsMap.css';

// Venue layer configuration
const VENUE_LAYERS = [
  { id: 'apartments', label: 'Apartments', color: '#3498db' },
  { id: 'employers', label: 'Employers', color: '#e74c3c' },
  { id: 'pubs', label: 'Pubs', color: '#9b59b6' },
  { id: 'restaurants', label: 'Restaurants', color: '#f39c12' },
  { id: 'schools', label: 'Schools', color: '#2ecc71' },
];

function BuildingsMap() {
  // Refs
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const chartRef = useRef(null);

  // State - which venue layers are visible
  const [visibleLayers, setVisibleLayers] = useState({
    apartments: true  ,
    employers: true ,
    pubs: true  ,
    restaurants: true ,
    schools: true ,
  });

  const [hoveredItem, setHoveredItem] = useState(null);

  // API Data Fetching
  const { data, loading, error } = useApi(fetchBuildingsMapData, {}, true);

  // Controller object - bridges D3 events to React state
  const controller = useMemo(() => ({
    onBuildingHover: (building, event) => {
      setHoveredItem({ type: 'building', data: building });
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${event.clientX + 10}px`;
        tooltipRef.current.style.top = `${event.clientY - 10}px`;
      }
    },

    onVenueHover: (venue, venueType, event) => {
      setHoveredItem({ type: venueType, data: venue });
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${event.clientX + 10}px`;
        tooltipRef.current.style.top = `${event.clientY - 10}px`;
      }
    },

    onMouseMove: (event) => {
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${event.clientX + 10}px`;
        tooltipRef.current.style.top = `${event.clientY - 10}px`;
      }
    },

    onItemLeave: () => {
      setHoveredItem(null);
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    },
  }), []);

  // Handle checkbox changes
  const handleLayerToggle = (layerId) => {
    setVisibleLayers(prev => ({
      ...prev,
      [layerId]: !prev[layerId]
    }));
  };

  // Create D3 chart instance when SVG is available and data is ready
  /* Oss: this is called only once to initalize svg (create basic svg groups structure)
   * Data is a dep, as it is handled by useApi and initialization may be triggered when it becomes != null
   * controller is a dep, as it appears in the BuildingsMapChart constructor
   * svgRef and visibleLayers are not deps, as they are refs and state that do not change identity
   * svgRef in particular was initialized to null
   *    It becomes non-null when the svg element is mounted (it is in component return (svg ref={svgRef}></svg>))
  */
  useEffect(() => {
    if (svgRef.current && data && !chartRef.current) {
      console.log('[BuildingsMap] Initializing D3 chart');
      chartRef.current = new BuildingsMapChart(svgRef.current, controller);
      chartRef.current.initialize();

      requestAnimationFrame(() => {
        if (chartRef.current) {
          chartRef.current.update({
            buildings: data.buildings,
            venues: data.venues,
            bounds: data.bounds,
            visibleLayers,
          });
        }
      });
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [controller, data]);

  // Update D3 chart when visible layers change
  useEffect(() => {
    if (chartRef.current && data) {
      requestAnimationFrame(() => {
        if (chartRef.current) {
          chartRef.current.update({
            buildings: data.buildings,
            venues: data.venues,
            bounds: data.bounds,
            visibleLayers,
          });
        }
      });
    }
  }, [data, visibleLayers]);

  // Tooltip content rendering
  const renderTooltipContent = () => {
    if (!hoveredItem) return null;

    const { type, data: itemData } = hoveredItem;

    if (type === 'building') {
      return (
        <>
          <strong>Building #{itemData.buildingid}</strong>
          <br />
          Type: {itemData.buildingtype || 'Unknown'}
          <br />
          Max Occupancy: {itemData.maxoccupancy || 'N/A'}
        </>
      );
    }

    // Venue types
    const venueLabels = {
      apartments: 'Apartment',
      employers: 'Employer',
      pubs: 'Pub',
      restaurants: 'Restaurant',
      schools: 'School',
    };

    return (
      <>
        <strong>{venueLabels[type]} #{itemData.id}</strong>
        <br />
        Building ID: {itemData.buildingid}
        {itemData.rentalcost && <><br />Rental Cost: ${itemData.rentalcost.toFixed(2)}</>}
        {itemData.hourlycost && <><br />Hourly Cost: ${itemData.hourlycost.toFixed(2)}</>}
        {itemData.foodcost && <><br />Food Cost: ${itemData.foodcost.toFixed(2)}</>}
        {itemData.monthlyfees && <><br />Monthly Fees: ${itemData.monthlyfees.toFixed(2)}</>}
        {itemData.maxoccupancy && <><br />Max Occupancy: {itemData.maxoccupancy}</>}
        {itemData.maxenrollment && <><br />Max Enrollment: {itemData.maxenrollment}</>}
      </>
    );
  };

  return (
    <div className="visualization-container buildings-map-container">
      {/* Controls - Checkboxes for venue layers */}
      <div className="controls">
        <div className="control-group layer-controls">
          <label className="control-label">Show Venues:</label>
          <div className="checkbox-group">
            {VENUE_LAYERS.map(layer => (
              <label key={layer.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={visibleLayers[layer.id]}
                  onChange={() => handleLayerToggle(layer.id)}
                  disabled={loading}
                />
                <span 
                  className="color-indicator" 
                  style={{ backgroundColor: layer.color }}
                />
                {layer.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="chart-container">
        {loading && (
          <div className="loading-overlay">Loading buildings map...</div>
        )}
        {error && (
          <div className="error-overlay">Error: {error}</div>
        )}
        <svg ref={svgRef}></svg>

        {/* Tooltip */}
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {renderTooltipContent()}
        </div>
      </div>

      {/* Legend */}
      <div className="legend-panel">
        <h4>Legend</h4>
        <div className="legend-item">
          <span className="legend-polygon" style={{ backgroundColor: 'rgba(100, 100, 100, 0.3)', border: '1px solid #333' }}></span>
          Building Polygon
        </div>
        {VENUE_LAYERS.filter(l => visibleLayers[l.id]).map(layer => (
          <div key={layer.id} className="legend-item">
            <span className="legend-circle" style={{ backgroundColor: layer.color }}></span>
            {layer.label}
          </div>
        ))}
      </div>

      {/* Info Panel */}
      <div className="info-panel">
        <h3>About This Visualization</h3>
        <p>
          This map displays all buildings in the city as polygons, with their actual 
          geographic footprints. Use the checkboxes above to overlay the locations 
          of different venue types:
        </p>
        <ul>
          <li><strong>Apartments:</strong> Residential units where participants live</li>
          <li><strong>Employers:</strong> Workplaces where participants are employed</li>
          <li><strong>Pubs:</strong> Social gathering places for recreation</li>
          <li><strong>Restaurants:</strong> Dining establishments</li>
          <li><strong>Schools:</strong> Educational institutions</li>
        </ul>
        <p>
          Hover over buildings or venue points to see detailed information.
        </p>
      </div>
    </div>
  );
}

export default BuildingsMap;
