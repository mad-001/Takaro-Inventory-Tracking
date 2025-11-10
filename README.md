# Takaro Inventory Tracker Server

Self-hosted inventory tracking application for Takaro game servers.

## Installation

### 1. Install Node.js

Download and install Node.js from: https://nodejs.org/ (LTS version recommended)

### 2. Install Dependencies

Open Command Prompt or PowerShell in this directory and run:

```bash
npm install
```

### 3. Start the Server

```bash
npm start
```

Or double-click `start-server.bat`

## Usage

Once the server is running:

1. **Access locally:** http://localhost:5555
2. **Access from network:** http://SERVER:5555 (replace SERVER with your PC's IP or hostname)

## Configuration

- **Port:** 5555 (configured in `server.js`)
- **Game Server ID:** Pre-filled with Double Tap server
- **API Token:** Configured in `server.js` (auto-updated)

## Features

- Search players by coordinates and radius
- Filter by time range
- View player movement history
- Track inventory changes
- No CORS issues - everything runs on your server!

## Auto-Start on Boot (Optional)

1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `start-server.bat` in the Startup folder

## Troubleshooting

**Port 5555 already in use:**
- Edit `server.js` and change the `PORT` constant
- Common safe ports: 5555, 5556, 8888, 9999

**Can't access from other computers:**
- Check Windows Firewall settings
- Allow inbound connections on port 5555

**API token expired:**
- The token in `server.js` will need to be updated periodically
- Contact the administrator to get a fresh token
