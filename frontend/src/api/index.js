import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

export const fetchAreaCharacteristics = async (params = {}) => {
  const { gridSize = 500, metric = 'all' } = params;
  const response = await api.get('/api/area-characteristics', {
    params: { grid_size: gridSize, metric }
  });
  return response.data;
};

export const fetchTrafficPatterns = async (params = {}) => {
  const { 
    gridSize = 500, 
    timePeriod = 'all', 
    dayType = 'all',
    metric = 'all' 
  } = params;
  const response = await api.get('/api/traffic-patterns', {
    params: { 
      grid_size: gridSize, 
      time_period: timePeriod,
      day_type: dayType,
      metric 
    }
  });
  return response.data;
};

export const fetchParticipantRoutines = async (params = {}) => {
  const { participantIds = '', date = 'typical' } = params;
  const response = await api.get('/api/participant-routines', {
    params: { 
      participant_ids: participantIds,
      date
    }
  });
  return response.data;
};

export const fetchTemporalPatterns = async (params = {}) => {
  const { 
    granularity = 'weekly', 
    metric = 'all',
    venueType = 'all'
  } = params;
  const response = await api.get('/api/temporal-patterns', {
    params: { 
      granularity,
      metric,
      venue_type: venueType
    }
  });
  return response.data;
};

export default api;
