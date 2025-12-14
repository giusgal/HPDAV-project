import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTemporalPatterns } from '../../hooks/useApi';
import { RadarChart, CalendarHeatmap, TimelineChart } from './SeasonalComparisonChart';
import './SeasonalComparison.css';

const SeasonalComparison = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [activeView, setActiveView] = useState('calendar');
  const [dayTypeFilter, setDayTypeFilter] = useState('all');
  const [timePeriodFilter, setTimePeriodFilter] = useState('all');
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [activeCategories, setActiveCategories] = useState({
    restaurant: true, pub: true, home: true, work: true
  });

  const toggleCategory = (cat) => setActiveCategories(p => ({ ...p, [cat]: !p[cat] }));
  
  const radarChartRef = useRef(null);
  const calendarChartRef = useRef(null);
  const timelineChartRef = useRef(null);
  const radarChartInstance = useRef(null);
  const calendarChartInstance = useRef(null);
  const timelineChartInstance = useRef(null);

  const calculateSeasonalData = useCallback((activityData) => {
    if (!activityData?.length) return null;
    const seasonalAgg = {
      spring: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      summer: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      fall: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 },
      winter: { count: 0, restaurant_visits: 0, pub_visits: 0, home_activity: 0, work_activity: 0 }
    };
    activityData.forEach(d => {
      const month = new Date(d.period).getMonth() + 1;
      const season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'fall' : 'winter';
      seasonalAgg[season].count++;
      ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'].forEach(k => {
        seasonalAgg[season][k] += d[k] || 0;
      });
    });
    Object.values(seasonalAgg).forEach(s => {
      if (s.count > 0) ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'].forEach(k => s[k] /= s.count);
    });
    return seasonalAgg;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [daily, weekly] = await Promise.all([
        fetchTemporalPatterns({ granularity: 'daily', metric: 'activity', excludeOutliers }),
        fetchTemporalPatterns({ granularity: 'weekly', metric: 'activity', excludeOutliers })
      ]);
      setData({ daily: daily.activity || [], weekly: weekly.activity || [], dateRange: weekly.date_range });
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [excludeOutliers]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!radarChartRef.current || !data?.weekly || activeView !== 'radar') return;
    if (!radarChartInstance.current) {
      radarChartInstance.current = new RadarChart(radarChartRef.current);
      radarChartInstance.current.initialize();
    }
    radarChartInstance.current.update({
      seasonalData: calculateSeasonalData(data.weekly),
      dimensions: ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity']
    });
  }, [data, activeView, calculateSeasonalData]);

  useEffect(() => {
    if (!calendarChartRef.current || !data?.daily || activeView !== 'calendar') return;
    if (!calendarChartInstance.current) {
      calendarChartInstance.current = new CalendarHeatmap(calendarChartRef.current);
      calendarChartInstance.current.initialize();
    }
    calendarChartInstance.current.update({
      dailyData: data.daily,
      metric: 'total_checkins',
      dayTypeFilter,
      timePeriodFilter,
      compareMode: false,
      activeCategories
    });
  }, [data, activeView, dayTypeFilter, timePeriodFilter, activeCategories]);

  useEffect(() => {
    if (!timelineChartRef.current || !data?.daily || activeView !== 'calendar') return;
    if (!timelineChartInstance.current) {
      timelineChartInstance.current = new TimelineChart(timelineChartRef.current);
      timelineChartInstance.current.initialize();
    }
    timelineChartInstance.current.update({
      dailyData: data.daily,
      dayTypeFilter,
      timePeriodFilter,
      activeCategories
    });
  }, [data, activeView, dayTypeFilter, timePeriodFilter, activeCategories]);

  useEffect(() => () => {
    radarChartInstance.current?.destroy();
    calendarChartInstance.current?.destroy();
    timelineChartInstance.current?.destroy();
  }, []);

  return (
    <>
      <div className="seasonal-comparison">
        {/* Compact control bar */}
        <div className="controls-bar">
          <div className="control-item">
            <label>View</label>
            <select value={activeView} onChange={e => setActiveView(e.target.value)}>
              <option value="calendar">Calendar</option>
              <option value="radar">Radar</option>
            </select>
          </div>

          <div className="divider" />

          <div className="control-item">
            <label className="checkbox-minimal">
              <input type="checkbox" checked={excludeOutliers} onChange={e => setExcludeOutliers(e.target.checked)} />
              Remove Outliers
            </label>
          </div>

          {activeView === 'calendar' && (
            <>
              <div className="divider" />
              
              <div className="control-item">
                <div className="toggle-group">
                  {['all', 'weekday', 'weekend'].map(v => (
                    <button key={v} className={dayTypeFilter === v ? 'active' : ''} onClick={() => setDayTypeFilter(v)}>
                      {v === 'all' ? 'All' : v === 'weekday' ? 'Weekdays' : 'Weekends'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-item">
                <div className="toggle-group">
                  {['all', 'morning', 'afternoon', 'evening', 'night'].map(v => (
                    <button key={v} className={timePeriodFilter === v ? 'active' : ''} onClick={() => setTimePeriodFilter(v)}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider" />

              <div className="control-item">
                <div className="category-pills">
                  <button className={`pill work ${activeCategories.work ? 'active' : ''}`} onClick={() => toggleCategory('work')}>💼 Work</button>
                  <button className={`pill home ${activeCategories.home ? 'active' : ''}`} onClick={() => toggleCategory('home')}>🏠 Home</button>
                  <button className={`pill restaurant ${activeCategories.restaurant ? 'active' : ''}`} onClick={() => toggleCategory('restaurant')}>🍽 Restaurant</button>
                  <button className={`pill pub ${activeCategories.pub ? 'active' : ''}`} onClick={() => toggleCategory('pub')}>🍺 Pub</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chart area */}
        <div className="chart-area">
          <div className="chart-header">
            <span>{activeView === 'radar' ? 'Seasonal Radar' : 'Activity Calendar'}</span>
            {data?.dateRange && <span style={{opacity:0.7, fontSize:'11px'}}>{data.dateRange.start} — {data.dateRange.end}</span>}
          </div>
          <div className="chart-body">
            {loading && <div className="loading-overlay">Loading...</div>}
            {error && <div className="error-message">{error}</div>}
            <div ref={radarChartRef} style={{ width: '100%', height: '100%', display: activeView === 'radar' ? 'block' : 'none' }} />
            <div ref={calendarChartRef} style={{ width: '100%', height: '100%', display: activeView === 'calendar' ? 'block' : 'none' }} />
          </div>
        </div>

        {/* Timeline chart - separate panel */}
        {activeView === 'calendar' && (
          <div className="chart-area timeline-panel">
            <div className="chart-header">
              <span>Activity Timeline</span>
            </div>
            <div className="chart-body">
              <div ref={timelineChartRef} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default SeasonalComparison;
