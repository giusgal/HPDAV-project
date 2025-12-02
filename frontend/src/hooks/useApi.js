import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// =============================================================================
// API Configuration
// =============================================================================

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// =============================================================================
// API Endpoint Functions
// =============================================================================

/**
 * Fetch area characteristics data for the heatmap visualization.
 * All metrics are aggregated over the entire 15-month period.
 * @param {Object} params - Query parameters
 * @param {number} params.gridSize - Size of grid cells (default: 500)
 * @param {string} params.metric - Metric to fetch (default: 'all')
 * @returns {Promise<Object>} Area characteristics data
 */
export const fetchAreaCharacteristics = async (params = {}) => {
  const { gridSize = 500, metric = 'all' } = params;
  const response = await apiClient.get('/api/area-characteristics', {
    params: { 
      grid_size: gridSize, 
      metric
    }
  });
  return response.data;
};

/**
 * Fetch traffic patterns data (pandemic-style bubble map).
 * @param {Object} params - Query parameters
 * @param {string} params.timePeriod - Time period filter (default: 'all')
 * @param {string} params.dayType - Day type filter (default: 'all')
 * @param {number} params.sampleRate - Sample rate percentage (default: 100)
 * @returns {Promise<Object>} Traffic patterns data
 */
export const fetchTrafficPatterns = async (params = {}) => {
  const { 
    timePeriod = 'all', 
    dayType = 'all',
    sampleRate = 100
  } = params;
  const response = await apiClient.get('/api/traffic-patterns', {
    params: { 
      time_period: timePeriod,
      day_type: dayType,
      sample_rate: sampleRate
    }
  });
  return response.data;
};

/**
 * Fetch participant routines data.
 * @param {Object} params - Query parameters
 * @param {string} params.participantIds - Comma-separated participant IDs
 * @param {string} params.date - Date filter (default: 'typical')
 * @param {string} params.month - Month filter (default: 'all')
 * @returns {Promise<Object>} Participant routines data
 */
export const fetchParticipantRoutines = async (params = {}) => {
  const { participantIds = '', date = 'typical', month = 'all' } = params;
  const response = await apiClient.get('/api/participant-routines', {
    params: { 
      participant_ids: participantIds,
      date,
      month
    }
  });
  return response.data;
};

/**
 * Fetch temporal patterns data.
 * @param {Object} params - Query parameters
 * @param {string} params.granularity - Time granularity (default: 'weekly')
 * @param {string} params.metric - Metric to fetch (default: 'all')
 * @param {string} params.venueType - Venue type filter (default: 'all')
 * @returns {Promise<Object>} Temporal patterns data
 */
export const fetchTemporalPatterns = async (params = {}) => {
  const { 
    granularity = 'weekly', 
    metric = 'all',
    venueType = 'all'
  } = params;
  const response = await apiClient.get('/api/temporal-patterns', {
    params: { 
      granularity,
      metric,
      venue_type: venueType
    }
  });
  return response.data;
};

/**
 * Fetch map bounds (coordinate extent).
 * @returns {Promise<Object>} Bounds data { min_x, max_x, min_y, max_y }
 */
export const fetchMapBounds = async () => {
  const response = await apiClient.get('/api/heatmap/bounds');
  return response.data;
};

/**
 * Fetch heatmap density data.
 * @param {Object} params - Query parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {number} params.hour - Hour of day (0-23)
 * @param {number} params.granularity - Grid cell size
 * @returns {Promise<Object>} Heatmap data
 */
export const fetchHeatmapData = async (params = {}) => {
  const { startDate, endDate, hour, granularity } = params;
  const response = await apiClient.get('/api/heatmap/data', {
    params: {
      start_date: startDate,
      end_date: endDate,
      hour,
      granularity
    }
  });
  return response.data;
};

/**
 * Fetch buildings map data including building polygons and venue locations.
 * @param {Object} params - Query parameters (unused, for consistency with useApi)
 * @returns {Promise<Object>} Buildings and venues data
 */
export const fetchBuildingsMapData = async (params = {}) => {
  const response = await apiClient.get('/api/buildings-map');
  return response.data;
};

/**
 * Fetch flow map data for animated OD (Origin-Destination) visualization.
 * @param {Object} params - Query parameters
 * @param {number} params.gridSize - Size of grid cells for spatial binning (default: 300)
 * @param {string} params.dayType - Day type filter: 'all', 'weekday', 'weekend' (default: 'all')
 * @param {string} params.purpose - Travel purpose filter (default: 'all')
 * @param {number} params.minTrips - Minimum trips to show a flow (default: 5)
 * @returns {Promise<Object>} Flow map data with flows, cells, and buildings
 */
export const fetchFlowMapData = async (params = {}) => {
  const { 
    gridSize = 300, 
    dayType = 'all', 
    purpose = 'all',
    minTrips = 5 
  } = params;
  const response = await apiClient.get('/api/flow-map', {
    params: { 
      grid_size: gridSize, 
      day_type: dayType,
      purpose,
      min_trips: minTrips
    }
  });
  return response.data;
};

// =============================================================================
// useApi Hook
// =============================================================================

/**
 * Custom React hook for API data fetching with loading and error states.
 * 
 * @param {Function} fetchFunction - Async function that fetches data (e.g., fetchAreaCharacteristics)
 * @param {Object} initialParams - Initial parameters to pass to the fetch function
 * @param {boolean} autoFetch - Whether to fetch automatically on mount (default: true)
 * 
 * @returns {Object} Hook state and methods:
 *   - data: The fetched data (null if not yet loaded)
 *   - loading: Boolean indicating if a request is in progress
 *   - error: Error message string if request failed, null otherwise
 *   - refetch: Function to manually trigger a new fetch with optional param overrides
 * 
 * @example
 * // Basic usage with auto-fetch
 * const { data, loading, error } = useApi(fetchAreaCharacteristics, { gridSize: 500 });
 * 
 * @example
 * // Manual fetch with refetch
 * const { data, loading, refetch } = useApi(fetchAreaCharacteristics, {}, false);
 * useEffect(() => { refetch({ gridSize: newSize }); }, [newSize]);
 */
export function useApi(fetchFunction, params = {}, autoFetch = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState(null);

  const fetch = useCallback(async (overrideParams = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFunction({ ...params, ...overrideParams });
      setData(result);
      return result;
    } catch (err) {
      setError(err.message || 'An error occurred');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchFunction, JSON.stringify(params)]);

  useEffect(() => {
    if (autoFetch) {
      fetch();
    }
  }, []);

  return { data, loading, error, refetch: fetch };
}

// Export the axios client for advanced usage
export { apiClient };
