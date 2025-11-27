import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useApi } from '../../hooks/useApi';
import { fetchParticipantRoutines } from '../../api';

const ACTIVITY_COLORS = {
  'AtHome': '#4CAF50',
  'AtWork': '#2196F3',
  'AtRecreation': '#FF9800',
  'AtRestaurant': '#E91E63',
  'Transport': '#9C27B0',
  'Unknown': '#BDBDBD'
};

const ACTIVITY_LABELS = {
  'AtHome': 'At Home',
  'AtWork': 'At Work',
  'AtRecreation': 'Recreation',
  'AtRestaurant': 'Restaurant',
  'Transport': 'Commuting',
  'Unknown': 'Unknown'
};

// Pre-selected interesting participants with different routines
const SUGGESTED_PAIRS = [
  { ids: [0, 100], description: 'Different work schedules' },
  { ids: [1, 50], description: 'Social vs. home-oriented' },
  { ids: [10, 200], description: 'Early bird vs. night owl' },
];

function DailyRoutines() {
  const timelineRef = useRef(null);
  const [participant1, setParticipant1] = useState('');
  const [participant2, setParticipant2] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  
  // First, fetch the list of participants
  const { data: listData, loading: listLoading } = useApi(
    fetchParticipantRoutines, 
    {}, 
    true
  );
  
  // Then fetch detailed routines for selected participants
  const { data: routineData, loading: routineLoading, refetch: refetchRoutines } = useApi(
    fetchParticipantRoutines,
    { participantIds: selectedIds.join(',') },
    false
  );

  // Load routines when selection changes
  useEffect(() => {
    if (selectedIds.length > 0) {
      refetchRoutines({ participantIds: selectedIds.join(',') });
    }
  }, [selectedIds]);

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

  // Draw timeline visualization
  useEffect(() => {
    if (!routineData?.routines || !timelineRef.current) return;

    const routines = routineData.routines;
    const participantIds = Object.keys(routines).map(Number);
    
    if (participantIds.length === 0) return;

    const container = timelineRef.current;
    const width = container.clientWidth;
    const rowHeight = 60;
    const margin = { top: 40, right: 30, bottom: 60, left: 150 };
    const innerWidth = width - margin.left - margin.right;
    const height = margin.top + margin.bottom + (participantIds.length * rowHeight * 2);

    d3.select(container).selectAll('*').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Time scale (0-24 hours)
    const xScale = d3.scaleLinear()
      .domain([0, 24])
      .range([0, innerWidth]);

    // Draw time axis
    const timeAxis = d3.axisTop(xScale)
      .ticks(24)
      .tickFormat(d => `${d}:00`);

    g.append('g')
      .attr('class', 'time-axis')
      .call(timeAxis)
      .selectAll('text')
      .style('font-size', '10px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'start');

    // Draw grid lines
    g.selectAll('.grid-line')
      .data(d3.range(0, 25, 3))
      .enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', participantIds.length * rowHeight * 2)
      .attr('stroke', '#e0e0e0')
      .attr('stroke-dasharray', '2,2');

    // Draw each participant's timeline
    participantIds.forEach((pid, idx) => {
      const routine = routines[pid];
      const y = idx * rowHeight * 2 + 20;
      
      // Participant label
      const participant = routine.participant;
      const labelText = participant 
        ? `ID ${pid} (Age: ${participant.age}, ${participant.education || 'N/A'})`
        : `Participant ${pid}`;
      
      g.append('text')
        .attr('x', -10)
        .attr('y', y + rowHeight / 2)
        .attr('text-anchor', 'end')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text(labelText);

      // Activity timeline bars
      const timeline = routine.timeline || [];
      const hourWidth = innerWidth / 24;

      timeline.forEach((hour, hourIdx) => {
        const activity = hour.dominant_activity;
        const color = ACTIVITY_COLORS[activity] || ACTIVITY_COLORS['Unknown'];
        const confidence = hour.confidence || 0;

        g.append('rect')
          .attr('x', xScale(hourIdx))
          .attr('y', y)
          .attr('width', hourWidth - 1)
          .attr('height', rowHeight - 10)
          .attr('fill', color)
          .attr('opacity', Math.max(0.3, confidence / 100))
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function(event) {
            d3.select(this).attr('stroke', '#000').attr('stroke-width', 2);
            
            // Show tooltip
            const tooltip = d3.select('#routine-tooltip');
            tooltip.style('display', 'block')
              .style('left', `${event.pageX + 10}px`)
              .style('top', `${event.pageY - 10}px`)
              .html(`
                <strong>${hourIdx}:00 - ${hourIdx + 1}:00</strong><br/>
                Activity: ${ACTIVITY_LABELS[activity] || activity}<br/>
                Confidence: ${confidence.toFixed(1)}%
                ${hour.activities ? `<br/><small>Based on ${hour.activities.reduce((sum, a) => sum + a.count, 0)} observations</small>` : ''}
              `);
          })
          .on('mouseout', function() {
            d3.select(this).attr('stroke', 'none');
            d3.select('#routine-tooltip').style('display', 'none');
          });
      });

      // Add checkin markers if available
      if (routine.checkins && routine.checkins.length > 0) {
        const checkinY = y + rowHeight;
        
        g.append('text')
          .attr('x', -10)
          .attr('y', checkinY + 10)
          .attr('text-anchor', 'end')
          .attr('font-size', '10px')
          .attr('fill', '#666')
          .text('Venue visits:');

        routine.checkins.forEach(checkin => {
          const venueColor = checkin.venue_type === 'Restaurant' ? '#E91E63' :
                            checkin.venue_type === 'Pub' ? '#FF5722' :
                            checkin.venue_type === 'Workplace' ? '#2196F3' : '#9E9E9E';
          
          g.append('circle')
            .attr('cx', xScale(checkin.hour) + hourWidth / 2)
            .attr('cy', checkinY + 10)
            .attr('r', Math.min(8, Math.max(3, Math.sqrt(checkin.visit_count) * 2)))
            .attr('fill', venueColor)
            .attr('opacity', 0.7)
            .style('cursor', 'pointer')
            .on('mouseover', function(event) {
              d3.select(this).attr('stroke', '#000').attr('stroke-width', 2);
              d3.select('#routine-tooltip')
                .style('display', 'block')
                .style('left', `${event.pageX + 10}px`)
                .style('top', `${event.pageY - 10}px`)
                .html(`
                  <strong>${checkin.hour}:00</strong><br/>
                  ${checkin.venue_type}: ${checkin.visit_count} visits
                `);
            })
            .on('mouseout', function() {
              d3.select(this).attr('stroke', 'none');
              d3.select('#routine-tooltip').style('display', 'none');
            });
        });
      }
    });

    // Legend
    const legend = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${height - 30})`);

    Object.entries(ACTIVITY_COLORS).forEach(([activity, color], idx) => {
      if (activity === 'Unknown') return;
      
      legend.append('rect')
        .attr('x', idx * 120)
        .attr('y', 0)
        .attr('width', 15)
        .attr('height', 15)
        .attr('fill', color);

      legend.append('text')
        .attr('x', idx * 120 + 20)
        .attr('y', 12)
        .attr('font-size', '11px')
        .text(ACTIVITY_LABELS[activity]);
    });

  }, [routineData]);

  if (listLoading) {
    return (
      <div className="visualization-container">
        <div className="loading">Loading participant data...</div>
      </div>
    );
  }

  return (
    <div className="visualization-container">
      <div className="controls">
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
                Compare #{pair.ids[0]} & #{pair.ids[1]}
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
          <div className="timeline-container" ref={timelineRef}></div>
          <div id="routine-tooltip" className="tooltip" style={{ display: 'none' }}></div>
          
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

      <div className="info-panel">
        <h3>Understanding Daily Routines</h3>
        <p>
          This visualization shows how participants spend their typical day. Each row 
          represents a participant's 24-hour routine, with colors indicating different activities.
        </p>
        <p>
          <strong>How to identify different routines:</strong>
        </p>
        <ul>
          <li><strong>Work patterns:</strong> Look for blue (AtWork) blocks - some work 9-5, others have irregular schedules</li>
          <li><strong>Social activity:</strong> Orange/pink blocks show recreation and dining out</li>
          <li><strong>Home time:</strong> Green blocks indicate time at home</li>
          <li><strong>Commuting:</strong> Purple blocks show travel between locations</li>
        </ul>
        <p>
          <strong>Confidence level:</strong> Darker colors indicate more consistent patterns; lighter colors 
          mean the participant varies their activity more at that time.
        </p>
      </div>
    </div>
  );
}

export default DailyRoutines;
