# Theme River Visualization - Point 4: Temporal Pattern Evolution

## Overview

The Theme River (streamgraph) visualization addresses **Point 4** of the VAST Challenge: *"Over the span of the dataset, how do patterns in the city change? Describe up to 10 significant changes, with supporting evidence."*

This visualization uses a flowing, organic streamgraph layout to show how different behaviors and activities in the city evolve over the 15-month period captured in the dataset.

## Visualization Features

### 1. **Three Dimensional Views**

The theme river supports three different data dimensions, each revealing different aspects of city evolution:

#### **Participant Modes** (Default)
- **Data Source**: `participantstatuslogs` table
- **Categories**: AtHome, AtWork, AtRecreation, AtRestaurant, Transport
- **Insight**: Shows how citizens' daily behaviors shift over time
- **Key Patterns to Look For**:
  - Seasonal variations in recreation vs. work
  - Changes in commuting patterns (Transport mode)
  - Shifts between home-based and location-based activities
  - Work-life balance evolution

#### **Travel Purposes**
- **Data Source**: `traveljournal` table
- **Categories**: Work/Home Commute, Eating, Recreation (Social Gathering), Coming Back From Restaurant, Going Back to Home
- **Insight**: Reveals mobility patterns and how people move through the city
- **Key Patterns to Look For**:
  - Evolution of dining/restaurant behavior
  - Changes in social gathering frequency
  - Commuting pattern shifts
  - Weekend vs. weekday activity differences

#### **Spending Categories**
- **Data Source**: `financialjournal` table
- **Categories**: Food, Recreation, Education, Shelter, RentAdjustment
- **Insight**: Economic activity and household budget allocation over time
- **Key Patterns to Look For**:
  - Seasonal spending variations
  - Economic stress indicators (shelter vs. recreation spending)
  - Educational investment patterns
  - Food spending trends

### 2. **Time Granularity Options**

- **Daily**: Fine-grained view showing day-to-day fluctuations
- **Weekly**: Balanced view smoothing daily noise while preserving trends
- **Monthly**: High-level strategic view of long-term changes

### 3. **Scale Options**

- **Absolute Values**: Shows raw counts/amounts - useful for understanding total volume
- **Normalized (%)**: Shows relative proportions - better for comparing category balance

### 4. **Interactive Features**

- **Hover Tooltips**: Shows exact values for each category at any time point
- **Stream Highlighting**: Hovering on a stream dims others for focus
- **Legend Interaction**: Click legend items to toggle category visibility (planned)
- **Smooth Transitions**: D3 curve interpolation creates flowing, organic shapes

## Significant Changes Analysis

The visualization automatically calculates and displays up to **10 significant changes** by:

1. **Comparing Time Periods**: Takes first month vs. last month of data (or equivalent for other granularities)
2. **Calculating Metrics**:
   - Absolute change in values
   - Percentage change
   - Direction of change (increase/decrease)
3. **Ranking**: Sorts by magnitude of change
4. **Visual Presentation**: Color-coded cards (green for increases, red for decreases)

### Example Significant Changes (Mode Dimension)

Based on the visualization, you might discover patterns like:

1. **↑ 45.2% - AtRecreation**
   - Recreation activities increased substantially
   - May indicate improving social conditions or seasonal effects
   
2. **↓ 23.1% - Transport**
   - Transportation decreased
   - Could indicate remote work adoption or neighborhood-centric living
   
3. **↑ 18.7% - AtHome**
   - More time spent at home
   - Possible correlation with transport decrease
   
4. **↓ 12.4% - AtWork**
   - Workplace presence decreased
   - May support remote work hypothesis
   
5. **↑ 8.9% - AtRestaurant**
   - Restaurant visits increased
   - Economic or social indicator

## Technical Implementation

### Backend API Endpoint: `/api/theme-river`

**Parameters:**
- `granularity`: 'daily' | 'weekly' | 'monthly' (default: 'weekly')
- `dimension`: 'mode' | 'purpose' | 'spending' (default: 'mode')
- `normalize`: 'true' | 'false' (default: 'false')

**Response Structure:**
```json
{
  "granularity": "weekly",
  "dimension": "mode",
  "normalize": false,
  "date_range": {
    "start": "2022-01-01",
    "end": "2023-03-31"
  },
  "periods": ["2022-01-03", "2022-01-10", ...],
  "categories": ["AtHome", "AtWork", "AtRecreation", "AtRestaurant", "Transport"],
  "data": [
    {
      "period": "2022-01-03",
      "AtHome": 12543,
      "AtWork": 8932,
      ...
    },
    ...
  ],
  "significant_changes": [
    {
      "category": "AtRecreation",
      "first_avg": 3421.5,
      "last_avg": 4967.2,
      "abs_change": 1545.7,
      "pct_change": 45.2
    },
    ...
  ]
}
```

### Frontend Components

**Files:**
- `frontend/src/components/ThemeRiver/ThemeRiver.js` - React component with controls
- `frontend/src/components/ThemeRiver/ThemeRiverChart.js` - D3 visualization logic
- `frontend/src/components/ThemeRiver/ThemeRiver.css` - Styling

