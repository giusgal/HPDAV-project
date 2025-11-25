import { useState, useEffect, useCallback } from 'react';

export function useApi(fetchFunction, params = {}, autoFetch = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
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
