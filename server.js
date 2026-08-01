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
            domain: domain,
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
                'x-takaro-domain': req.sessionData.domain,
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
                'x-takaro-domain': req.sessionData.domain,
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
                'Authorization': `Bearer ${req.takaroToken}`,
                'x-takaro-domain': req.sessionData.domain
            },
            timeout: 5000
        });

        const playerName = playerResp.data?.data?.name || 'Unknown';
        const startISO = new Date(startDate).toISOString();
        const endISO = new Date(endDate).toISOString();

        // Use tracking API endpoint for inventory history (gameServerId is required)
        const inventoryResp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
            playerId: playerId,
            gameServerId: gameServerId,
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'x-takaro-domain': req.sessionData.domain,
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
                'x-takaro-domain': req.sessionData.domain,
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

// Takaro's /tracking/location/radius does a 3D sphere test that includes Y:
//   sqrt((x-X)^2 + (y-Y)^2 + (z-Z)^2) <= radius
// We only care about horizontal distance, so query a Y-unbounded box via
// /tracking/location/box and apply the 2D distance filter ourselves.
const WORLD_Y_MIN = -1000;
const WORLD_Y_MAX = 1000;
const MAX_PLAYERS_PER_SEARCH = 25;
// An inventory change counts as happening "at" the searched spot if the player
// was pinged inside the circle within this long of the change. Takaro samples
// position every ~30-100s, so some slack is required or nothing ever matches.
// Lower = stricter (fewer false hits, may miss real ones); higher = looser.
const LOCATION_TOLERANCE_MS = (config.locationToleranceSeconds ?? 300) * 1000;

