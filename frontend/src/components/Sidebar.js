import React from 'react';

function Sidebar({ activeView, onViewChange, views }) {
  return (
    <nav className="sidebar">
      <ul className="sidebar-menu">
        {Object.values(views).map(view => (
          <li key={view.id}>
            <button
              className={`sidebar-btn ${activeView === view.id ? 'active' : ''}`}
              onClick={() => onViewChange(view.id)}
            >
              {view.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default Sidebar;
