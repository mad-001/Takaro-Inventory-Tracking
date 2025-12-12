const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();

// Load configuration
let config;
try {
    const configPath = path.join(__dirname, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('ERROR: config.json not found or invalid!');
    console.error('Please copy config.example.json to config.json and update with your settings.');
    process.exit(1);
}

const PORT = config.port;
const TAKARO_API = config.takaroApi;
const TAKARO_DOMAIN = config.takaroDomain;

// File logging
const logFile = path.join(__dirname, 'debug.log');
function log(message) {
    const msg = `${message}\n`;
    console.log(message);
    fs.appendFileSync(logFile, msg);
}

app.use(cors());
app.use(express.json());

const sessions = new Map();

function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.takaroToken = sessions.get(sessionId).takaroToken;
    req.sessionData = sessions.get(sessionId);
    next();
}

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const ts = new Date().toISOString();
    console.log(`[${ts}] Login: ${email}`);

    try {
        const loginResp = await axios.post(`${TAKARO_API}/login`, {
            username: email,
            password: password
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
            validateStatus: (status) => status < 500
        });

        if (loginResp.status === 401) {
            console.error(`[${ts}] Invalid credentials`);
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        if (loginResp.status !== 200) {
            console.error(`[${ts}] Login failed: ${loginResp.status}`);
            return res.status(500).json({ success: false, error: 'Login failed' });
        }

        const takaroToken = loginResp.data?.data?.token;
        if (!takaroToken) {
            console.error(`[${ts}] No token received`);
            return res.status(500).json({ success: false, error: 'No token' });
        }

        console.log(`[${ts}] Token OK`);

        try {
            await axios.post(`${TAKARO_API}/selected-domain/${TAKARO_DOMAIN}`, {}, {
                headers: {
                    'Authorization': `Bearer ${takaroToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            console.log(`[${ts}] Domain set: ${TAKARO_DOMAIN}`);
        } catch (domainErr) {
            console.error(`[${ts}] Domain selection error:`, domainErr.response?.status, domainErr.response?.data);
            return res.status(500).json({ success: false, error: 'Domain selection failed' });
        }

        const sessionId = Math.random().toString(36).substring(7);
        sessions.set(sessionId, {
            username: email,
            takaroToken: takaroToken,
            loginTime: Date.now()
        });

        console.log(`[${ts}] Session: ${sessionId}`);
        res.json({ success: true, sessionId, username: email });

    } catch (error) {
        console.error(`[${ts}] Login error:`, error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) sessions.delete(sessionId);
    res.json({ success: true });
});

app.get('/api/gameservers', requireAuth, async (req, res) => {
    try {
        const resp = await axios.post(`${TAKARO_API}/gameserver/search`, {
            filters: {},
            sortBy: 'name',
            sortDirection: 'asc'
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const gameservers = resp.data?.data || [];
        res.json({ gameservers });
    } catch (error) {
        console.error('Gameserver search error:', error.message);
        res.status(500).json({ error: 'Failed to fetch gameservers' });
    }
});

app.post('/api/search', requireAuth, async (req, res) => {
    const { centerX, centerZ, radius, gameServerId, startDate, endDate } = req.body;
    const ts = new Date().toISOString();

    log(`[${ts}] Search: X=${centerX}, Z=${centerZ}, R=${radius}, GS=${gameServerId}`);
    log(`[${ts}] Time range: ${startDate} to ${endDate}`);

    try {
        const playersResp = await axios.post(`${TAKARO_API}/tracking/location/radius`, {
            gameserverId: gameServerId,
            x: centerX,
            y: 37,
            z: centerZ,
            radius: radius,
            startDate: startDate,
            endDate: endDate
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const playersInRadius = playersResp.data?.data || [];
        log(`[${ts}] Found ${playersInRadius.length} location records`);

        if (playersInRadius.length === 0) {
            return res.json({ players: [], inventory: [], totalRecords: 0, message: 'No players in area' });
        }

        const uniquePlayerIds = [...new Set(playersInRadius.map(p => p.playerId))];
        log(`[${ts}] Unique players: ${uniquePlayerIds.length}`);

        const limitedPlayerIds = uniquePlayerIds.slice(0, 5);
        log(`[${ts}] Processing ${limitedPlayerIds.length} players...`);

        const allInventory = [];
        const playerNames = {};

        for (const playerId of limitedPlayerIds) {
            try {
                const playerResp = await axios.get(`${TAKARO_API}/player/${playerId}`, {
                    headers: {
                        'Authorization': `Bearer ${req.takaroToken}`
                    },
                    timeout: 5000
                });

                const playerName = playerResp.data?.data?.name || 'Unknown';
                playerNames[playerId] = playerName;

                log(`[${ts}] Getting inventory for ${playerName}...`);

                const records = await getInventoryChunked(
                    req.takaroToken,
                    playerId,
                    startDate,
                    endDate,
                    ts
                );

                const playerLocations = playersInRadius.filter(p => p.playerId === playerId);

                // Match inventory snapshots to location records by timestamp
                const snapshotsWithLocation = records.map(snapshot => {
                    const snapTime = new Date(snapshot.createdAt).getTime();

                    // Find location record closest in time to this snapshot
                    let closestLoc = null;
                    let smallestDiff = Infinity;

                    for (const loc of playerLocations) {
                        const locTime = new Date(loc.createdAt).getTime();
                        const diff = Math.abs(snapTime - locTime);
                        if (diff < smallestDiff) {
                            smallestDiff = diff;
                            closestLoc = loc;
                        }
                    }

                    return {
                        ...snapshot,
                        location: closestLoc,
                        timeDiff: smallestDiff
                    };
                });

                // Sort by time
                snapshotsWithLocation.sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );

                // Group by item
                const itemGroups = {};
                snapshotsWithLocation.forEach(snap => {
                    const key = `${snap.itemId}_${snap.quality || 'none'}`;
                    if (!itemGroups[key]) {
                        itemGroups[key] = [];
                    }
                    itemGroups[key].push(snap);
                });

                let changesAdded = 0;

                // For each item, calculate consecutive changes and filter oscillations
                Object.keys(itemGroups).forEach(key => {
                    const snapshots = itemGroups[key];

                    if (snapshots.length < 2) return;

                    // Calculate all consecutive deltas
                    const deltas = [];
                    for (let i = 1; i < snapshots.length; i++) {
                        const prev = snapshots[i - 1];
                        const curr = snapshots[i];
                        const change = curr.quantity - prev.quantity;

                        if (change !== 0) {
                            deltas.push({
                                timestamp: curr.createdAt,
                                change: change,
                                prevQty: prev.quantity,
                                currQty: curr.quantity,
                                snapshot: curr
                            });
                        }
                    }

                    // Filter oscillations: if change is immediately reversed, skip both
                    const filtered = [];
                    for (let i = 0; i < deltas.length; i++) {
                        const curr = deltas[i];
                        const next = deltas[i + 1];

                        // Check if next change exactly reverses this one
                        if (next && curr.change === -next.change) {
                            // Skip both (oscillation detected)
                            i++; // Skip next iteration too
                        } else {
                            filtered.push(curr);
                        }
                    }

                    // Add filtered changes to results
                    filtered.forEach(delta => {
                        allInventory.push({
                            playerId: playerId,
                            playerName: playerName,
                            itemName: delta.snapshot.itemName || delta.snapshot.itemCode || 'Unknown',
                            itemCode: delta.snapshot.itemCode,
                            quantity: delta.change,
                            quality: delta.snapshot.quality,
                            timestamp: delta.timestamp,
                            x: delta.snapshot.location?.x,
                            y: delta.snapshot.location?.y,
                            z: delta.snapshot.location?.z
                        });
                        changesAdded++;

                        log(`[${ts}] ${delta.snapshot.itemName || delta.snapshot.itemCode}: ${delta.prevQty} -> ${delta.currQty} (${delta.change > 0 ? '+' : ''}${delta.change})`);
                    });
                });

                log(`[${ts}] ${playerName}: ${changesAdded} inventory changes found`);

            } catch (playerErr) {
                console.error(`[${ts}] Error for ${playerId}:`, playerErr.message);
                playerNames[playerId] = 'Unknown';
            }
        }

        log(`[${ts}] Total: ${allInventory.length} inventory changes`);

        res.json({
            players: limitedPlayerIds.map(id => ({
                playerId: id,
                playerName: playerNames[id] || 'Unknown',
                locationCount: playersInRadius.filter(p => p.playerId === id).length
            })),
            inventory: allInventory,
            totalRecords: allInventory.length
        });

    } catch (error) {
        log(`[${ts}] Search error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

async function getInventoryChunked(token, playerId, startDate, endDate, logTs) {
    try {
        const startISO = new Date(startDate).toISOString();
        const endISO = new Date(endDate).toISOString();

        log(`[${logTs}] === API REQUEST ===`);
        log(`[${logTs}] PlayerId: ${playerId}`);
        log(`[${logTs}] StartDate: ${startISO}`);
        log(`[${logTs}] EndDate: ${endISO}`);

        const resp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
            playerId: playerId,
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const records = resp.data?.data || [];
        log(`[${logTs}] API returned ${records.length} inventory records`);

        // CLIENT-SIDE FILTER
        const reqStart = new Date(startISO).getTime();
        const reqEnd = new Date(endISO).getTime();

        const filtered = records.filter(r => {
            const t = new Date(r.createdAt).getTime();
            return t >= reqStart && t <= reqEnd;
        });

        log(`[${logTs}] After date filter: ${filtered.length} records (removed ${records.length - filtered.length})`);

        if (filtered.length > 0) {
            const timestamps = filtered.map(r => new Date(r.createdAt).getTime()).sort((a, b) => a - b);
            const earliest = new Date(timestamps[0]);
            const latest = new Date(timestamps[timestamps.length - 1]);

            log(`[${logTs}] Filtered range: ${earliest.toISOString()} to ${latest.toISOString()}`);
        }

        return filtered;

    } catch (err) {
        log(`[${logTs}] Inventory fetch error: ${err.message}`);
        return [];
    }
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        sessions: sessions.size,
        uptime: process.uptime()
    });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    log(`Takaro Inventory Tracker listening on port ${PORT}`);
});
