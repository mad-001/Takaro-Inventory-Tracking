const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5555;

// Takaro API configuration
const TAKARO_API = 'https://api.takaro.io';

// Middleware
app.use(cors());
app.use(express.json());

// Session storage (in-memory for simplicity)
const sessions = new Map();

// Auth middleware
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Please login' });
    }
    req.userToken = sessions.get(sessionId).token;
    next();
}

// Login endpoint - simple acceptance without validation
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    // Just accept the credentials and create a session
    // In a real app you'd validate these, but for now just store them
    const sessionId = Math.random().toString(36).substring(7);

    sessions.set(sessionId, {
        username: email,
        token: password, // Store password as token (will be used for API calls)
        loginTime: Date.now()
    });

    console.log(`[${new Date().toISOString()}] User ${email} logged in`);
    res.json({ success: true, sessionId, username: email });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.json({ success: true });
});

// Get game servers
app.get('/api/gameservers', requireAuth, async (req, res) => {
    try {
        const response = await axios.post(`${TAKARO_API}/gameserver/search`, {}, {
            headers: {
                'Authorization': `Bearer ${req.userToken}`,
                'Content-Type': 'application/json'
            }
        });

        const servers = response.data.data || [];
        res.json({ servers: servers });
    } catch (error) {
        console.error('Failed to fetch game servers:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch game servers' });
    }
});

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint for radius players
app.get('/api/tracking/radius-players', requireAuth, async (req, res) => {
    try {
        const { gameserverId, x, y, z, radius, startDate, endDate } = req.query;

        console.log(`[${new Date().toISOString()}] Radius search: gameserver=${gameserverId}, center=(${x},${y},${z}), radius=${radius}`);

        const response = await axios.get(`${TAKARO_API}/tracking/radius-players`, {
            params: { gameserverId, x, y, z, radius, startDate, endDate },
            headers: {
                'Authorization': `Bearer ${req.userToken}`,
                'Accept': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching radius players:', error.message);
        res.status(error.response?.status || 500).json({
            error: true,
            message: error.message,
            details: error.response?.data
        });
    }
});

// Proxy endpoint for player movement history
app.get('/api/tracking/player-movement-history', requireAuth, async (req, res) => {
    try {
        const { playerId, startDate, endDate, limit } = req.query;

        console.log(`[${new Date().toISOString()}] Movement history: players=${playerId}`);

        const params = { startDate, endDate, limit: limit || 1000 };

        // Handle multiple player IDs
        if (Array.isArray(playerId)) {
            playerId.forEach(id => params.playerId = id);
        } else {
            params.playerId = playerId;
        }

        const response = await axios.get(`${TAKARO_API}/tracking/player-movement-history`, {
            params,
            headers: {
                'Authorization': `Bearer ${req.userToken}`,
                'Accept': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching movement history:', error.message);
        res.status(error.response?.status || 500).json({
            error: true,
            message: error.message,
            details: error.response?.data
        });
    }
});

// Proxy endpoint for player inventory history
app.get('/api/tracking/player-inventory-history', requireAuth, async (req, res) => {
    try {
        const { playerId, startDate, endDate } = req.query;

        console.log(`[${new Date().toISOString()}] Inventory history: player=${playerId}`);

        const response = await axios.get(`${TAKARO_API}/tracking/player-inventory-history`, {
            params: { playerId, startDate, endDate },
            headers: {
                'Authorization': `Bearer ${req.userToken}`,
                'Accept': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching inventory history:', error.message);
        res.status(error.response?.status || 500).json({
            error: true,
            message: error.message,
            details: error.response?.data
        });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 Takaro Inventory Tracker Server');
    console.log('='.repeat(60));
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Access locally: http://localhost:${PORT}`);
    console.log(`✓ Access from network: http://SERVER:${PORT}`);
    console.log(`✓ API endpoint: ${TAKARO_API}`);
    console.log(`✓ Authentication: API token required`);
    console.log(`✓ Login: Use any email, enter API token as password`);
    console.log('='.repeat(60));
});

