import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchThemeRiver } from '../../hooks/useApi';
import ThemeRiverChart from './ThemeRiverChart';
import './ThemeRiver.css';

const ThemeRiver = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Parameters
  const [granularity, setGranularity] = useState('weekly');
  const [dimension, setDimension] = useState('mode');
  const [normalize, setNormalize] = useState(false);
  
  // Ref for D3 chart container
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchThemeRiver({ granularity, dimension, normalize });
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [granularity, dimension, normalize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update chart when data changes
  useEffect(() => {
    if (!chartRef.current || !data || !data.data) return;

    // Debug: Log data to verify it's per-period, not cumulative
    console.log('[ThemeRiver] Data received:', {
      dimension: data.dimension,
      numPeriods: data.data.length,
      categories: data.categories,
      sampleData: data.data.slice(0, 3)
    });

    // Always create a fresh chart instance when data changes
    // This ensures proper re-rendering with new categories/colors
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }
    
    chartInstance.current = new ThemeRiverChart(chartRef.current);
    chartInstance.current.initialize();

    chartInstance.current.update({
      data: data.data,
      categories: data.categories,
      periods: data.periods,
      normalize: data.normalize,
      dimension: data.dimension
    });
  }, [data]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, []);

  const getDimensionDescription = () => {
    switch (dimension) {
      case 'mode':
        return 'This streamgraph shows how participant behaviors (AtHome, AtWork, AtRecreation, AtRestaurant, Transport) evolve over the 15-month period. The width of each stream represents the volume of that activity at any given time. Look for shifts in the balance between work, home, and leisure activities.';
      case 'purpose':
        return 'This streamgraph visualizes travel purposes over time (Work/Home Commute, Eating, Recreation, etc.). Changes in stream widths reveal evolving mobility patterns and how people move through the city.';
      case 'spending':
        return 'This streamgraph tracks spending patterns across categories (Food, Recreation, Education, Shelter). The flowing shapes show how household budgets and economic activities shift throughout the dataset period.';
      default:
        return '';
    }
  };

  const renderSignificantChanges = () => {
    if (!data || !data.significant_changes || data.significant_changes.length === 0) return null;

    return (
      <div className="significant-changes">
        <h3>Top 10 Significant Changes Over Time</h3>
        <p style={{ color: '#666', marginBottom: '15px', fontSize: '14px' }}>
          Comparing the first and last periods of the dataset
        </p>
        <div className="changes-grid">
          {data.significant_changes.map((change, idx) => {
            const isIncrease = change.pct_change >= 0;
            return (
              <div key={idx} className={`change-card ${isIncrease ? 'increase' : 'decrease'}`}>
                <div className="category">{change.category}</div>
                <div className="change-value">
                  {isIncrease ? '↑' : '↓'} {Math.abs(change.pct_change).toFixed(1)}%
                </div>
                <div className="change-details">
                  {normalize ? (
                    <>
                      <div>From {change.first_avg.toFixed(1)}% to {change.last_avg.toFixed(1)}%</div>
                      <div>Change: {change.abs_change > 0 ? '+' : ''}{change.abs_change.toFixed(1)} percentage points</div>
                    </>
                  ) : (
                    <>
                      <div>First period avg: {change.first_avg.toLocaleString()}</div>
                      <div>Last period avg: {change.last_avg.toLocaleString()}</div>
                      <div>Change: {change.abs_change > 0 ? '+' : ''}{change.abs_change.toLocaleString()}</div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="theme-river">
        <div className="loading">Loading theme river visualization...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="theme-river">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="theme-river">
      <h2>Theme River: Temporal Evolution of City Patterns</h2>
      
      <div className="description">
        {getDimensionDescription()}
      </div>

      <div className="controls">
        <div className="control-group">
          <label>Dimension:</label>
          <select value={dimension} onChange={e => setDimension(e.target.value)}>
            <option value="mode">Participant Modes</option>
            <option value="purpose">Travel Purposes</option>
            <option value="spending">Spending Categories</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Time Granularity:</label>
          <select value={granularity} onChange={e => setGranularity(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Scale:</label>
          <select value={normalize} onChange={e => setNormalize(e.target.value === 'true')}>
            <option value="false">Absolute Values</option>
            <option value="true">Normalized (%)</option>
          </select>
        </div>

        {data && data.date_range && (
          <div className="control-group">
            <label>Date Range:</label>
            <div style={{ padding: '8px 0', fontSize: '14px', color: '#555' }}>
              {data.date_range.start} to {data.date_range.end}
            </div>
          </div>
        )}
      </div>

      <div className="visualization-container">
        <div className="chart-container" ref={chartRef}></div>
      </div>

      {renderSignificantChanges()}
    </div>
  );
};

export default ThemeRiver;
