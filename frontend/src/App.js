import React, { useState } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import { AreaCharacteristics, TrafficPatterns } from './components/visualizations';
import './App.css';

const VIEWS = [
  { id: 'area-characteristics', label: 'Area Characteristics', component: AreaCharacteristics },
  { id: 'traffic-patterns', label: 'Traffic Patterns', component: TrafficPatterns },
  // Add more views here as needed
];

function App() {
  const [activeView, setActiveView] = useState('area-characteristics');

  const ActiveComponent = VIEWS.find(v => v.id === activeView)?.component || AreaCharacteristics;
  const activeLabel = VIEWS.find(v => v.id === activeView)?.label || 'Data Visualization';

  return (
    <Layout title={activeLabel}>
      <div className="app-content">
        <Sidebar 
          activeView={activeView} 
          onViewChange={setActiveView}
          views={VIEWS}
        />
        <div className="main-content">
          <ActiveComponent />
        </div>
      </div>
    </Layout>
  );
}

export default App;
