import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchParallelCoordinates } from '../../hooks/useApi';
import ParallelCoordinatesChart from './ParallelCoordinatesChart';
import './ParallelCoordinates.css';

function ParallelCoordinates() {
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [excludeOutliers, setExcludeOutliers] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchParallelCoordinates({ excludeOutliers });
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [excludeOutliers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  if (error) {
    return (
      <div className="parallel-coordinates-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="parallel-coordinates-container">
      {loading && <div className="loading-overlay">Loading parallel coordinates data...</div>}
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
        <div className="control-group checkbox-group">
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={excludeOutliers} 
              onChange={(e) => setExcludeOutliers(e.target.checked)} 
            />
            Exclude Outliers
          </label>
          <span className="checkbox-hint" title="Exclude participants who only logged data during the first month (<2000 records)">ⓘ</span>
        </div>
      </div>
      
      <div className="chart-wrapper">
        <div ref={chartRef} className="parallel-coordinates-chart"></div>
      </div>
    </div>
  );
}

export default ParallelCoordinates;
