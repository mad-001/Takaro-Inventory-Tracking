// Takaro Inventory Tracker - Client Application
// Uses local server API (no CORS issues!)

const API_BASE = '/api';
let gameserverId = '';

// Check authentication on load
window.addEventListener('DOMContentLoaded', () => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        window.location.href = '/login.html';
        return;
    }

    const username = localStorage.getItem('username');
    if (username) {
        document.getElementById('userInfo').textContent = `Logged in as: ${username}`;
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    document.getElementById('endDate').value = formatDateTimeLocal(now);
    document.getElementById('startDate').value = formatDateTimeLocal(yesterday);

    // Load saved server ID
    const savedServerId = localStorage.getItem('gameserverId');
    if (savedServerId) document.getElementById('gameserverId').value = savedServerId;
});

// Logout function
function logout() {
    const sessionId = localStorage.getItem('sessionId');
    fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-id': sessionId }
    }).finally(() => {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('username');
        window.location.href = '/login.html';
    });
}

function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function showLoading() {
    document.getElementById('results').innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>Searching for players and inventory changes...</p>
        </div>
    `;
}

function showError(message) {
    document.getElementById('results').innerHTML = `
        <div class="error">
            <strong>Error:</strong> ${message}
        </div>
    `;
}

function showInfo(message) {
    document.getElementById('results').innerHTML = `
        <div class="info">
            ${message}
        </div>
    `;
}

async function searchPlayers() {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        window.location.href = '/login.html';
        return;
    }

    gameserverId = document.getElementById('gameserverId').value.trim();
    const centerX = parseFloat(document.getElementById('centerX').value);
    const centerZ = parseFloat(document.getElementById('centerZ').value);
    const radius = parseFloat(document.getElementById('radius').value);
    const startDateStr = document.getElementById('startDate').value;
    const endDateStr = document.getElementById('endDate').value;

    // Validate
    if (!gameserverId) {
        showError('Please enter a game server ID');
        return;
    }

    if (isNaN(centerX) || isNaN(centerZ) || isNaN(radius)) {
        showError('Please enter valid coordinates and radius');
        return;
    }

    if (!startDateStr || !endDateStr) {
        showError('Please select both start and end dates');
        return;
    }

    const startDate = new Date(startDateStr).toISOString();
    const endDate = new Date(endDateStr).toISOString();

    // Save server ID
    localStorage.setItem('gameserverId', gameserverId);

    showLoading();

    try {
        // Step 1: Get players in radius
        console.log('Fetching players in radius...');
        const radiusUrl = `${API_BASE}/tracking/radius-players?gameserverId=${gameserverId}&x=${centerX}&y=0&z=${centerZ}&radius=${radius}&startDate=${startDate}&endDate=${endDate}`;
        const radiusResponse = await fetch(radiusUrl, {
            headers: { 'x-session-id': sessionId }
        });

        if (radiusResponse.status === 401) {
            localStorage.removeItem('sessionId');
            window.location.href = '/login.html';
            return;
        }

        if (!radiusResponse.ok) {
            throw new Error(`Failed to fetch players: ${radiusResponse.status} ${radiusResponse.statusText}`);
        }

        const radiusData = await radiusResponse.json();

        if (!radiusData.data || radiusData.data.length === 0) {
            showInfo('No players found in the specified area and time range.');
            return;
        }

        const players = radiusData.data;
        const playerIds = players.map(p => p.playerId);

        console.log(`Found ${players.length} player(s):`, playerIds);

        // Step 2: Get movement history
        console.log('Fetching movement history...');
        const movementUrl = `${API_BASE}/tracking/player-movement-history?${playerIds.map(id => `playerId=${id}`).join('&')}&startDate=${startDate}&endDate=${endDate}&limit=1000`;
        const movementResponse = await fetch(movementUrl, {
            headers: { 'x-session-id': sessionId }
        });
        const movements = await movementResponse.json();

        // Step 3: Get inventory history
        console.log('Fetching inventory history...');
        const inventories = {};

        for (const playerId of playerIds) {
            try {
                const invUrl = `${API_BASE}/tracking/player-inventory-history?playerId=${playerId}&startDate=${startDate}&endDate=${endDate}`;
                const invResponse = await fetch(invUrl, {
                    headers: { 'x-session-id': sessionId }
                });
                inventories[playerId] = await invResponse.json();
            } catch (error) {
                console.warn(`Failed to fetch inventory for player ${playerId}:`, error);
                inventories[playerId] = { data: [] };
            }
        }

        // Step 4: Render results
        renderResults(players, movements, inventories);

    } catch (error) {
        console.error('Search error:', error);
        showError(error.message || 'An error occurred while searching. Please check the console for details.');
    }
}

function renderResults(players, movements, inventories) {
    const resultsDiv = document.getElementById('results');

    let html = `
        <div class="results-header">
            <h2>Found ${players.length} player(s)</h2>
            <span>${new Date().toLocaleString()}</span>
        </div>
    `;

    // Group data by player
    const playerData = {};

    players.forEach(player => {
        playerData[player.playerId] = {
            player: player,
            movements: [],
            inventory: []
        };
    });

    // Add movement data
    if (movements && movements.data) {
        movements.data.forEach(movement => {
            if (playerData[movement.playerId]) {
                playerData[movement.playerId].movements.push(movement);
            }
        });
    }

    // Add inventory data
    Object.keys(inventories).forEach(playerId => {
        if (playerData[playerId] && inventories[playerId].data) {
            playerData[playerId].inventory = inventories[playerId].data;
        }
    });

    // Render each player card
    Object.values(playerData).forEach(data => {
        html += renderPlayerCard(data);
    });

    resultsDiv.innerHTML = html;
}

function renderPlayerCard(data) {
    const player = data.player;
    const movements = data.movements;
    const inventory = data.inventory;

    let html = `
        <div class="player-card">
            <div class="player-header">
                <div>
                    <div class="player-name">${escapeHtml(player.playerName || 'Unknown Player')}</div>
                    <div class="player-id">Player ID: ${player.playerId}</div>
                </div>
            </div>
    `;

    // Render movements
    if (movements && movements.length > 0) {
        html += `
            <div class="movement-section">
                <div class="section-title">📍 Movement History (${movements.length} locations)</div>
                <div class="movement-list">
        `;

        const sortedMovements = [...movements].sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        sortedMovements.forEach(movement => {
            html += `
                <div class="movement-item">
                    <div class="coordinates">
                        X: ${movement.x.toFixed(2)},
                        Y: ${movement.y.toFixed(2)},
                        Z: ${movement.z.toFixed(2)}
                    </div>
                    <div class="timestamp">${formatTimestamp(movement.timestamp)}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    // Render inventory changes
    if (inventory && inventory.length > 0) {
        html += `
            <div class="inventory-section">
                <div class="section-title">🎒 Inventory Changes (${inventory.length} changes)</div>
                <div class="inventory-changes">
        `;

        const sortedInventory = [...inventory].sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        sortedInventory.forEach(change => {
            const quantityChange = change.newQuantity - (change.oldQuantity || 0);
            const isPositive = quantityChange > 0;
            const changeClass = isPositive ? 'positive' : 'negative';
            const changeSymbol = isPositive ? '+' : '';

            html += `
                <div class="inventory-item">
                    <div class="item-header">
                        <span class="item-name">${escapeHtml(change.itemName || change.itemId || 'Unknown Item')}</span>
                        <span class="item-change ${changeClass}">
                            ${changeSymbol}${quantityChange}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.9em; color: #666;">
                        <span>Old: ${change.oldQuantity || 0} → New: ${change.newQuantity}</span>
                        <span>${formatTimestamp(change.timestamp)}</span>
                    </div>
                    ${change.quality ? `<div style="margin-top: 5px; font-size: 0.85em; color: #666;">Quality: ${change.quality}</div>` : ''}
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="inventory-section">
                <div class="info">No inventory changes recorded for this player in the specified time range.</div>
            </div>
        `;
    }

    html += `</div>`;

    return html;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
