import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchVenueVisits, fetchVenueList } from '../../hooks/useApi';
import VenueVisitsChart from './VenueVisitsChart';
import './VenueVisits.css';

const VenueVisits = () => {
  const [venueList, setVenueList] = useState(null);
  const [visitsData, setVisitsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Parameters
  const [venueType, setVenueType] = useState('Restaurant');
  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const [granularity, setGranularity] = useState('weekly');
  
  // Refs for D3 chart
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // Load venue list when venue type changes
  const loadVenueList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVenueList({ venueType });
      setVenueList(result);
      // Auto-select first venue if none selected
      if (result.venues && result.venues.length > 0 && !selectedVenueId) {
        setSelectedVenueId(result.venues[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load venue list');
    } finally {
      setLoading(false);
    }
  }, [venueType]);

  // Load visits data for selected venue
  const loadVisitsData = useCallback(async () => {
    if (!selectedVenueId) return;
    
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVenueVisits({ 
        venueType, 
        venueId: selectedVenueId, 
        granularity 
      });
      setVisitsData(result);
    } catch (err) {
      setError(err.message || 'Failed to load visits data');
    } finally {
      setLoading(false);
    }
  }, [venueType, selectedVenueId, granularity]);

  // Load venue list when type changes
  useEffect(() => {
    setSelectedVenueId(null);
    setVisitsData(null);
    loadVenueList();
  }, [venueType, loadVenueList]);

  // Load visits data when venue or granularity changes
  useEffect(() => {
    if (selectedVenueId) {
      loadVisitsData();
    }
  }, [selectedVenueId, granularity, loadVisitsData]);

  // Update chart when data changes
  useEffect(() => {
    if (!chartRef.current || !visitsData?.visits) return;

    if (!chartInstance.current) {
      chartInstance.current = new VenueVisitsChart(chartRef.current);
      chartInstance.current.initialize();
    }

    const selectedVenue = venueList?.venues?.find(v => v.id === selectedVenueId);
    chartInstance.current.update({
      visitsData: visitsData.visits,
      venueName: selectedVenue?.name || `${venueType} #${selectedVenueId}`,
      granularity
    });
  }, [visitsData, venueList, selectedVenueId, venueType, granularity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, []);

  const handleVenueTypeChange = (e) => {
    setVenueType(e.target.value);
  };

  const handleVenueChange = (e) => {
    setSelectedVenueId(parseInt(e.target.value, 10));
  };

  const handleGranularityChange = (e) => {
    setGranularity(e.target.value);
  };

  return (
    <div className="venue-visits-container">
      <div className="venue-visits-controls">
        <div className="control-group">
          <label htmlFor="venue-type">Venue Type:</label>
          <select 
            id="venue-type" 
            value={venueType} 
            onChange={handleVenueTypeChange}
          >
            <option value="Restaurant">Restaurant</option>
            <option value="Pub">Pub/Bar</option>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="venue-select">Select Venue:</label>
          <select 
            id="venue-select" 
            value={selectedVenueId || ''} 
            onChange={handleVenueChange}
            disabled={!venueList?.venues?.length}
          >
            <option value="" disabled>-- Select a venue --</option>
            {venueList?.venues?.map(venue => (
              <option key={venue.id} value={venue.id}>
                {venue.name || `${venueType} #${venue.id}`} ({venue.total_visits} visits)
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="granularity">Time Granularity:</label>
          <select 
            id="granularity" 
            value={granularity} 
            onChange={handleGranularityChange}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      {loading && <div className="loading-indicator">Loading...</div>}
      {error && <div className="error-message">Error: {error}</div>}
      
      <div className="venue-visits-chart-container">
        <div ref={chartRef} className="venue-visits-chart"></div>
      </div>

      {visitsData && (
        <div className="venue-stats">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total Visits:</span>
              <span className="stat-value">{visitsData.total_visits?.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Unique Visitors:</span>
              <span className="stat-value">{visitsData.unique_visitors?.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Avg Visits/Period:</span>
              <span className="stat-value">{visitsData.avg_visits_per_period?.toFixed(1)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Peak Period:</span>
              <span className="stat-value">{visitsData.peak_period}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VenueVisits;
