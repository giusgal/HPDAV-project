import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi, fetchTrafficPatterns, fetchBuildingsMapData } from '../../hooks/useApi';
import { TrafficPatternsChart, HourlyChart } from './TrafficPatternsChart';
import './TrafficPatterns.css';

const METRICS = [
  { id: 'visits', label: 'Total Visits' },
  { id: 'unique_visitors', label: 'Unique Visitors' },
];

const TIME_PERIODS = [
  { id: 'all', label: 'All Day' },
  { id: 'morning', label: 'Morning (6-12)' },
  { id: 'afternoon', label: 'Afternoon (12-18)' },
  { id: 'evening', label: 'Evening (18-24)' },
  { id: 'night', label: 'Night (0-6)' },
];

const DAY_TYPES = [
  { id: 'all', label: 'All Days' },
  { id: 'weekday', label: 'Weekdays' },
  { id: 'weekend', label: 'Weekends' },
];

const DEBOUNCE_DELAY = 800; // ms delay for date inputs

function TrafficPatterns() {
  const svgRef = useRef(null);
  const hourlyChartRef = useRef(null);
  const tooltipRef = useRef(null);
  
  // Chart instances
  const chartRef = useRef(null);
  const hourlyChartInstanceRef = useRef(null);
  const datesInitialized = useRef(false);
  
  const [selectedMetric, setSelectedMetric] = useState('visits');
  const [timePeriod, setTimePeriod] = useState('all');
  const [dayType, setDayType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [debouncedStartDate, setDebouncedStartDate] = useState('');
  const [debouncedEndDate, setDebouncedEndDate] = useState('');
  const [hoveredBubble, setHoveredBubble] = useState(null);

  // Debounce date inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStartDate(startDate);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [startDate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEndDate(endDate);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [endDate]);

  // Fetch data
  const { data, loading, error, refetch } = useApi(
    fetchTrafficPatterns,
    { 
      timePeriod, 
      dayType,
      startDate: debouncedStartDate,
      endDate: debouncedEndDate
    },
    true
  );

  // Initialize dates from available data when it first loads
  useEffect(() => {
    if (data?.available_dates && !datesInitialized.current) {
      if (data.available_dates.min && data.available_dates.max) {
        setStartDate(data.available_dates.min);
        setEndDate(data.available_dates.max);
        setDebouncedStartDate(data.available_dates.min);
        setDebouncedEndDate(data.available_dates.max);
        datesInitialized.current = true;
      }
    }
  }, [data?.available_dates]);

  // Refetch when parameters change
  useEffect(() => {
    refetch({ timePeriod, dayType, startDate: debouncedStartDate, endDate: debouncedEndDate });
  }, [timePeriod, dayType, debouncedStartDate, debouncedEndDate]);

  const { data: buildingsData } = useApi(fetchBuildingsMapData, {}, true);

  const currentMetricConfig = useMemo(() => 
    METRICS.find(m => m.id === selectedMetric) || METRICS[0],
    [selectedMetric]
  );

  const processedData = useMemo(() => {
    if (!data || !data.locations) return null;

    const locations = data.locations.map(loc => {
      const value = selectedMetric === 'visits' ? loc.visits : loc.unique_visitors;
      
      return { ...loc, value };
    });

    return {
      locations,
      statistics: data.statistics,
      hourlyPattern: data.hourly_pattern,
    };
  }, [data, selectedMetric]);

  // Controller object for D3 chart callbacks
  const chartController = useMemo(() => ({
    onBubbleHover: (bubbleData, event) => {
      setHoveredBubble(bubbleData);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('display', 'block')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      }
    },
    onBubbleLeave: () => {
      setHoveredBubble(null);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current).style('display', 'none');
      }
    },
    onMouseMove: (event) => {
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      }
    },
    getTooltipRef: () => tooltipRef.current,
  }), []);

  // Update chart when data changes (lazy initialization)
  useEffect(() => {
    if (!svgRef.current || !processedData?.locations || !buildingsData?.buildings) return;

    // Always create a fresh chart instance (handles remount after loading)
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    chartRef.current = new TrafficPatternsChart(svgRef.current, chartController);
    chartRef.current.initialize();

    const { locations, statistics } = processedData;

    chartRef.current.update({
      locations,
      metricConfig: currentMetricConfig,
      buildingsData,
    });
  }, [processedData, currentMetricConfig, buildingsData, chartController]);

  // Update hourly chart when data changes (lazy initialization)
  useEffect(() => {
    if (!hourlyChartRef.current || !processedData?.hourlyPattern) return;

    // Always create a fresh chart instance (handles remount after loading)
    if (hourlyChartInstanceRef.current) {
      hourlyChartInstanceRef.current.destroy();
    }
    hourlyChartInstanceRef.current = new HourlyChart(hourlyChartRef.current);
    hourlyChartInstanceRef.current.initialize();

    hourlyChartInstanceRef.current.update({
      hourlyData: processedData.hourlyPattern,
    });
  }, [processedData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      if (hourlyChartInstanceRef.current) {
        hourlyChartInstanceRef.current.destroy();
        hourlyChartInstanceRef.current = null;
      }
    };
  }, []);

  const formatValue = (value) => {
    if (value == null) return 'N/A';
    return value.toLocaleString();
  };

  if (loading) {
    return (
      <div className="traffic-patterns visualization-container">
        <div className="loading">Loading traffic patterns...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="traffic-patterns visualization-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="traffic-patterns visualization-container">
      <div className="controls">
        <div className="control-group">
          <label htmlFor="metric-select">Metric:</label>
          <select 
            id="metric-select"
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value)}
          >
            {METRICS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="time-select">Time Period:</label>
          <select 
            id="time-select"
            value={timePeriod} 
            onChange={(e) => setTimePeriod(e.target.value)}
          >
            {TIME_PERIODS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="day-select">Day Type:</label>
          <select 
            id="day-select"
            value={dayType} 
            onChange={(e) => setDayType(e.target.value)}
          >
            {DAY_TYPES.map(d => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="start-date">Start Date:</label>
          <input
            type="date"
            id="start-date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={data?.available_dates?.min}
            max={data?.available_dates?.max}
          />
        </div>
        <div className="control-group">
          <label htmlFor="end-date">End Date:</label>
          <input
            type="date"
            id="end-date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={data?.available_dates?.min}
            max={data?.available_dates?.max}
          />
        </div>
      </div>
      
      {data?.available_dates && (
        <div style={{ textAlign: 'center', color: '#666', fontSize: '14px', marginBottom: '15px', padding: '10px', background: '#e8f4f8', borderRadius: '4px' }}>
          Available data: <strong>{data.available_dates.min}</strong> to <strong>{data.available_dates.max}</strong>
          {startDate && endDate && (
            <span style={{ marginLeft: '20px' }}>
              | Showing: <strong>{startDate}</strong> to <strong>{endDate}</strong>
            </span>
          )}
        </div>
      )}
      
      <div className="chart-container">
        <svg ref={svgRef}></svg>
        <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
          {hoveredBubble && (
            <>
              <strong>Location ({hoveredBubble.x.toFixed(0)}, {hoveredBubble.y.toFixed(0)})</strong>
              <br />
              Type: {hoveredBubble.venuetype}
              <br />
              {currentMetricConfig.label}: {formatValue(hoveredBubble.value)}
              <br />
              <small>
                Visits: {formatValue(hoveredBubble.visits)} | 
                Unique: {formatValue(hoveredBubble.unique_visitors)}
              </small>
            </>
          )}
        </div>
      </div>

      {processedData?.statistics && (
        <div className="statistics-panel">
          <h4>Traffic Statistics</h4>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-label">Total Visits:</span>
              <span className="stat-value">{formatValue(processedData.statistics.total_visits)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Locations:</span>
              <span className="stat-value">{formatValue(processedData.statistics.total_locations)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Busiest Location:</span>
              <span className="stat-value">{formatValue(processedData.statistics.max_visits)} visits</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Average per Location:</span>
              <span className="stat-value">{formatValue(Math.round(processedData.statistics.avg_visits))}</span>
            </div>
          </div>
        </div>
      )}

      <div className="hourly-chart">
        <h4>Hourly Activity Distribution</h4>
        <div ref={hourlyChartRef} style={{ width: '100%', height: 150 }}></div>
        <p className="chart-note">
          <span style={{ color: '#d62728' }}>■</span> Peak hours (&gt;80% max) 
          <span style={{ color: '#ff7f0e', marginLeft: '10px' }}>■</span> High activity (&gt;60% max)
          <span style={{ color: '#1f77b4', marginLeft: '10px' }}>■</span> Normal activity
        </p>
      </div>

      <div className="info-panel">
        <h3>Pandemic-Style Bubble Map</h3>
        <p>
          This visualization shows traffic patterns across Engagement city using a pandemic-style 
          bubble map. Each bubble represents a specific location (venue), with <strong>size 
          proportional to activity level</strong> and color indicating intensity. 
        </p>
        <p>
          <strong>How to read this map:</strong>
        </p>
        <ul>
          <li><strong>Bubble size:</strong> Larger bubbles = more traffic at that location</li>
          <li><strong>Color:</strong> Darker/warmer colors = higher activity intensity</li>
          <li><strong>Venue types:</strong> Different types of locations are aggregated by their exact coordinates</li>
        </ul>
      </div>
    </div>
  );
}

export default TrafficPatterns;
