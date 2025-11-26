# API Hook Documentation

This document explains the workflow for calling backend API endpoints and the architectural patterns used for data fetching and visualization.

## useApi Hook

### Purpose

The `useApi` hook encapsulates all API fetching logic, providing:
- Automatic or manual data fetching
- Loading and error state management
- Memoized fetch function to prevent unnecessary re-renders
- Easy refetch capability with parameter overrides

### Hook Signature

```javascript
const { data, loading, error, refetch } = useApi(
  fetchFunction,   // Async function that fetches data
  initialParams,   // Object with initial parameters
  autoFetch        // Boolean - fetch on mount? (default: true)
);
```

### Return Values

| Property | Type | Description |
|----------|------|-------------|
| `data` | `any \| null` | Fetched data, null before first successful fetch |
| `loading` | `boolean` | True while a request is in progress |
| `error` | `string \| null` | Error message if request failed |
| `refetch` | `function` | Manually trigger fetch with optional param overrides |

## React Hooks Explained

### useState
Manages component-local state that triggers re-renders when changed.

```javascript
const [selectedMetric, setSelectedMetric] = useState('population');
const [gridSize, setGridSize] = useState(500);
```

### useEffect
Handles side effects and lifecycle events. Runs after render.

```javascript
// Run once on mount (empty deps)
useEffect(() => {
  chartRef.current = new AreaCharacteristicsChart(svgRef.current, controller);
  return () => chartRef.current?.destroy(); // Cleanup on unmount
}, []);

// Run when dependencies change
useEffect(() => {
  if (data) chartRef.current?.update(data);
}, [data]);
```

### useCallback
Memoizes functions to prevent re-creation on every render. Essential for:
- Preventing infinite loops in useEffect
- Optimizing child component re-renders
- Stable references for D3 callbacks

```javascript
const fetch = useCallback(async (overrideParams = {}) => {
  const result = await fetchFunction({ ...params, ...overrideParams });
  setData(result);
}, [fetchFunction, JSON.stringify(params)]);
```

### useMemo
Memoizes computed values. Only recalculates when dependencies change.

```javascript
const processedData = useMemo(() => {
  if (!data) return null;
  return expensiveTransformation(data);
}, [data]);
```

### useRef
Persists mutable values across renders without causing re-renders.

```javascript
const svgRef = useRef(null);      // Reference to DOM element
const chartRef = useRef(null);    // Reference to D3 class instance
```

## Adding a New API Endpoint

### Step 1: Add the fetch function in useApi.js

```javascript
/**
 * Fetch new data type.
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Response data
 */
export const fetchNewEndpoint = async (params = {}) => {
  const { param1, param2 } = params;
  const response = await apiClient.get('/api/new-endpoint', {
    params: { param1, param2 }
  });
  return response.data;
};
```

### Step 2: Use in a React component

```javascript
import { useApi, fetchNewEndpoint } from '../../hooks/useApi';

function MyComponent() {
  const { data, loading, error, refetch } = useApi(
    fetchNewEndpoint,
    { param1: 'default' },
    true  // autoFetch on mount
  );

  // Refetch with new params when user changes selection
  const handleChange = (newValue) => {
    refetch({ param1: newValue });
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return <MyVisualization data={data} />;
}
```

## React and D3 Separation of Responsibilities

### The Problem
D3 and React both want to control the DOM. Mixing them carelessly leads to:
- Race conditions
- Memory leaks
- Hard-to-debug rendering issues

### The Solution: Clear Separation

#### React Responsibilities
- **State management**: All application state lives in React (`useState`, `useMemo`)
- **Lifecycle**: Mount/unmount handling via `useEffect`
- **D3 instance management**: Create/destroy D3 classes, persist via `useRef`
- **Data flow**: Pass data to D3 via method calls
- **UI controls**: Render dropdowns, buttons, etc.

#### D3 Responsibilities
- **SVG creation**: All `append('svg')`, `append('g')`, etc.
- **DOM manipulation**: Direct element creation and updates
- **Scales and axes**: `d3.scaleLinear()`, `d3.axisBottom()`, etc.
- **Data binding**: `.data()`, `.join()`, `.enter()`, `.exit()`
- **Transitions**: `.transition()`, `.duration()`
- **Event handling**: Register listeners, callback to React

### Example: Controller Pattern

The controller bridges D3 events back to React state:

```javascript
// In React component
const controller = useMemo(() => ({
  onCellHover: (cell) => setHoveredCell(cell),
  onCellClick: (cell) => setSelectedCell(cell),
  formatValue: (value, metricId) => formatValue(value, metricId),
}), []);

// Pass to D3 class
chartRef.current = new AreaCharacteristicsChart(svgRef.current, controller);

// In D3 class
class AreaCharacteristicsChart {
  constructor(container, controller) {
    this.controller = controller;
  }

  bindEvents(cells) {
    cells.on('mouseover', (event, d) => {
      this.controller.onCellHover(d);  // Callback to React
    });
  }
}
```

## Async/Await Pattern

The `async/await` syntax makes asynchronous code readable:

```javascript
// Without async/await (callback hell)
api.get('/endpoint')
  .then(response => {
    return processData(response.data);
  })
  .then(processed => {
    setData(processed);
  })
  .catch(error => {
    setError(error.message);
  });

// With async/await (linear flow)
const fetch = async () => {
  try {
    const response = await api.get('/endpoint');
    const processed = processData(response.data);
    setData(processed);
  } catch (error) {
    setError(error.message);
  }
};
```

## Best Practices

1. **Never call setState inside render** - Use useEffect for side effects
2. **Memoize expensive computations** - Use useMemo for derived data
3. **Stable callback references** - Use useCallback for functions passed to D3
4. **Cleanup D3 on unmount** - Return cleanup function from useEffect
5. **D3 owns the DOM** - Don't mix React JSX inside D3 selections
6. **React owns the state** - D3 should callback to React, not manage state
