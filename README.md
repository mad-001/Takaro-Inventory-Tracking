# Takaro Inventory Tracker Server

Self-hosted inventory tracking application for Takaro game servers with dark theme UI.

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

1. **Login:** Navigate to http://localhost:5555/login or http://SERVER:5555/login
2. **Credentials:** Use your Takaro account email and password
3. **Search:** After login, you'll be redirected to the main search interface

### Accessing the Application

- **Local access:** http://localhost:5555
- **Network access:** http://SERVER:5555 (replace SERVER with your PC's IP or hostname)
- **Login page:** http://localhost:5555/login

## Authentication

The application uses **email/password authentication** with Takaro:

- Login at `/login` with your Takaro account credentials
- Sessions are managed server-side using Bearer tokens
- Tokens are automatically refreshed and managed
- No manual token configuration needed!

### How Authentication Works

1. User enters email and password on login page
2. Server authenticates with Takaro API and receives Bearer token
3. Session is created and stored server-side
4. Client receives session ID for subsequent API requests
5. All API calls include session authentication headers

## Features

- **🎨 Dark Theme UI** - Modern dark interface matching Takaro branding
- **🔍 Location-Based Search** - Find players by coordinates and radius
- **⏰ Time Range Filtering** - Search within specific date/time ranges
- **📍 Movement Tracking** - View complete player movement history
- **🎒 Inventory Changes** - Track all inventory modifications with timestamps
- **🔒 Secure Authentication** - Email/password login with session management
- **🚫 No CORS Issues** - Everything runs on your local server

## Configuration

- **Port:** 5555 (configured in `server.js`, line 7)
- **Game Server ID:** Pre-filled with Double Tap server UUID
- **Takaro API:** https://api.takaro.io

## File Structure

```
├── server.js              # Express server with API proxy and authentication
├── public/
│   ├── index.html         # Main search interface (dark theme)
│   ├── login.html         # Login page
│   └── app.js            # Client-side JavaScript with session handling
├── start-server.bat       # Windows batch file to start server
└── README.md             # This file
```

## API Endpoints

### Authentication
- `POST /api/login` - Authenticate with email/password
- `POST /api/logout` - End session

### Tracking (Requires Authentication)
- `GET /api/tracking/radius-players` - Search players by location
- `GET /api/tracking/player-movement-history` - Get movement data
- `GET /api/tracking/player-inventory-history` - Get inventory changes

### Other
- `GET /api/health` - Server health check
- `GET /api/gameservers` - List available game servers

## Auto-Start on Boot (Optional)

1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `start-server.bat` in the Startup folder
3. Server will start automatically when Windows boots

## Troubleshooting

**Port 5555 already in use:**
- Edit `server.js` line 7 and change the `PORT` constant
- Common safe ports: 5555, 5556, 8888, 9999
- Remember to update firewall rules if changed

**Can't access from other computers:**
- Check Windows Firewall settings
- Allow inbound connections on port 5555 (or your chosen port)
- Verify the server machine is reachable on the network

**Login fails:**
- Verify your Takaro account credentials at https://app.takaro.io
- Check server console for authentication error messages
- Ensure server can reach https://api.takaro.io

**Search returns no results:**
- Verify the game server ID is correct (in search form)
- Check date/time range includes player activity
- Ensure coordinates and radius cover the target area
- View browser console (F12) for any JavaScript errors

**Session expired:**
- Sessions are stored in server memory (cleared on restart)
- Simply login again at /login

## Development

### Session Storage
Sessions are stored in-memory using a JavaScript Map. For production, consider:
- Redis for distributed session storage
- Database persistence for long-lived sessions

### Security Notes
- Passwords are never stored - only sent to Takaro for authentication
- Bearer tokens are stored server-side only
- Session IDs are passed via headers (not cookies)
- CORS is enabled for local development

## Technologies Used

- **Backend:** Node.js, Express.js, Axios
- **Frontend:** Vanilla JavaScript, Fetch API
- **API:** Takaro REST API (Bearer token authentication)
- **Storage:** In-memory session management

## License

Private project for Double Tap server administration.

## Credits

Generated with Claude Code
https://claude.com/claude-code

Co-Authored-By: Claude <noreply@anthropic.com>

