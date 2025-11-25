import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await axios.get('http://localhost:5000/');
        setData(response.data);
        setError(null);
      } catch (err) {
        setError(err.message);
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>HPDAV Project - Data Visualization</h1>
      </header>
      <main className="App-main">
        <div className="data-container">
          <h2>Flask API Response</h2>
          {loading && <p>Loading data from backend...</p>}
          {error && <p className="error">Error: {error}</p>}
          {data && (
            <div className="data-content">
              <div dangerouslySetInnerHTML={{ __html: data }} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
