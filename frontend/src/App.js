import React, { useState } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import BuildingsMap from './components/visualizations/BuildingsMap';
import { AreaCharacteristics, TrafficPatterns, DailyRoutines, TemporalPatterns } from './components/visualizations';
import './App.css';

const VIEWS = {
  "buildings-map": {
    id: "buildings-map",
    label: "Buildings Map",
    component: BuildingsMap,
  },
  "area-characteristics": {
    id: "area-characteristics",
    label: "Area Characteristics",
    component: AreaCharacteristics,
  },
  'traffic-patterns': { id: 'traffic-patterns', label: 'Traffic Patterns', component: TrafficPatterns },
  'daily-routines': { id: 'daily-routines', label: 'Daily Routines', component: DailyRoutines },
  'temporal-patterns': { id: 'temporal-patterns', label: 'Temporal Patterns', component: TemporalPatterns },
};

function App() {
  const defaultView = Object.keys(VIEWS)[0] || "buildings-map";
  const [activeView, setActiveView] = useState(defaultView);

  const { component: ActiveComponent, label: activeLabel } =
    VIEWS[activeView] || VIEWS[defaultView];

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