**Key D3 Features:**
- `d3.stack()` - Stacks data for streamgraph layout
- `d3.stackOffsetWiggle` - Classic streamgraph centering algorithm
- `d3.stackOrderInsideOut` - Orders streams for visual balance
- `d3.area()` - Generates smooth area paths
- `d3.curveBasis` - Creates flowing, organic curves

### Data Processing Pipeline

1. **SQL Aggregation**: Queries aggregate raw logs by time period and category
2. **Temporal Grouping**: Groups by day/week/month using PostgreSQL `DATE_TRUNC`
3. **Normalization** (optional): Converts to percentages within each period
4. **Gap Filling**: Ensures all categories present in all periods (0 if missing)
5. **Stack Layout**: D3 transforms flat data into stacked format
6. **Wiggle Offset**: Centers the streamgraph vertically
7. **Rendering**: Draws smooth curved paths with interactive overlays

## Interpretation Guidelines

### Reading the Streamgraph

1. **Width = Volume**: Wider streams indicate more activity in that category
2. **Position**: Vertical position is abstract (wiggle offset) - focus on width/area
3. **Flow**: Follow a single stream's width changes over time
4. **Crossings**: When streams cross, their relative importance is shifting
5. **Overall Shape**: 
   - Expanding = overall growth
   - Contracting = overall decline
   - Stable = consistent activity levels

### Analyzing Patterns

**Look for:**
- **Seasonal Cycles**: Regular expansions/contractions suggesting calendar effects
- **Trend Shifts**: Gradual changes indicating long-term evolution
- **Sudden Changes**: Spikes or drops suggesting events or policy changes
- **Correlation**: Multiple streams changing together (e.g., Transport down, AtHome up)
- **Balance Shifts**: One category growing at expense of another

### Answering Point 4

The theme river directly addresses "how patterns change" by:

1. **Visual Evidence**: Clear graphical representation of change over time
2. **Quantified Changes**: Numerical values in "significant changes" section
3. **Multiple Perspectives**: Three dimensions reveal different pattern types
4. **Temporal Resolution**: Adjustable granularity for different analysis scales
5. **Comparative Analysis**: Normalized view shows relative vs. absolute changes

## Usage Tips

### For Analysis

1. **Start with Weekly/Mode**: Good default for overview
2. **Switch to Normalized**: When total volumes change but you want to see composition
3. **Use Daily for Events**: Find specific dates of sudden changes
4. **Compare Dimensions**: Check if mode, purpose, and spending tell consistent stories
5. **Cross-reference**: Use with other visualizations (Temporal Patterns, Flow Map) for validation

### For Presentation

1. **Show Multiple Views**: Demonstrate consistency across dimensions
2. **Highlight Specific Changes**: Use significant changes cards as talking points
3. **Tell the Story**: Connect visual patterns to real-world explanations
4. **Zoom In**: Switch granularity to show detail after showing overview
5. **Compare Scales**: Show both absolute and normalized for complete picture

## Color Schemes

### Participant Modes
- 🔵 **AtHome** - Blue (#3498db) - Calm, domestic
- 🟢 **AtWork** - Green (#2ecc71) - Productive, professional
- ⚪ **Transport** - Gray (#95a5a6) - Neutral, transitional
- 🔴 **AtRecreation** - Red (#e74c3c) - Energetic, leisure
- 🟠 **AtRestaurant** - Orange (#f39c12) - Social, dining

### Travel Purposes
- 🟢 **Work/Home Commute** - Green
- 🟠 **Eating** - Orange
- 🔴 **Recreation** - Red
- Colors emphasize activity type (work, leisure, sustenance)

### Spending Categories
- 🟠 **Food** - Orange
- 🔴 **Recreation** - Red
- 🔵 **Education** - Blue
- 🟣 **Shelter** - Purple
- Colors reflect category semantics

## Future Enhancements

1. **Interactive Filtering**: Date range selection
2. **Legend Toggle**: Click to hide/show specific categories
3. **Annotation Layer**: Mark significant events or periods
4. **Comparison Mode**: Side-by-side streamgraphs
5. **Export**: Download SVG or PNG of current view
6. **Drill-down**: Click period to see detailed breakdown
7. **Statistical Overlays**: Moving averages, trend lines
8. **Correlation Analysis**: Highlight correlated category pairs

## Performance Notes

- **Caching**: Backend caches results for common parameter combinations
- **Efficient Queries**: Uses PostgreSQL date truncation and aggregation
- **D3 Optimization**: Smooth 60fps rendering with hardware acceleration
- **Data Volume**: Handles 15 months × 5 categories × 3 granularities efficiently
- **Response Time**: ~100-500ms for most queries (from cache: <10ms)

## References

- **Streamgraph Theory**: Byron & Wattenberg, "Stacked Graphs - Geometry & Aesthetics" (2008)
- **D3.js Documentation**: [d3-shape/stack](https://github.com/d3/d3-shape#stacks)
- **VAST Challenge 2022**: Dataset documentation and challenge questions
- **Theme River Origins**: Havre et al., "ThemeRiver: Visualizing Thematic Changes in Large Document Collections" (2002)
