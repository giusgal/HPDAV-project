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
      
      // Always update chart, even if selectedParticipant is null
      chartInstanceRef.current.update(data, selectedParticipant);
    }
  }, [data, selectedParticipant]);

  const handleParticipantChange = (e) => {
    const value = e.target.value;
    if (value === '') {
      setSelectedParticipant(null); // Allow clearing the selection
      return;
    }
    const participantId = parseInt(value);
    if (!isNaN(participantId) && data?.participants?.some(p => p.participantid === participantId)) {
      setSelectedParticipant(participantId);
    }
  };

  const handlePrevious = () => {
    if (!data || !data.participants || selectedParticipant === null) return;
    const currentIndex = data.participants.findIndex(p => p.participantid === selectedParticipant);
    if (currentIndex > 0) {
      setSelectedParticipant(data.participants[currentIndex - 1].participantid);
    }
  };

  const handleNext = () => {
    if (!data || !data.participants || selectedParticipant === null) return;
    const currentIndex = data.participants.findIndex(p => p.participantid === selectedParticipant);
    if (currentIndex < data.participants.length - 1) {
      setSelectedParticipant(data.participants[currentIndex + 1].participantid);
    }
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
          <label htmlFor="participant-input">Person Id</label>
          <div className="participant-selector">
            <button 
              className="nav-button"
              onClick={handlePrevious}
              disabled={!data || !data.participants || selectedParticipant === null || 
                data.participants.findIndex(p => p.participantid === selectedParticipant) === 0}
            >
              ◀
            </button>
            <input
              id="participant-input"
              type="number"
              value={selectedParticipant !== null ? selectedParticipant : ''}
              onChange={handleParticipantChange}
              placeholder="Enter ID"
              min="0"
              max={data?.participants ? data.participants[data.participants.length - 1].participantid : 0}
            />
            <button 
              className="nav-button"
              onClick={handleNext}
              disabled={!data || !data.participants || selectedParticipant === null || 
                data.participants.findIndex(p => p.participantid === selectedParticipant) === data.participants.length - 1}
            >
              ▶
            </button>
          </div>
        </div>
      </div>
      
      <div className="chart-wrapper">
        <div ref={chartRef} className="parallel-coordinates-chart"></div>
      </div>
    </div>
  );
}

export default ParallelCoordinates;
