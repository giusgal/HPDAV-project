import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTemporalPatterns } from '../../hooks/useApi';
import { ActivityChart, SpendingChart, SocialChart } from './d3/TemporalPatternsChart';
import './TemporalPatterns.css';

const TemporalPatterns = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Parameters
  const [granularity, setGranularity] = useState('weekly');
  const [metric, setMetric] = useState('all');
  const [venueType, setVenueType] = useState('all');
  const [activeChart, setActiveChart] = useState('activity');
  
  // Refs for D3 chart containers
  const activityChartRef = useRef(null);
  const spendingChartRef = useRef(null);
  const socialChartRef = useRef(null);
  
  // Refs for D3 chart instances
  const activityChartInstance = useRef(null);
  const spendingChartInstance = useRef(null);
  const socialChartInstance = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTemporalPatterns({ granularity, metric, venueType });
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [granularity, metric, venueType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update activity chart when data/tab changes
  useEffect(() => {
    if (!activityChartRef.current || !data?.activity || activeChart !== 'activity') return;

    // Initialize chart if not already done
    if (!activityChartInstance.current) {
      activityChartInstance.current = new ActivityChart(activityChartRef.current);
      activityChartInstance.current.initialize();
    }

    activityChartInstance.current.update({
      activityData: data.activity
    });
  }, [data, activeChart]);

  // Update spending chart when data/tab changes
  useEffect(() => {
    if (!spendingChartRef.current || !data?.spending || activeChart !== 'spending') return;

    // Initialize chart if not already done
    if (!spendingChartInstance.current) {
      spendingChartInstance.current = new SpendingChart(spendingChartRef.current);
      spendingChartInstance.current.initialize();
    }

    spendingChartInstance.current.update({
      spendingData: data.spending
    });
  }, [data, activeChart]);

  // Update social chart when data/tab changes
  useEffect(() => {
    if (!socialChartRef.current || !data?.social || activeChart !== 'social') return;

    // Initialize chart if not already done
    if (!socialChartInstance.current) {
      socialChartInstance.current = new SocialChart(socialChartRef.current);
      socialChartInstance.current.initialize();
    }

    socialChartInstance.current.update({
      socialData: data.social
    });
  }, [data, activeChart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activityChartInstance.current) {
        activityChartInstance.current.destroy();
        activityChartInstance.current = null;
      }
      if (spendingChartInstance.current) {
        spendingChartInstance.current.destroy();
        spendingChartInstance.current = null;
      }
      if (socialChartInstance.current) {
        socialChartInstance.current.destroy();
        socialChartInstance.current = null;
      }
    };
  }, []);

  // Render trend cards
  const renderTrendCards = () => {
    if (!data) return null;

    const trends = [];

    if (data.activity_trends) {
      trends.push(
        { 
          label: 'Total Check-ins', 
          value: data.activity_trends.checkin_change_pct,
          type: 'activity'
        },
        { 
          label: 'Restaurant Visits', 
          value: data.activity_trends.restaurant_change_pct,
          type: 'activity'
        },
        { 
          label: 'Pub Visits', 
          value: data.activity_trends.pub_change_pct,
          type: 'activity'
        }
      );
    }

    if (data.spending_trends) {
      trends.push(
        { 
          label: 'Total Spending', 
          value: data.spending_trends.spending_change_pct,
          type: 'spending'
        },
        { 
          label: 'Food Spending', 
          value: data.spending_trends.food_change_pct,
          type: 'spending'
        },
        { 
          label: 'Recreation Spending', 
          value: data.spending_trends.recreation_change_pct,
          type: 'spending'
        }
      );
    }

    return (
      <div className="trend-cards">
        {trends.map((trend, idx) => (
          <div key={idx} className={`trend-card ${trend.value >= 0 ? 'positive' : 'negative'}`}>
            <div className="trend-label">{trend.label}</div>
            <div className="trend-value">
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value).toFixed(1)}%
            </div>
            <div className="trend-type">{trend.type}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return <div className="temporal-patterns"><div className="loading">Loading temporal patterns...</div></div>;
  }

  if (error) {
    return <div className="temporal-patterns"><div className="error">Error: {error}</div></div>;
  }

  return (
    <div className="temporal-patterns">
      <div className="controls">
        <div className="control-group">
          <label>Time Granularity:</label>
          <select value={granularity} onChange={e => setGranularity(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Metric:</label>
          <select value={metric} onChange={e => setMetric(e.target.value)}>
            <option value="all">All Metrics</option>
            <option value="activity">Activity Only</option>
            <option value="spending">Spending Only</option>
            <option value="social">Social Only</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Venue Filter:</label>
          <select value={venueType} onChange={e => setVenueType(e.target.value)}>
            <option value="all">All Venues</option>
            <option value="Restaurant">Restaurants</option>
            <option value="Pub">Pubs</option>
            <option value="Apartment">Homes</option>
            <option value="Workplace">Workplaces</option>
          </select>
        </div>
      </div>

      {data?.date_range && (
        <div className="date-range-info">
          Data spans from <strong>{data.date_range.start}</strong> to <strong>{data.date_range.end}</strong>
        </div>
      )}

      {renderTrendCards()}

      <div className="chart-tabs">
        <button 
          className={activeChart === 'activity' ? 'active' : ''} 
          onClick={() => setActiveChart('activity')}
          disabled={!data?.activity}
        >
          Activity
        </button>
        <button 
          className={activeChart === 'spending' ? 'active' : ''} 
          onClick={() => setActiveChart('spending')}
          disabled={!data?.spending}
        >
          Spending
        </button>
        <button 
          className={activeChart === 'social' ? 'active' : ''} 
          onClick={() => setActiveChart('social')}
          disabled={!data?.social}
        >
          Social
        </button>
      </div>

      <div className="charts-container">
        <div 
          ref={activityChartRef} 
          className={`chart ${activeChart === 'activity' ? 'visible' : 'hidden'}`}
        />
        <div 
          ref={spendingChartRef} 
          className={`chart ${activeChart === 'spending' ? 'visible' : 'hidden'}`}
        />
        <div 
          ref={socialChartRef} 
          className={`chart ${activeChart === 'social' ? 'visible' : 'hidden'}`}
        />
      </div>

      {/* Time-of-Day Analysis */}
      {data?.activity && activeChart === 'activity' && (
        <div className="time-of-day-analysis">
          <h3>Activity by Time of Day (Latest Period)</h3>
          <div className="time-bars">
            {['morning', 'midday', 'afternoon', 'evening', 'night'].map(period => {
              const lastPeriod = data.activity[data.activity.length - 1];
              const value = lastPeriod?.[`${period}_activity`] || 0;
              const maxVal = Math.max(
                lastPeriod?.morning_activity || 0,
                lastPeriod?.midday_activity || 0,
                lastPeriod?.afternoon_activity || 0,
                lastPeriod?.evening_activity || 0,
                lastPeriod?.night_activity || 0
              );
              const pct = maxVal > 0 ? (value / maxVal) * 100 : 0;
              
              return (
                <div key={period} className="time-bar-container">
                  <div className="time-label">{period.charAt(0).toUpperCase() + period.slice(1)}</div>
                  <div className="time-bar">
                    <div 
                      className="time-bar-fill" 
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="time-value">{value.toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TemporalPatterns;
