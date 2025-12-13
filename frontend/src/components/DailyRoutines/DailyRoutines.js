import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi, fetchParticipantRoutines, fetchBuildingsMapData } from '../../hooks/useApi';
import DailyRoutinesChart, { ACTIVITY_COLORS, ACTIVITY_LABELS } from './DailyRoutinesChart';
import './DailyRoutines.css';

// Pre-selected interesting participants with different routines
const SUGGESTED_PAIRS = [
  { ids: [0, 100], description: 'Different work schedules' },
  { ids: [1, 50], description: 'Social vs. home-oriented' },
  { ids: [10, 200], description: 'Early bird vs. night owl' },
];

function DailyRoutines() {
  const timelineRef = useRef(null);
  const tooltipRef = useRef(null);
  const chartRef = useRef(null);
  
  const [participant1, setParticipant1] = useState('');
  const [participant2, setParticipant2] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [dayType, setDayType] = useState('all'); // 'all', 'weekday', 'weekend'
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [tooltipContent, setTooltipContent] = useState(null);
  const [availableMonths, setAvailableMonths] = useState([]);
  
  // First, fetch the list of participants
  const { data: listData, loading: listLoading, refetch: refetchList } = useApi(
    fetchParticipantRoutines, 
    { month: selectedMonth, dayType }, 
    true
  );
  
  // Then fetch detailed routines for selected participants
  const { data: routineData, loading: routineLoading, refetch: refetchRoutines } = useApi(
    fetchParticipantRoutines,
    { participantIds: selectedIds.join(','), month: selectedMonth, dayType },
    false
  );
  
  // Fetch buildings data for map background
  const { data: buildingsData } = useApi(fetchBuildingsMapData, {}, true);

  // Reload list when month or day type changes
  useEffect(() => {
    refetchList({ month: selectedMonth, dayType });
  }, [selectedMonth, dayType, refetchList]);
  
  // Update available months when list data changes
  useEffect(() => {
    if (listData?.available_months) {
      const months = [
        { value: 'all', label: 'All Months', short: 'All' },
        ...listData.available_months.map(m => {
          const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          return {
            value: `${m.year}-${m.month}`,
            label: m.label,
            short: `${monthNames[m.month]} ${m.year}`
          };
        })
      ];
      setAvailableMonths(months);
    }
  }, [listData]);

  // Load routines when selection, month, or day type changes
  useEffect(() => {
    if (selectedIds.length > 0) {
      refetchRoutines({ participantIds: selectedIds.join(','), month: selectedMonth, dayType });
    }
  }, [selectedIds, selectedMonth, dayType, refetchRoutines]);

  // Auto-update when participants change in the dropdowns
  useEffect(() => {
    const ids = [];
    if (participant1) ids.push(parseInt(participant1));
    if (participant2) ids.push(parseInt(participant2));
    if (ids.length > 0) {
      setSelectedIds(ids);
      setShowSuggestions(false);
    }
  }, [participant1, participant2]);

  const handleCompare = () => {
    const ids = [];
    if (participant1) ids.push(parseInt(participant1));
    if (participant2) ids.push(parseInt(participant2));
    if (ids.length > 0) {
      setSelectedIds(ids);
      setShowSuggestions(false);
    }
  };

  const handleSuggestedPair = (ids) => {
    setParticipant1(ids[0].toString());
    setParticipant2(ids[1].toString());
    setSelectedIds(ids);
    setShowSuggestions(false);
  };

  // Sort participants by how different their routines are
  const sortedParticipants = useMemo(() => {
    if (!listData?.routine_summaries) return [];
    return listData.routine_summaries;
  }, [listData]);

  // Controller object for D3 chart callbacks
  const chartController = useMemo(() => ({
    onActivityHover: (data, event) => {
      setTooltipContent({
        type: 'activity',
        hour: data.hour,
        activity: data.activity,
        confidence: data.confidence,
        activities: data.activities
      });
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('display', 'block')
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 80}px`);
      }
    },
    onActivityLeave: () => {
      setTooltipContent(null);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current).style('display', 'none');
      }
    },
    onCheckinHover: (checkin, event) => {
      setTooltipContent({
        type: 'checkin',
        hour: checkin.hour,
        venueType: checkin.venue_type,
        visitCount: checkin.visit_count
      });
      if (tooltipRef.current) {
        d3.select(tooltipRef.current)
          .style('display', 'block')
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 80}px`);
      }
    },
    onCheckinLeave: () => {
      setTooltipContent(null);
      if (tooltipRef.current) {
        d3.select(tooltipRef.current).style('display', 'none');
      }
    },
  }), []);

  // Update chart when routine data changes (lazy initialization)
  useEffect(() => {
    if (!timelineRef.current || !routineData?.routines) return;

    // Reinitialize chart when data changes
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    
    chartRef.current = new DailyRoutinesChart(timelineRef.current, chartController);
    chartRef.current.initialize();

    chartRef.current.update({
      routines: routineData.routines,
      travelRoutes: routineData.travel_routes || {},
      buildingsData: buildingsData
    });
  }, [routineData, buildingsData, chartController, selectedMonth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  // Render tooltip content based on type
  const renderTooltipContent = () => {
    if (!tooltipContent) return null;

    if (tooltipContent.type === 'activity') {
      return (
        <>
          <strong>{tooltipContent.hour}:00 - {tooltipContent.hour + 1}:00</strong><br />
          Activity: {ACTIVITY_LABELS[tooltipContent.activity] || tooltipContent.activity}<br />
          Confidence: {tooltipContent.confidence.toFixed(1)}%
          {tooltipContent.activities && (
            <><br /><small>Based on {tooltipContent.activities.reduce((sum, a) => sum + a.count, 0)} observations</small></>
          )}
        </>
      );
    }

    if (tooltipContent.type === 'checkin') {
      return (
        <>
          <strong>{tooltipContent.hour}:00</strong><br />
          {tooltipContent.venueType}: {tooltipContent.visitCount} visits
        </>
      );
    }

    return null;
  };

  if (listLoading) {
    return (
      <div className="daily-routines visualization-container">
        <div className="loading">Loading participant data...</div>
      </div>
    );
  }

  return (
    <div className="daily-routines visualization-container">
      <div className="controls">
        <div className="control-group month-control">
          <label>Time Period:</label>
          <div className="month-buttons-container">
            {availableMonths.map((month) => (
              <button
                key={month.value}
                className={`month-button ${selectedMonth === month.value ? 'active' : ''}`}
                onClick={() => setSelectedMonth(month.value)}
              >
                {month.short}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group day-type-control">
          <label>Day Type:</label>
          <div className="day-type-buttons">
            <button
              className={`day-type-button ${dayType === 'all' ? 'active' : ''}`}
              onClick={() => setDayType('all')}
            >
              All Days
            </button>
            <button
              className={`day-type-button ${dayType === 'weekday' ? 'active' : ''}`}
              onClick={() => setDayType('weekday')}
            >
              Weekdays
            </button>
            <button
              className={`day-type-button ${dayType === 'weekend' ? 'active' : ''}`}
              onClick={() => setDayType('weekend')}
            >
              Weekends
            </button>
          </div>
        </div>
        <div className="control-group">
          <label htmlFor="participant1">Participant 1:</label>
          <select 
            id="participant1"
            value={participant1} 
            onChange={(e) => setParticipant1(e.target.value)}
          >
            <option value="">Select participant...</option>
            {sortedParticipants.map(p => (
              <option key={p.participantid} value={p.participantid}>
                ID {p.participantid} - Home: {p.pct_at_home}%, Work: {p.pct_at_work}%
              </option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="participant2">Participant 2:</label>
          <select 
            id="participant2"
            value={participant2} 
            onChange={(e) => setParticipant2(e.target.value)}
          >
            <option value="">Select participant...</option>
            {sortedParticipants.map(p => (
              <option key={p.participantid} value={p.participantid}>
                ID {p.participantid} - Home: {p.pct_at_home}%, Work: {p.pct_at_work}%
              </option>
            ))}
          </select>
        </div>
        <button 
          className="compare-btn"
          onClick={handleCompare}
          disabled={!participant1 && !participant2}
        >
          Compare Routines
        </button>
      </div>

      {showSuggestions && (
        <div className="suggestions-panel">
          <h4>Suggested Comparisons</h4>
          <p>Click to compare participants with different daily routines:</p>
          <div className="suggestion-buttons">
            {SUGGESTED_PAIRS.map((pair, idx) => (
              <button 
                key={idx}
                className="suggestion-btn"
                onClick={() => handleSuggestedPair(pair.ids)}
              >
                Compare #{pair.ids[0]} &amp; #{pair.ids[1]}
                <small>{pair.description}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {routineLoading && (
        <div className="loading">Loading routine data...</div>
      )}

      {routineData?.routines && Object.keys(routineData.routines).length > 0 && (
        <>
          <div className="selected-period-banner">
            <strong>Showing data for:</strong> {availableMonths.find(m => m.value === selectedMonth)?.label || 'All Months'}
            {' | '}
            <strong>Day Type:</strong> {dayType === 'all' ? 'All Days' : dayType === 'weekday' ? 'Weekdays (Mon-Fri)' : 'Weekends (Sat-Sun)'}
          </div>
          <div className="timeline-container" ref={timelineRef}></div>
          <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
            {renderTooltipContent()}
          </div>
          
          <div className="comparison-summary">
            <h4>Routine Comparison Summary</h4>
            <div className="summary-grid">
              {Object.entries(routineData.routines).map(([pid, routine]) => {
                const participant = routine.participant;
                const timeline = routine.timeline || [];
                
                // Calculate activity distribution
                const activityCounts = {};
                timeline.forEach(h => {
                  const act = h.dominant_activity;
                  activityCounts[act] = (activityCounts[act] || 0) + 1;
                });
                
                return (
                  <div key={pid} className="participant-summary">
                    <h5>Participant {pid}</h5>
                    {participant && (
                      <div className="participant-details">
                        <p><strong>Age:</strong> {participant.age}</p>
                        <p><strong>Education:</strong> {participant.education || 'N/A'}</p>
                        <p><strong>Interest:</strong> {participant.interestgroup || 'N/A'}</p>
                        {participant.starttime && (
                          <p><strong>Work Hours:</strong> {participant.starttime} - {participant.endtime}</p>
                        )}
                      </div>
                    )}
                    <div className="activity-breakdown">
                      <h6>Daily Activity Breakdown:</h6>
                      {Object.entries(activityCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([activity, hours]) => (
                          <div key={activity} className="activity-bar">
                            <span 
                              className="activity-color" 
                              style={{ backgroundColor: ACTIVITY_COLORS[activity] }}
                            ></span>
                            <span className="activity-name">{ACTIVITY_LABELS[activity] || activity}</span>
                            <div className="activity-bar-container">
                              <div 
                                className="activity-bar-fill"
                                style={{ 
                                  width: `${Math.round(hours/24*100)}%`,
                                  backgroundColor: ACTIVITY_COLORS[activity]
                                }}
                              />
                            </div>
                            <span className="activity-hours">{hours}h ({Math.round(hours/24*100)}%)</span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DailyRoutines;
