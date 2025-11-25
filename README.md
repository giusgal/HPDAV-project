# HPDAV-project

## Prerequisites

Before running the setup script, ensure you have the following tools installed on your machine:

1. wget (for downloading database files)
2. unzip (for extracting the database dump)
3. Docker & Docker Compose (v2)

## Installation & Setup

To start the application, clone the repository and run the automated setup script.

```bash
# 1. Clone the repository
git clone https://github.com/giusgal/HPDAV-project.git

# 2. Enter the directory
cd HPDAV-project

# 3. Make the script executable
chmod +x setup.sh

# 4. Run the setup
# NOTE: a password will be required by docker to start the containers
./setup.sh
```
Once the script finishes, you can access the application at: `http://localhost:5000`

## Goal

In this project, we address the mini-challenge 2 of the 2022 VAST Challenge. Bellow is the description of it.

Anticipating rapid growth, the city of Engagement, Ohio USA is doing a participatory urban planning exercise to understand the current state of the city and identify opportunities for future growth. About 1000 representative residents in this modest-sized city have agreed to provide data using the city’s urban planning app, which records the places they visit, their spending, and their purchases, among other things. From these volunteers, the city will have data to assist with their major community revitalization efforts, including how to allocate a very large city renewal grant they have recently received. As a visual analytics expert, you have joined the city planning team to make sense of the data provided by these residents.

Challenge 2: Patterns of Life considers the patterns of daily life throughout the city. You will describe the daily routines for some representative people, characterize the travel patterns to identify potential bottlenecks or hazards, and examine how these patterns change over time and seasons.

In Challenge 2, you will use visual analytic techniques to address these questions:
 - Assuming the volunteers are representative of the city’s population, characterize the distinct areas of the city that you identify. For each area you identify, provide your rationale and supporting data. Limit your response to 10 images and 500 words.
 - Where are the busiest areas in Engagement? Are there traffic bottlenecks that should be addressed? Explain your rationale. Limit your response to 10 images and 500 words.
 - Participants have given permission to have their daily routines captured. Choose two different participants with different routines and describe their daily patterns, with supporting evidence. Limit your response to 10 images and 500 words.
 - Over the span of the dataset, how do patterns change in the city change? Describe up to 10 significant changes, with supporting evidence. Limit your response to 10 images and 500 words.

## Troubleshooting

- Permission Errors: If you receive permission errors running Docker commands, ensure your user is in the docker group, or run the script with sudo.

- Download Failures: If the database parts fail to download, ensure you have a stable internet connection, as the files are retrieved from GitHub Releases.
