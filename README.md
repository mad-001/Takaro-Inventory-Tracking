# Takaro Inventory Tracker

A web-based inventory tracking tool for Takaro game servers. Track player inventory changes, detect theft, and analyze player activity within specific locations.

## Features

- **Location-based search** - Search for player activity within a radius
- **Inventory change tracking** - See exactly what items players picked up or dropped
- **Smart aggregation** - Combines multiple changes within 5-minute windows
- **Sortable columns** - Click any column header to sort
- **Color-coded changes** - Green for gains, orange for losses
- **Secure authentication** - Login with your Takaro credentials

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- A Takaro account with API access
- Your Takaro domain name

### Installation

1. **Download the latest release** from the [Releases page](https://github.com/mad-001/Takaro-Inventory-Tracking/releases)

2. **Extract the files** to your desired location

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Configure the application:**
   - Copy `config.example.json` to `config.json`
   - Edit `config.json` with your settings:
     ```json
     {
       "port": 5555,
       "takaroApi": "https://api.takaro.io",
       "takaroDomain": "your-domain-name-here"
     }
     ```

5. **Start the server:**
   - **Windows:** Double-click `start-server.bat` or run:
     ```cmd
     node server.js
     ```
   - **Linux/Mac:**
     ```bash
     node server.js
     ```

6. **Open your browser** to `http://localhost:5555`

## Configuration

### config.json

| Setting | Description | Example |
|---------|-------------|---------|
| `port` | Port number for the web server | `5555` |
| `takaroApi` | Takaro API endpoint | `https://api.takaro.io` |
| `takaroDomain` | Your Takaro domain name | `my-server-name` |

## Usage

1. **Login** with your Takaro email and password
2. **Select a game server** from the dropdown
3. **Enter search parameters:**
   - X and Z coordinates (center of search area)
   - Radius (in game units)
   - Time range
4. **Click "Search Inventory"**
5. **Analyze results:**
   - Click column headers to sort
   - Use the filter box to search for specific players or items
   - Green badges show items added (+)
   - Orange badges show items removed (-)

## How It Works

The tracker:
1. Searches for players within the specified radius and time range
2. Retrieves inventory snapshots for those players
3. Calculates changes between consecutive snapshots
4. Filters out oscillations (pick up → drop → pick up = net change)
5. Aggregates changes within 5-minute windows
6. Displays only meaningful inventory changes

## Troubleshooting

### Server won't start
- Make sure `config.json` exists (copy from `config.example.json`)
- Check that the port isn't already in use
- Verify Node.js is installed: `node --version`

### Can't login
- Verify your Takaro credentials
- Check that your domain name is correct in `config.json`
- Ensure you have API access enabled in Takaro

### No results found
- Verify coordinates are correct (use in-game position)
- Try increasing the search radius
- Check the time range includes when activity occurred
- Make sure the game server is selected correctly

## Development

```bash
# Install dependencies
npm install

# Run in development mode
node server.js

# The server will be available at http://localhost:5555
```

## License

MIT License - Feel free to use and modify!

## Support

For issues or questions:
- Open an issue on [GitHub](https://github.com/mad-001/Takaro-Inventory-Tracking/issues)
- Check existing issues for solutions
