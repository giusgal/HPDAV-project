import React from 'react';

function Layout({ title, children }) {
  return (
    <div className="App">
      <header className="App-header">
        <h1>VAST Challenge 2022 - {title}</h1>
      </header>
      <main className="App-main">
        {children}
      </main>
    </div>
  );
}

export default Layout;
