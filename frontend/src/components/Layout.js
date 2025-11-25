import React from 'react';

function Layout({ children, title }) {
  return (
    <div className="App">
      <header className="App-header">
        <h1>HPDAV Project - {title || 'Data Visualization'}</h1>
      </header>
      <main className="App-main">
        {children}
      </main>
    </div>
  );
}

export default Layout;