app.post('/api/search', requireAuth, async (req, res) => {
    const { centerX, centerZ, radius, gameServerId, startDate, endDate } = req.body;

    if (!gameServerId) {
        return res.status(400).json({ error: 'No game server selected' });
    }
    if (![centerX, centerZ, radius].every(Number.isFinite)) {
        return res.status(400).json({ error: 'X, Z and radius must all be numbers' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ error: 'Invalid start or end date' });
    }
    if (start >= end) {
        return res.status(400).json({ error: 'Start date must be before end date' });
    }
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const windowStartMs = start.getTime();

    try {
        const playersResp = await axios.post(`${TAKARO_API}/tracking/location/box`, {
            gameserverId: gameServerId,
            minX: centerX - radius,
            maxX: centerX + radius,
            minY: WORLD_Y_MIN,
            maxY: WORLD_Y_MAX,
            minZ: centerZ - radius,
            maxZ: centerZ + radius,
            startDate: startISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'x-takaro-domain': req.sessionData.domain,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Box query returns a square; narrow it to the circle the user asked for.
        const playersInRadius = (playersResp.data?.data || []).filter(loc => {
            const dx = loc.x - centerX;
            const dz = loc.z - centerZ;
            return Math.sqrt(dx * dx + dz * dz) <= radius;
        });

        if (playersInRadius.length === 0) {
            return res.json({ players: [], inventory: [], totalRecords: 0, message: 'No players in area' });
        }

        const uniquePlayerIds = [...new Set(playersInRadius.map(p => p.playerId))].filter(Boolean);

        const limitedPlayerIds = uniquePlayerIds.slice(0, MAX_PLAYERS_PER_SEARCH);
        const truncated = uniquePlayerIds.length - limitedPlayerIds.length;

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
                        'Authorization': `Bearer ${req.takaroToken}`,
                        'x-takaro-domain': req.sessionData.domain
                    },
                    timeout: 5000
                });

                const playerName = playerResp.data?.data?.name || 'Unknown';
                playerNames[playerId] = playerName;

                // Read back past the window so an item appearing for the first
                // time reads as a 0 -> N pickup instead of being skipped.
                const records = await getInventoryChunked(
                    req.takaroToken,
                    req.sessionData.domain,
                    playerId,
                    gameServerId,
                    new Date(windowStartMs - HISTORY_LOOKBACK_MS).toISOString(),
                    endISO
                );

                // Location pings that fall inside the search circle. These are the
                // only times we can prove the player was at the searched spot, so
                // they decide which inventory changes count as "here".
                const playerPings = playersInRadius
                    .filter(p => p.playerId === playerId)
                    .map(p => ({ ...p, t: new Date(p.createdAt).getTime() }))
                    .sort((a, b) => a.t - b.t);

                // Nearest in-circle ping to a given time, or null if the player
                // wasn't tracked at this location anywhere near then.
                const pingNear = (timestamp) => {
                    const t = new Date(timestamp).getTime();
                    let best = null;
                    let bestGap = Infinity;
                    for (const ping of playerPings) {
                        const gap = Math.abs(ping.t - t);
                        if (gap < bestGap) {
                            bestGap = gap;
                            best = ping;
                        }
                    }
                    return bestGap <= LOCATION_TOLERANCE_MS ? best : null;
                };

                // Deltas must be computed over the player's FULL snapshot history
                // (a change needs its preceding snapshot even if that happened
                // elsewhere); the location filter is applied afterwards.
                const snapshotsWithLocation = [...records].sort((a, b) =>
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

                    // Calculate all consecutive deltas. Snapshots before the window
                    // only seed the starting quantity; no prior snapshot means the
                    // player had none of this item, so its arrival is a real gain.
                    const deltas = [];
                    let prev = null;

                    for (const curr of snapshots) {
                        if (new Date(curr.createdAt).getTime() < windowStartMs) {
                            prev = curr;
                            continue;
                        }

                        const prevQty = prev ? prev.quantity : 0;
                        const change = curr.quantity - prevQty;
                        prev = curr;

                        if (change !== 0) {
                            deltas.push({
                                timestamp: curr.createdAt,
                                change: change,
                                prevQty: prevQty,
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

                    // Keep only the changes the player made while at this location
                    filtered.forEach(delta => {
                        const ping = pingNear(delta.timestamp);
                        if (!ping) return;

                        allInventory.push({
                            playerId: playerId,
                            playerName: playerName,
                            itemName: delta.snapshot.itemName || delta.snapshot.itemCode || 'Unknown',
                            itemCode: delta.snapshot.itemCode,
                            quantity: delta.change,
                            quality: delta.snapshot.quality,
                            timestamp: delta.timestamp,
                            x: ping.x,
                            y: ping.y,
                            z: ping.z
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
            totalRecords: allInventory.length,
            truncated: truncated > 0 ? truncated : undefined
        });

    } catch (error) {
        const detail = error.response?.data?.meta?.error?.message
            || error.response?.data?.message
            || error.message;
        res.status(500).json({ error: `Location search failed: ${detail}` });
    }
});

// NOTE: /tracking/inventory/player REQUIRES gameServerId (400s without it).
// /tracking/location REJECTS gameServerId ("property should not exist").
// Both verified against the live api.takaro.io - the takaro-github checkout is stale.
async function getInventoryChunked(token, domain, playerId, gameServerId, startDate, endDate) {
    const startISO = new Date(startDate).toISOString();
    const endISO = new Date(endDate).toISOString();

    const resp = await axios.post(`${TAKARO_API}/tracking/inventory/player`, {
        playerId: playerId,
        gameServerId: gameServerId,
        startDate: startISO,
        endDate: endISO
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'x-takaro-domain': domain,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    return resp.data?.data || [];
}

// Takaro's item search is a substring match, so a short query like "gyro"
// returns dozens of hits (building shapes, vehicle parts, the vehicle itself).
// Rank them so an exact name/code wins outright instead of taking hits[0].
function scoreItemMatch(item, query) {
    const q = query.trim().toLowerCase();
    const name = (item.name || '').toLowerCase();
    const code = (item.code || '').toLowerCase();

    if (name === q) return 100;
    if (code === q) return 90;
    if (name.startsWith(q)) return 60;
    if (name.includes(q)) return 30;
    return 10;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// How many ranked candidates to probe for activity when there's no exact match.
const ITEM_PROBE_LIMIT = 12;
// Theft detection has no radius field in the UI; this is how close to the
// searched coordinates a pickup must happen to count.
const THEFT_RADIUS = config.theftRadius ?? 50;
// Takaro only stores a row while an item is IN the inventory - a loss is an
// absence, never a quantity of 0. So an item appearing for the first time is a
// real pickup (0 -> N). To tell "brand new" from "had it all along" we read
// this far back before the window and seed each item's starting quantity.
const HISTORY_LOOKBACK_MS = (config.historyLookbackDays ?? 7) * 24 * 60 * 60 * 1000;

app.post('/api/search-theft', requireAuth, async (req, res) => {
    const { itemName, x, z, gameServerId, startDate, endDate } = req.body;

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start) || isNaN(end)) {
            return res.json({ success: false, message: 'Invalid start or end date.' });
        }
        if (start >= end) {
            return res.json({ success: false, message: 'Start date must be before end date.' });
        }
        const startISO = start.toISOString();
        const endISO = end.toISOString();

        const itemHeaders = {
            'Authorization': `Bearer ${req.takaroToken}`,
            'x-takaro-domain': req.sessionData.domain,
            'Content-Type': 'application/json'
        };

        // Find the item by name
        const itemSearchResp = await axios.post(`${TAKARO_API}/items/search`, {
            filters: { gameserverId: [gameServerId] },
            search: { name: [itemName] }
        }, {
            headers: itemHeaders,
            timeout: 10000
        });

        const items = itemSearchResp.data?.data || [];
        if (items.length === 0) {
            return res.json({
                success: false,
                message: `❌ Item "${escapeHtml(itemName)}" not found on this server.`
            });
        }

        const ranked = items
            .map(i => ({ item: i, score: scoreItemMatch(i, itemName) }))
            .sort((a, b) => b.score - a.score);

        let item = ranked[0].score >= 90 ? ranked[0].item : null;

        // No exact hit: find which of the top candidates actually saw activity
        // in this window, rather than guessing and reporting a false "nobody had it".
        if (!item) {
            const probed = await Promise.all(
                ranked.slice(0, ITEM_PROBE_LIMIT).map(async ({ item: candidate }) => {
                    try {
                        const r = await axios.post(`${TAKARO_API}/tracking/inventory/item`, {
                            itemId: candidate.id,
                            startDate: startISO,
                            endDate: endISO
                        }, { headers: itemHeaders, timeout: 30000 });
                        return { item: candidate, rows: (r.data?.data || []).length };
                    } catch (probeErr) {
                        return { item: candidate, rows: 0 };
                    }
                })
            );

            const active = probed.filter(p => p.rows > 0).sort((a, b) => b.rows - a.rows);

            if (active.length === 0) {
                return res.json({
                    success: true,
                    message: `"${escapeHtml(itemName)}" matched ${items.length} item(s) on this server, `
                        + 'but none of them had any inventory activity during this time period.'
                });
            }

            if (active.length > 1) {
                const list = active
                    .map(a => `&bull; <strong>${escapeHtml(a.item.name)}</strong> &mdash; ${a.rows} records`)
                    .join('<br>');
                return res.json({
                    success: true,
                    message: `"${escapeHtml(itemName)}" matched ${items.length} items on this server. `
                        + `${active.length} had activity in this window &mdash; search again using the exact name:<br><br>${list}`
                });
            }

            item = active[0].item;
        }

        // Step 1: Everyone who held the item, read back past the window start so a
        // first appearance inside the window is recognisable as a 0 -> N pickup.
        const startMs = start.getTime();
        const lookbackISO = new Date(startMs - HISTORY_LOOKBACK_MS).toISOString();

        const playersWithItemResp = await axios.post(`${TAKARO_API}/tracking/inventory/item`, {
            itemId: item.id,
            startDate: lookbackISO,
            endDate: endISO
        }, {
            headers: {
                'Authorization': `Bearer ${req.takaroToken}`,
                'x-takaro-domain': req.sessionData.domain,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const itemHistory = playersWithItemResp.data?.data || [];

        if (itemHistory.filter(r => new Date(r.createdAt).getTime() >= startMs).length === 0) {
            return res.json({
                success: true,
                message: `No players had "${escapeHtml(item.name)}" during this time period.`
            });
        }

        // Who was physically near the searched spot, and when. Use the Y-unbounded
        // box endpoint rather than per-player /tracking/location, which caps at
        // 1000 rows and silently drops older pings.
        const boxResp = await axios.post(`${TAKARO_API}/tracking/location/box`, {
            gameserverId: gameServerId,
            minX: x - THEFT_RADIUS, maxX: x + THEFT_RADIUS,
            minY: WORLD_Y_MIN, maxY: WORLD_Y_MAX,
            minZ: z - THEFT_RADIUS, maxZ: z + THEFT_RADIUS,
            startDate: startISO,
            endDate: endISO
        }, { headers: itemHeaders, timeout: 60000 });

        const pingsByPlayer = {};
        (boxResp.data?.data || []).forEach(loc => {
            if (Math.hypot(loc.x - x, loc.z - z) > THEFT_RADIUS) return;
            (pingsByPlayer[loc.playerId] ||= []).push({ ...loc, t: new Date(loc.createdAt).getTime() });
        });

        // Group the item's quantity history per player and turn it into gains.
        // A thief GAINS the item; simply owning one proves nothing.
        const historyByPlayer = {};
        itemHistory.forEach(rec => {
            (historyByPlayer[rec.playerId] ||= []).push(rec);
        });

        const gains = [];
        Object.entries(historyByPlayer).forEach(([playerId, records]) => {
            const pings = pingsByPlayer[playerId];
            if (!pings || pings.length === 0) return; // never at this location

            records.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            // Records before the window only exist to establish the starting
            // quantity. No prior record at all means they started with none.
            let prev = null;

            for (const rec of records) {
                const t = new Date(rec.createdAt).getTime();
                if (t < startMs) { prev = rec; continue; }

                const fromQty = prev ? prev.quantity : 0;
                const delta = rec.quantity - fromQty;
                prev = rec;

                if (delta <= 0) continue;

                // Was the gain made while standing at the searched spot?
                let nearest = null;
                let bestGap = Infinity;
                for (const ping of pings) {
                    const gap = Math.abs(ping.t - t);
                    if (gap < bestGap) { bestGap = gap; nearest = ping; }
                }
                if (bestGap > LOCATION_TOLERANCE_MS) continue;

                gains.push({
                    playerId,
                    gained: delta,
                    from: fromQty,
                    to: rec.quantity,
                    location: nearest,
                    timestamp: rec.createdAt
                });
            }
        });

        if (gains.length === 0) {
            const owners = Object.keys(historyByPlayer).length;
            const present = Object.keys(historyByPlayer).filter(id => pingsByPlayer[id]).length;
            return res.json({
                success: true,
                message: `No one picked up "${escapeHtml(item.name)}" within ${THEFT_RADIUS} blocks of `
                    + `X:${Math.round(x)} Z:${Math.round(z)} during this time period.<br><br>`
                    + `${owners} player(s) had one at some point; ${present} of them were at this location, `
                    + 'but none of their quantities went up while they were here.'
            });
        }

        // Biggest haul first
        gains.sort((a, b) => b.gained - a.gained);

        const names = {};
        await Promise.all([...new Set(gains.map(g => g.playerId))].map(async (id) => {
            try {
                const r = await axios.get(`${TAKARO_API}/player/${id}`, { headers: itemHeaders, timeout: 10000 });
                names[id] = r.data?.data?.name || 'Unknown';
            } catch (nameErr) {
                names[id] = 'Unknown';
            }
        }));

        res.json({
            success: true,
            results: gains.map(g => ({
                message: `<strong>${escapeHtml(names[g.playerId])}</strong> picked up `
                    + `<strong>+${g.gained}x ${escapeHtml(item.name)}</strong> (${g.from} &rarr; ${g.to}) `
                    + `at X:${Math.round(g.location.x)} Y:${Math.round(g.location.y)} Z:${Math.round(g.location.z)} `
                    + `on ${new Date(g.timestamp).toLocaleString('en-US')}`,
                playerName: names[g.playerId],
                itemsChanged: g.gained,
                timestamp: new Date(g.timestamp)
            }))
        });

    } catch (error) {
        console.error('Theft search error:', error.message);
        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            url: error.config?.url
        });
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to search for thefts',
            details: error.response?.data
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
