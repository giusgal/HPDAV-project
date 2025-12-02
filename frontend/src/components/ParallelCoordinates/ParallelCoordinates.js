import React, { useState, useEffect, useRef } from 'react';
import { useApi, fetchParallelCoordinates } from '../../hooks/useApi';
import ParallelCoordinatesChart from './ParallelCoordinatesChart';
import './ParallelCoordinates.css';

function ParallelCoordinates() {
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const { data, loading, error } = useApi(fetchParallelCoordinates);
  const [selectedParticipant, setSelectedParticipant] = useState(null);

  console.log('ParallelCoordinates render - data:', data, 'loading:', loading, 'error:', error);

  // Initialize chart instance
  useEffect(() => {
    if (chartRef.current && !chartInstanceRef.current) {
      console.log('Creating chart instance');
      chartInstanceRef.current = new ParallelCoordinatesChart(chartRef.current);
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // Update chart when data or selection changes
  useEffect(() => {
    console.log('Update effect triggered', {
      hasChartInstance: !!chartInstanceRef.current,
      hasData: !!data,
      hasParticipants: !!(data && data.participants),
      participantsCount: data?.participants?.length
    });

    if (!chartRef.current) {
      console.log('chartRef not ready yet');
      return;
    }

    if (!chartInstanceRef.current) {
      console.log('Creating chart instance on demand');
      chartInstanceRef.current = new ParallelCoordinatesChart(chartRef.current);
    }

    if (data && data.participants) {
      console.log('ParallelCoordinates: Updating chart with data:', data.participants.length, 'participants');
      console.log('Selected participant:', selectedParticipant);
      chartInstanceRef.current.update(data, selectedParticipant);
      
      // Set default participant if not selected
      if (!selectedParticipant && data.participants.length > 0) {
        console.log('Setting default participant:', data.participants[0].participantid);
        setSelectedParticipant(data.participants[0].participantid);
      }
    }
  }, [data, selectedParticipant]);

  const handleParticipantChange = (e) => {
    const participantId = parseInt(e.target.value);
    setSelectedParticipant(participantId);
  };

  if (loading) {
    return (
      <div className="parallel-coordinates-container">
        <div className="loading">Loading parallel coordinates data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="parallel-coordinates-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="parallel-coordinates-container">
      <div className="controls">
        <div className="control-group">
          <label htmlFor="participant-select">Person Id</label>
          <select
            id="participant-select"
            value={selectedParticipant || ''}
            onChange={handleParticipantChange}
          >
            {data?.participants?.map(p => (
              <option key={p.participantid} value={p.participantid}>
                {p.participantid}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="chart-wrapper">
        <div ref={chartRef} className="parallel-coordinates-chart"></div>
      </div>
    </div>
  );
}

export default ParallelCoordinates;
