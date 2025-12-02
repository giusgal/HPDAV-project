import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import { BuildingsMap, AreaCharacteristics, TrafficPatterns, DailyRoutines, TemporalPatterns, FlowMap, ThemeRiver, ParallelCoordinates } from './components';
import './App.css';

const VIEWS = {
  "buildings-map": {id: "buildings-map", label: "Buildings Map", component: BuildingsMap},
  "area-characteristics": {id: "area-characteristics", label: "Area Characteristics", component: AreaCharacteristics},
  'traffic-patterns': { id: 'traffic-patterns', label: 'Traffic Patterns', component: TrafficPatterns },
  'flow-map': { id: 'flow-map', label: 'Flow Map', component: FlowMap },
  'daily-routines': { id: 'daily-routines', label: 'Daily Routines', component: DailyRoutines },
  'temporal-patterns': { id: 'temporal-patterns', label: 'Temporal Patterns', component: TemporalPatterns },
  'theme-river': { id: 'theme-river', label: 'Theme River', component: ThemeRiver },
  'parallel-coordinates': { id: 'parallel-coordinates', label: 'Parallel Coordinates', component: ParallelCoordinates },
};

function App() {
  const defaultView = Object.keys(VIEWS)[0] || "buildings-map";
  const [activeView, setActiveView] = useState(defaultView);

  const { component: ActiveComponent, label: activeLabel } =
    VIEWS[activeView] || VIEWS[defaultView];

  return (
    <div className="App">
      <header className="App-header">
        <h1>VAST Challenge 2022 - {activeLabel}</h1>
      </header>
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
    </div>
  );
}

export default App;
