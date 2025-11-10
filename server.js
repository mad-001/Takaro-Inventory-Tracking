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
    req.takaroToken = sessions.get(sessionId).takaroToken;
    req.sessionData = sessions.get(sessionId);
    next();
}

// Login endpoint - Extract token from response body and use as Bearer
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Login attempt for: ${email}`);

    try {
        // Step 1: Login to Takaro
        console.log(`[${timestamp}] Authenticating with Takaro...`);
        
        const loginResponse = await axios.post(`${TAKARO_API}/login`, {
            username: email,
            password: password
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000,
            validateStatus: (status) => status < 500
        });

        // Check if login failed
        if (loginResponse.status === 401) {
            const ts = new Date().toISOString();
            console.error(`[${ts}] Login failed: Invalid credentials`);
            
            return res.status(401).json({
                success: false,
                error: 'Authentication failed',
                message: 'Invalid email or password. Please check your credentials.'
            });
        }

        if (loginResponse.status !== 200) {
            const ts = new Date().toISOString();
            console.error(`[${ts}] Login failed with status: ${loginResponse.status}`);
            console.error(`[${ts}] Response:`, loginResponse.data);
            
            return res.status(500).json({
                success: false,
                error: 'Login failed',
                message: 'Unable to login to Takaro. Please try again.',
                details: loginResponse.data
            });
        }

        // Step 2: Extract token from response body
        const takaroToken = loginResponse.data?.data?.token;

        if (!takaroToken) {
            const ts = new Date().toISOString();
            console.error(`[${ts}] No token in response body`);
            console.error(`[${ts}] Response:`, loginResponse.data);
            
            return res.status(500).json({
                success: false,
                error: 'Authentication error',
                message: 'Login succeeded but no token received from Takaro.'
            });
        }

        const ts2 = new Date().toISOString();
        console.log(`[${ts2}] Successfully obtained Takaro token for: ${email}`);
        console.log(`[${ts2}] Token: ${takaroToken.substring(0, 10)}...`);

        // Step 3: Get user info with the token (using Authorization Bearer!)
        let userData = null;
        try {
            const meResponse = await axios.get(`${TAKARO_API}/me`, {
                headers: {
                    'Authorization': `Bearer ${takaroToken}`
                },
                timeout: 10000
            });
            
            userData = meResponse.data.data;
            console.log(`[${ts2}] User authenticated: ${userData?.user?.name || email}`);
            console.log(`[${ts2}] Available domains:`, userData?.domains?.map(d => d.name) || []);
        } catch (meError) {
            console.error(`[${ts2}] Failed to get user info:`, meError.message);
        }

        // Step 4: Create session
        const sessionId = Math.random().toString(36).substring(7);

        sessions.set(sessionId, {
            username: email,
            takaroToken: takaroToken,
            loginTime: Date.now(),
            userData: userData
        });

        const ts3 = new Date().toISOString();
        console.log(`[${ts3}] Session created for: ${email} (sessionId: ${sessionId})`);

        res.json({
            success: true,
            sessionId,
            username: email,
            message: 'Login successful',
            userData: userData
        });

    } catch (error) {
        const ts = new Date().toISOString();
        console.error(`[${ts}] Unexpected login error:`, error.message);
        
        if (error.response) {
            console.error(`[${ts}] Response status: ${error.response.status}`);
            console.error(`[${ts}] Response data:`, error.response.data);
        }

        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred during login. Please try again.',
            details: error.message
        });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
            const ts = new Date().toISOString();
            console.log(`[${ts}] User ${session.username} logged out`);
        }
        sessions.delete(sessionId);
    }
    res.json({ success: true });
});

// Get game servers
app.get('/api/gameservers', requireAuth, async (req, res) => {
    try {
        const response = await axios.post(`${TAKARO_API}/gameserver/search`, {}, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const servers = response.data.data || [];
        const ts = new Date().toISOString();
        console.log(`[${ts}] Fetched ${servers.length} game servers`);
        res.json({ servers: servers });
    } catch (error) {
        console.error('Failed to fetch game servers:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch game servers',
            details: error.response?.data || error.message
        });
    }
});

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeSessions: sessions.size
    });
});

// Proxy endpoint for radius players
app.get('/api/tracking/radius-players', requireAuth, async (req, res) => {
    try {
        const { gameserverId, x, y, z, radius, startDate, endDate } = req.query;

        const ts = new Date().toISOString();
        console.log(`[${ts}] Radius search: gameserver=${gameserverId}, center=(${x},${y},${z}), radius=${radius}`);

        const response = await axios.get(`${TAKARO_API}/tracking/radius-players`, {
            params: { gameserverId, x, y, z, radius, startDate, endDate },
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Accept': 'application/json'
            },
            timeout: 30000
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

        const ts = new Date().toISOString();
        console.log(`[${ts}] Movement history: players=${playerId}`);

        const params = { startDate, endDate, limit: limit || 1000 };

        if (Array.isArray(playerId)) {
            playerId.forEach(id => params.playerId = id);
        } else {
            params.playerId = playerId;
        }

        const response = await axios.get(`${TAKARO_API}/tracking/player-movement-history`, {
            params,
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Accept': 'application/json'
            },
            timeout: 30000
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

        const ts = new Date().toISOString();
        console.log(`[${ts}] Inventory history: player=${playerId}`);

        const response = await axios.get(`${TAKARO_API}/tracking/player-inventory-history`, {
            params: { playerId, startDate, endDate },
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Accept': 'application/json'
            },
            timeout: 30000
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

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
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
    console.log(`✓ Authentication: Authorization Bearer token`);
    console.log(`✓ Login: Email + Password -> Bearer Token`);
    console.log('='.repeat(60));
});


