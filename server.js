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
    process.exit(1);
}

const PORT = config.port;
const TAKARO_API = config.takaroApi;
// Note: takaroDomain is now provided by users during login, not from config

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
    const { email, password, domain } = req.body;

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
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        if (loginResp.status !== 200) {
            return res.status(500).json({ success: false, error: 'Login failed' });
        }

        const takaroToken = loginResp.data?.data?.token;
        if (!takaroToken) {
            return res.status(500).json({ success: false, error: 'No token' });
        }

        try {
            await axios.post(`${TAKARO_API}/selected-domain/${domain}`, {}, {
                headers: {
                    'Authorization': `Bearer ${takaroToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
        } catch (domainErr) {
            return res.status(500).json({ success: false, error: 'Domain selection failed. Please check your domain name.' });
        }

        const sessionId = Math.random().toString(36).substring(7);
        sessions.set(sessionId, {
            takaroToken: takaroToken,
            loginTime: Date.now()
        });

        res.json({ success: true, sessionId });

    } catch (error) {
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
        res.status(500).json({ error: 'Failed to fetch gameservers' });
    }
});

app.get('/api/players', requireAuth, async (req, res) => {
    const { search } = req.query;

    try {
        const requestBody = {
            filters: {},
            sortBy: 'name',
            sortDirection: 'asc',
            limit: search ? 100 : 1000
        };

        if (search && search.trim().length >= 2) {
            requestBody.search = {
                name: [search.trim()]
            };
        }

        const resp = await axios.post(`${TAKARO_API}/player/search`, requestBody, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const players = (resp.data?.data || []).map(player => ({
            playerId: player.id,
            playerName: player.name || 'Unknown',
            steamId: (player.epicOnlineServicesId || player.steamId || '').replace(/^0+/, '')
        }));

        res.json({ players });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch players' });
    }
});

app.post('/api/search-by-player', requireAuth, async (req, res) => {
    const { playerId, gameServerId, startDate, endDate } = req.body;

    try {
        const playerResp = await axios.get(`${TAKARO_API}/player/${playerId}`, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`
            },
            timeout: 5000
        });

        const playerName = playerResp.data?.data?.name || 'Unknown';
        const startISO = new Date(startDate).toISOString();
        const endISO = new Date(endDate).toISOString();

        // Use tracking API endpoint for inventory history
        const inventoryResp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
            playerId: playerId,
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const inventoryData = inventoryResp.data?.data || [];

        if (inventoryData.length === 0) {
            return res.json({
                player: { playerId, playerName },
                inventory: [],
                totalItems: 0
            });
        }

        // Get location history using tracking API endpoint
        const locationResp = await axios.post(`${TAKARO_API}/tracking/location`, {
            playerId: [playerId],
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const playerLocations = locationResp.data?.data || [];

        // Match inventory snapshots to location records by timestamp
        const snapshotsWithLocation = inventoryData.map(snapshot => {
            const snapTime = new Date(snapshot.createdAt).getTime();

            // Find the most recent location BEFORE or AT this inventory change
            let locationBefore = null;
            let mostRecentTime = -Infinity;

            for (const loc of playerLocations) {
                const locTime = new Date(loc.createdAt).getTime();

                if (locTime <= snapTime && locTime > mostRecentTime) {
                    mostRecentTime = locTime;
                    locationBefore = loc;
                }
            }

            return {
                ...snapshot,
                location: locationBefore
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

        const inventory = [];

        // For each item, calculate consecutive changes
        Object.keys(itemGroups).forEach(key => {
            const snapshots = itemGroups[key];

            if (snapshots.length < 2) return;

            // Calculate all consecutive deltas
            for (let i = 1; i < snapshots.length; i++) {
                const prev = snapshots[i - 1];
                const curr = snapshots[i];
                const change = curr.quantity - prev.quantity;

                if (change !== 0) {
                    inventory.push({
                        itemName: curr.itemName || curr.itemCode || 'Unknown',
                        itemCode: curr.itemCode,
                        quantity: change,
                        quality: curr.quality,
                        timestamp: curr.createdAt,
                        x: curr.location?.x,
                        y: curr.location?.y,
                        z: curr.location?.z
                    });
                }
            }
        });

        res.json({
            player: { playerId, playerName },
            inventory: inventory,
            totalItems: inventory.length
        });

    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch player inventory' });
    }
});

app.post('/api/search', requireAuth, async (req, res) => {
    const { centerX, centerZ, radius, gameServerId, startDate, endDate } = req.body;

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

        if (playersInRadius.length === 0) {
            return res.json({ players: [], inventory: [], totalRecords: 0, message: 'No players in area' });
        }

        const uniquePlayerIds = [...new Set(playersInRadius.map(p => p.playerId))];

        const limitedPlayerIds = uniquePlayerIds.slice(0, 5);

        const allInventory = [];
        const playerNames = {};

        for (const playerId of limitedPlayerIds) {
            try {
                if (!playerId) {
                    console.warn('Skipping null/undefined playerId');
                    playerNames[playerId] = 'Unknown';
                    continue;
                }

                const playerResp = await axios.get(`${TAKARO_API}/player/${playerId}`, {
                    headers: {
                        'Authorization': `Bearer ${req.takaroToken}`
                    },
                    timeout: 5000
                });

                const playerName = playerResp.data?.data?.name || 'Unknown';
                playerNames[playerId] = playerName;

                const records = await getInventoryChunked(
                    req.takaroToken,
                    playerId,
                    startDate,
                    endDate
                );

                const playerLocations = playersInRadius.filter(p => p.playerId === playerId);

                // Match inventory snapshots to location records by timestamp
                // Find the most recent location BEFORE the inventory change (where they were)
                const snapshotsWithLocation = records.map(snapshot => {
                    const snapTime = new Date(snapshot.createdAt).getTime();

                    // Find the most recent location BEFORE (or at) this inventory change
                    let locationBefore = null;
                    let mostRecentTime = -Infinity;

                    for (const loc of playerLocations) {
                        const locTime = new Date(loc.createdAt).getTime();

                        // Only consider locations BEFORE or AT the inventory change
                        if (locTime <= snapTime && locTime > mostRecentTime) {
                            mostRecentTime = locTime;
                            locationBefore = loc;
                        }
                    }

                    return {
                        ...snapshot,
                        location: locationBefore,
                        timeDiff: locationBefore ? (snapTime - mostRecentTime) : Infinity
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
                    });
                });

            } catch (playerErr) {
                console.error(`Failed to fetch player ${playerId}:`, playerErr.response?.status, playerErr.response?.data || playerErr.message);
                playerNames[playerId] = 'Unknown';
            }
        }

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
        res.status(500).json({ error: error.message });
    }
});

async function getInventoryChunked(token, playerId, startDate, endDate) {
    try {
        const startISO = new Date(startDate).toISOString();
        const endISO = new Date(endDate).toISOString();

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

        return records;

    } catch (err) {
        return [];
    }
}

app.post('/api/search-theft', requireAuth, async (req, res) => {
    const { itemName, x, z, gameServerId, startDate, endDate } = req.body;

    try {
        // Find the item by name
        const itemSearchResp = await axios.post(`${TAKARO_API}/items/search`, {
            filters: { gameserverId: [gameServerId] },
            search: { name: [itemName] }
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const items = itemSearchResp.data?.data || [];
        if (items.length === 0) {
            return res.json({
                success: false,
                message: `❌ Item "${itemName}" not found on this server.`
            });
        }

        const item = items[0];
        const startISO = new Date(startDate).toISOString();
        const endISO = new Date(endDate).toISOString();

        // Get all players who were at the location during the time period (10 block radius)
        const playersResp = await axios.post(`${TAKARO_API}/tracking/location/radius`, {
            gameserverId: gameServerId,
            x: x,
            y: 37,
            z: z,
            radius: 10,
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const playersAtLocation = playersResp.data?.data || [];
        if (playersAtLocation.length === 0) {
            return res.json({
                success: true,
                message: `No players found at X:${Math.round(x)} Z:${Math.round(z)} during this time.`
            });
        }

        // Get unique player IDs
        const uniquePlayerIds = [...new Set(playersAtLocation.map(p => p.playerId))];
        const results = [];

        // Check each player for inventory gains
        for (const playerId of uniquePlayerIds) {
            try {
                // Get player name
                const playerResp = await axios.get(`${TAKARO_API}/player/${playerId}`, {
                    headers: {
                        'Authorization': `Bearer ${req.takaroToken}`
                    },
                    timeout: 5000
                });
                const playerName = playerResp.data?.data?.name || 'Unknown';

                // Get player's times at the location
                const playerLocationTimes = playersAtLocation
                    .filter(p => p.playerId === playerId)
                    .map(p => new Date(p.createdAt).getTime())
                    .sort((a, b) => a - b);

                if (playerLocationTimes.length === 0) continue;

                const firstTimeAtLocation = new Date(playerLocationTimes[0]);
                const lastTimeAtLocation = new Date(playerLocationTimes[playerLocationTimes.length - 1]);

                // Get inventory BEFORE arriving at location (1 minute before)
                const beforeTime = new Date(firstTimeAtLocation.getTime() - 60000);
                const inventoryBeforeResp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
                    playerId: playerId,
                    startDate: beforeTime.toISOString(),
                    endDate: firstTimeAtLocation.toISOString()
                }, {
                    headers: {
                        'Authorization': `Bearer ${req.takaroToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                const inventoryBefore = inventoryBeforeResp.data?.data || [];
                let quantityBefore = 0;
                for (const record of inventoryBefore) {
                    if (record.itemId === item.id) {
                        quantityBefore = Math.max(quantityBefore, record.quantity);
                    }
                }

                // Get inventory AFTER leaving location (2 minutes after)
                const afterTime = new Date(lastTimeAtLocation.getTime() + 120000);
                const inventoryAfterResp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
                    playerId: playerId,
                    startDate: lastTimeAtLocation.toISOString(),
                    endDate: afterTime.toISOString()
                }, {
                    headers: {
                        'Authorization': `Bearer ${req.takaroToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                const inventoryAfter = inventoryAfterResp.data?.data || [];
                let quantityAfter = 0;
                let firstSeenAfter = null;
                for (const record of inventoryAfter) {
                    if (record.itemId === item.id) {
                        if (!firstSeenAfter || new Date(record.createdAt) < new Date(firstSeenAfter)) {
                            firstSeenAfter = record.createdAt;
                        }
                        quantityAfter = Math.max(quantityAfter, record.quantity);
                    }
                }

                // Check if player gained items
                const itemsGained = quantityAfter - quantityBefore;
                if (itemsGained > 0 && firstSeenAfter) {
                    const timeDiff = Math.round((new Date(firstSeenAfter) - lastTimeAtLocation) / 1000);

                    results.push({
                        message: `🚨 THEFT DETECTED! ${playerName} took ${itemsGained}x ${itemName} from location (${timeDiff}s after visiting at ${lastTimeAtLocation.toLocaleTimeString()})`,
                        playerName,
                        itemsGained,
                        timeDiff
                    });
                }

            } catch (playerErr) {
                console.error(`Failed to check player ${playerId}:`, playerErr.message);
            }
        }

        // Sort by items gained (descending)
        results.sort((a, b) => b.itemsGained - a.itemsGained);

        if (results.length > 0) {
            res.json({
                success: true,
                results: results
            });
        } else {
            res.json({
                success: true,
                message: `No thefts of "${itemName}" detected at X:${Math.round(x)} Z:${Math.round(z)} during the time period.`
            });
        }

    } catch (error) {
        console.error('Theft search error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to search for thefts'
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        sessions: sessions.size,
        uptime: process.uptime()
    });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT);
