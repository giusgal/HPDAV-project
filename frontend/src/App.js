import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import AreaCharacteristics from './components/visualizations/AreaCharacteristics';
import './App.css';

const VIEWS = {
  "area-characteristics": {
    id: "area-characteristics",
    label: "Area Characteristics",
    component: AreaCharacteristics,
  },
  // Add more views here
};

function App() {
  const [activeView, setActiveView] = useState("area-characteristics");

  const { component: ActiveComponent, label: activeLabel } =
    VIEWS[activeView] || VIEWS["area-characteristics"];

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
