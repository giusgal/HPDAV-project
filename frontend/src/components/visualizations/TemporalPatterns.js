import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { fetchTemporalPatterns } from '../../api';
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
  
  // Refs for D3 charts
  const activityChartRef = useRef(null);
  const spendingChartRef = useRef(null);
  const socialChartRef = useRef(null);

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

  // Draw activity chart
  useEffect(() => {
    if (!data?.activity || !activityChartRef.current || activeChart !== 'activity') return;

    const container = activityChartRef.current;
    d3.select(container).selectAll('*').remove();

    const margin = { top: 40, right: 120, bottom: 60, left: 70 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Parse dates
    const parseDate = d3.timeParse('%Y-%m-%d');
    const activityData = data.activity.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(activityData, d => d.date))
      .range([0, width]);

    const maxY = d3.max(activityData, d => Math.max(
      d.restaurant_visits, d.pub_visits, d.home_activity, d.work_activity
    ));

    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    // Color scale for venue types
    const color = d3.scaleOrdinal()
      .domain(['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'])
      .range(['#e74c3c', '#9b59b6', '#3498db', '#2ecc71']);

    const labels = {
      'restaurant_visits': 'Restaurant',
      'pub_visits': 'Pub',
      'home_activity': 'Home',
      'work_activity': 'Work'
    };

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d3.format('.2s')));

    // Y axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Check-ins');

    // Lines
    const line = d3.line()
      .x(d => x(d.date))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const metrics = ['restaurant_visits', 'pub_visits', 'home_activity', 'work_activity'];

    metrics.forEach(metricKey => {
      const lineData = activityData.map(d => ({ date: d.date, value: d[metricKey] }));
      
      svg.append('path')
        .datum(lineData)
        .attr('fill', 'none')
        .attr('stroke', color(metricKey))
        .attr('stroke-width', 2)
        .attr('d', line);

      // Add dots
      svg.selectAll(`.dot-${metricKey}`)
        .data(lineData)
        .enter()
        .append('circle')
        .attr('class', `dot-${metricKey}`)
        .attr('cx', d => x(d.date))
        .attr('cy', d => y(d.value))
        .attr('r', 3)
        .attr('fill', color(metricKey))
        .style('opacity', 0.7);
    });

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width + 10}, 0)`);

    metrics.forEach((metricKey, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 22})`);
      
      g.append('rect')
        .attr('width', 16)
        .attr('height', 16)
        .attr('fill', color(metricKey));
      
      g.append('text')
        .attr('x', 22)
        .attr('y', 12)
        .style('font-size', '11px')
        .text(labels[metricKey]);
    });

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Activity Patterns Over Time');

  }, [data, activeChart]);

  // Draw spending chart
  useEffect(() => {
    if (!data?.spending || !spendingChartRef.current || activeChart !== 'spending') return;

    const container = spendingChartRef.current;
    d3.select(container).selectAll('*').remove();

    const margin = { top: 40, right: 120, bottom: 60, left: 80 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const spendingData = data.spending.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    const x = d3.scaleTime()
      .domain(d3.extent(spendingData, d => d.date))
      .range([0, width]);

    const maxY = d3.max(spendingData, d => Math.max(
      d.food_spending, d.recreation_spending, d.shelter_spending
    ));

    const y = d3.scaleLinear()
      .domain([0, maxY * 1.1])
      .range([height, 0]);

    const color = d3.scaleOrdinal()
      .domain(['food_spending', 'recreation_spending', 'shelter_spending', 'education_spending'])
      .range(['#e67e22', '#9b59b6', '#3498db', '#1abc9c']);

    const labels = {
      'food_spending': 'Food',
      'recreation_spending': 'Recreation',
      'shelter_spending': 'Shelter',
      'education_spending': 'Education'
    };

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d => `$${d3.format('.2s')(d)}`));

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -60)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Spending ($)');

    // Stacked area chart
    const stack = d3.stack()
      .keys(['food_spending', 'recreation_spending', 'shelter_spending', 'education_spending'])
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const series = stack(spendingData);

    const area = d3.area()
      .x(d => x(d.data.date))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    svg.selectAll('.area')
      .data(series)
      .enter()
      .append('path')
      .attr('class', 'area')
      .attr('fill', d => color(d.key))
      .attr('opacity', 0.7)
      .attr('d', area);

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width + 10}, 0)`);

    const keys = ['food_spending', 'recreation_spending', 'shelter_spending', 'education_spending'];
    keys.forEach((key, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${i * 22})`);
      
      g.append('rect')
        .attr('width', 16)
        .attr('height', 16)
        .attr('fill', color(key))
        .attr('opacity', 0.7);
      
      g.append('text')
        .attr('x', 22)
        .attr('y', 12)
        .style('font-size', '11px')
        .text(labels[key]);
    });

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Spending Patterns Over Time');

  }, [data, activeChart]);

  // Draw social chart
  useEffect(() => {
    if (!data?.social || !socialChartRef.current || activeChart !== 'social') return;

    const container = socialChartRef.current;
    d3.select(container).selectAll('*').remove();

    const margin = { top: 40, right: 120, bottom: 60, left: 70 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const socialData = data.social.map(d => ({
      ...d,
      date: parseDate(d.period)
    })).filter(d => d.date);

    const x = d3.scaleTime()
      .domain(d3.extent(socialData, d => d.date))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(socialData, d => d.interactions) * 1.1])
      .range([height, 0]);

    const y2 = d3.scaleLinear()
      .domain([0, d3.max(socialData, d => d.active_initiators) * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d3.format('.2s')));

    svg.append('g')
      .attr('transform', `translate(${width}, 0)`)
      .call(d3.axisRight(y2).tickFormat(d3.format('.2s')))
      .selectAll('text')
      .style('fill', '#e74c3c');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('Interactions');

    // Bar chart for interactions
    const barWidth = Math.max(2, (width / socialData.length) - 2);
    
    svg.selectAll('.bar')
      .data(socialData)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.date) - barWidth / 2)
      .attr('y', d => y(d.interactions))
      .attr('width', barWidth)
      .attr('height', d => height - y(d.interactions))
      .attr('fill', '#3498db')
      .attr('opacity', 0.6);

    // Line for active participants
    const line = d3.line()
      .x(d => x(d.date))
      .y(d => y2(d.active_initiators))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(socialData)
      .attr('fill', 'none')
      .attr('stroke', '#e74c3c')
      .attr('stroke-width', 2.5)
      .attr('d', line);

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 150}, -30)`);

    legend.append('rect')
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', '#3498db')
      .attr('opacity', 0.6);
    
    legend.append('text')
      .attr('x', 22)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Interactions');

    legend.append('line')
      .attr('x1', 100)
      .attr('x2', 116)
      .attr('y1', 8)
      .attr('y2', 8)
      .attr('stroke', '#e74c3c')
      .attr('stroke-width', 2.5);
    
    legend.append('text')
      .attr('x', 122)
      .attr('y', 12)
      .style('font-size', '11px')
      .text('Active Users');

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Social Activity Over Time');

  }, [data, activeChart]);

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
    return <div className="loading">Loading temporal patterns...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
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
