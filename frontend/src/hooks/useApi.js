/**
 * useApi.js - Unified API Hook
 * 
 * This module combines API configuration, endpoint definitions, and the React hook
 * for fetching data from the Flask backend. It provides a clean interface for
 * components to interact with the API.
 * 
 * See README.md in this folder for detailed documentation.
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// =============================================================================
// API Configuration
// =============================================================================

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// =============================================================================
// API Endpoint Functions
// =============================================================================

/**
 * Fetch area characteristics data for the heatmap visualization.
 * @param {Object} params - Query parameters
 * @param {number} params.gridSize - Size of grid cells (default: 500)
 * @param {string} params.metric - Metric to fetch (default: 'all')
 * @returns {Promise<Object>} Area characteristics data
 */
export const fetchAreaCharacteristics = async (params = {}) => {
  const { gridSize = 500, metric = 'all' } = params;
  const response = await apiClient.get('/api/area-characteristics', {
    params: { grid_size: gridSize, metric }
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
 * @returns {Promise<Object>} Buildings and venues data
 */
export const fetchBuildingsMapData = async () => {
  const response = await apiClient.get('/api/buildings-map');
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
export function useApi(fetchFunction, initialParams = {}, autoFetch = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState(null);

  // useCallback memoizes the fetch function to prevent unnecessary re-creations.
  // The dependency on JSON.stringify(initialParams) ensures the callback updates
  // only when params actually change (deep comparison workaround).
  const fetch = useCallback(async (overrideParams = {}) => {
    setLoading(true);
    setError(null);
    try {
      // Merge initial params with any override params
      const result = await fetchFunction({ ...initialParams, ...overrideParams });
      setData(result);
      return result;
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'An error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchFunction, JSON.stringify(initialParams)]);

  // useEffect runs on mount (empty deps would run once, but we include autoFetch).
  // If autoFetch is true, fetch data immediately when component mounts.
  useEffect(() => {
    if (autoFetch) {
      fetch();
    }
  }, [autoFetch]); // Only run on mount, not on fetch changes

  return { data, loading, error, refetch: fetch };
}

// Export the axios instance for advanced usage if needed
export { apiClient };

export default useApi;
