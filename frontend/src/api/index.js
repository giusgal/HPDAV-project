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

export default api;
