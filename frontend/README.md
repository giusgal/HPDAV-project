# HPDAV Frontend

React + D3 frontend for data visualization.

## Development

The frontend runs in a Docker container and is accessible at http://localhost:3000

It connects to the Flask backend API at http://localhost:5000

## Getting Started

From the project root directory:

```bash
docker-compose up frontend
```

Or to start all services:

```bash
docker-compose up
```

## Features

- React 18 for UI components
- D3.js for data visualization
- Axios for API communication
- Proxy configuration for seamless backend communication
- Hot reload enabled for development

## Project Structure

```
frontend/
├── public/          # Static files
├── src/
│   ├── App.js      # Main application component
│   ├── App.css     # Application styles
│   ├── index.js    # React entry point
│   └── index.css   # Global styles
├── Dockerfile      # Container configuration
└── package.json    # Dependencies and scripts
```
