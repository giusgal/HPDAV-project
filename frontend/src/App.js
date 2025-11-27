import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import AreaCharacteristics from './components/visualizations/AreaCharacteristics';
import BuildingsMap from './components/visualizations/BuildingsMap';
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
  // Add more views here
};

function App() {
  const defaultView = Object.keys(VIEWS)[0] || "buildings-map";
  const [activeView, setActiveView] = useState(defaultView);

  const { component: ActiveComponent, label: activeLabel } =
    VIEWS[activeView] || VIEWS[defaultView];

  return (
    <div className="App">
      <header className="App-header">
        <h1>HPDAV Project - {activeLabel}</h1>
      </header>
      <div className="App-main">
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          views={VIEWS}
        />
        <main className="main-content">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}

export default App;
