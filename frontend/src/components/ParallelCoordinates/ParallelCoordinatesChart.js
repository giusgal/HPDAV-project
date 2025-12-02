import * as d3 from 'd3';

class ParallelCoordinatesChart {
  constructor(container) {
    this.container = container;
    this.margin = { top: 60, right: 30, bottom: 80, left: 30 };
    this.svg = null;
    
    // Define the dimensions for parallel coordinates
    this.dimensions = [
      { key: 'work', label: 'Work' },
      { key: 'home', label: 'Home' },
      { key: 'social', label: 'Social' },
      { key: 'food', label: 'Food' },
      { key: 'travel', label: 'Travel' }
    ];
  }

  destroy() {
    if (this.svg) {
      this.svg.remove();
    }
  }

  update(data, selectedParticipantId) {
    if (!data || !data.participants) {
      console.log('No data or participants');
      return;
    }

    console.log('ParallelCoordinatesChart: update called');
    console.log('Container width:', this.container.clientWidth);
    console.log('Participants count:', data.participants.length);

    // Clear previous content
    d3.select(this.container).selectAll('*').remove();

    const width = this.container.clientWidth - this.margin.left - this.margin.right;
    const height = 600 - this.margin.top - this.margin.bottom;
    
    console.log('Chart dimensions:', { width, height });

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', width + this.margin.left + this.margin.right)
      .attr('height', height + this.margin.top + this.margin.bottom)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Find max values for each dimension
    const maxValues = {};
    this.dimensions.forEach(dim => {
      maxValues[dim.key] = d3.max(data.participants, d => d[dim.key] || 0);
    });

    // Create scales for each dimension
    const y = {};
    this.dimensions.forEach(dim => {
      y[dim.key] = d3.scaleLinear()
        .domain([0, maxValues[dim.key] || 100])
        .range([height, 0]);
    });

    // X scale for dimensions
    const x = d3.scalePoint()
      .domain(this.dimensions.map(d => d.key))
      .range([0, width])
      .padding(0.1);

    // Line generator
    const line = d3.line()
      .defined(d => !isNaN(d[1]))
      .x((d, i) => x(this.dimensions[i].key))
      .y(d => d[1]);

    // Draw background lines (all participants in light blue)
    data.participants.forEach(participant => {
      const pathData = this.dimensions.map(dim => [
        dim.key,
        y[dim.key](participant[dim.key] || 0)
      ]);

      this.svg.append('path')
        .datum(pathData)
        .attr('class', 'background-line')
        .attr('d', line)
        .style('fill', 'none')
        .style('stroke', '#a8d5ff')
        .style('stroke-width', 1)
        .style('opacity', 0.3);
    });

    // Draw highlighted line for selected participant
    if (selectedParticipantId) {
      const selectedParticipant = data.participants.find(
        p => p.participantid === selectedParticipantId
      );

      if (selectedParticipant) {
        const pathData = this.dimensions.map(dim => [
          dim.key,
          y[dim.key](selectedParticipant[dim.key] || 0)
        ]);

        this.svg.append('path')
          .datum(pathData)
          .attr('class', 'highlighted-line')
          .attr('d', line)
          .style('fill', 'none')
          .style('stroke', '#e74c3c')
          .style('stroke-width', 2.5)
          .style('opacity', 1);

        // Add title
        this.svg.append('text')
          .attr('x', width / 2)
          .attr('y', -30)
          .attr('text-anchor', 'middle')
          .style('font-size', '18px')
          .style('font-weight', 'bold')
          .text(`Participant ${selectedParticipantId}`);
      }
    }

    // Draw axes
    this.dimensions.forEach(dim => {
      const axis = d3.axisLeft(y[dim.key])
        .ticks(5);

      const g = this.svg.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(${x(dim.key)},0)`)
        .call(axis);

      // Axis line
      g.append('line')
        .attr('y1', 0)
        .attr('y2', height)
        .style('stroke', '#333')
        .style('stroke-width', 1.5);

      // Axis label
      g.append('text')
        .attr('y', height + 25)
        .attr('text-anchor', 'middle')
        .style('font-size', '14px')
        .style('font-weight', '500')
        .style('fill', '#333')
        .text(dim.label);
    });
  }
}

export default ParallelCoordinatesChart;
