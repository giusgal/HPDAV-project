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

## Troubleshooting

- Permission Errors: If you receive permission errors running Docker commands, ensure your user is in the docker group, or run the script with sudo.

- Download Failures: If the database parts fail to download, ensure you have a stable internet connection, as the files are retrieved from GitHub Releases.
