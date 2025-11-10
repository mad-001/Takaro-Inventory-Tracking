# Takaro Authentication Fix - November 10, 2025

## Problem

The Takaro Inventory Tracker server was failing to authenticate with the Takaro API, resulting in 401 Unauthorized errors for all API requests after login.

## Root Cause

The server was using **Cookie-based authentication** which is incorrect:

```javascript
// WRONG METHOD (what we were doing)
headers: {
    'Cookie': `takaro-token=${takaroToken}`
}
```

However, Takaro's API requires **Authorization Bearer tokens**:

```javascript
// CORRECT METHOD
headers: {
    'Authorization': `Bearer ${takaroToken}`
}
```

## Discovery

The correct authentication method was discovered by examining the official Takaro client source code at:
`~/ai-module-writer/takaro/packages/lib-apiclient/src/lib/client.ts`

Line 66 of the client shows:
```typescript
this.axios.defaults.headers.common['Authorization'] = `Bearer ${loginRes.data.data.token}`;
```

## Solution

### 1. Token Extraction

The token is correctly extracted from the **response body**, not cookies:

```javascript
const loginResponse = await axios.post(`${TAKARO_API}/login`, {
    username: email,
    password: password
});

// Extract from response body
const takaroToken = loginResponse.data?.data?.token;
```

### 2. Token Usage

The token must be sent as an Authorization Bearer header in all subsequent API requests:

```javascript
// Login endpoint - test token
const meResponse = await axios.get(`${TAKARO_API}/me`, {
    headers: {
        'Authorization': `Bearer ${takaroToken}`
    }
});

// Game servers endpoint
const response = await axios.post(`${TAKARO_API}/gameserver/search`, {}, {
    headers: {
        'Authorization': `Bearer ${req.takaroToken}`,
        'Content-Type': 'application/json'
    }
});

// Tracking endpoints
const response = await axios.get(`${TAKARO_API}/tracking/radius-players`, {
    params: { gameserverId, x, y, z, radius, startDate, endDate },
    headers: {
        'Authorization': `Bearer ${req.takaroToken}`,
        'Accept': 'application/json'
    }
});
```

## Files Changed

- `server.js` - Updated all API calls from Cookie to Authorization Bearer headers
- `README.md` - Updated documentation to reflect Bearer authentication
- Removed references to manual API token configuration

## Changes Made

### Login Endpoint (/api/login)

**Before:**
```javascript
const meResponse = await axios.get(`${TAKARO_API}/me`, {
    headers: {
        'Cookie': `takaro-token=${takaroToken}`
    }
});
```

**After:**
```javascript
const meResponse = await axios.get(`${TAKARO_API}/me`, {
    headers: {
        'Authorization': `Bearer ${takaroToken}`
    }
});
```

### Game Servers Endpoint (/api/gameservers)

**Before:**
```javascript
headers: {
    'Cookie': `takaro-token=${req.takaroToken}`,
    'Content-Type': 'application/json'
}
```

**After:**
```javascript
headers: {
    'Authorization': `Bearer ${req.takaroToken}`,
    'Content-Type': 'application/json'
}
```

### All Tracking Endpoints

Same pattern - replaced `Cookie` with `Authorization: Bearer`.

## Testing

After the fix:
1. Server starts successfully on port 5555
2. Login with Takaro email/password succeeds
3. Token is extracted from response body
4. `/me` endpoint returns user data
5. Game servers can be fetched
6. Tracking API calls work correctly

## Token Format

Takaro tokens start with `ory_st_` indicating they use the Ory authentication service.

Example token: `ory_st_zqUQcPMRQ6Rl1GxKvn2nDEFghijKLMN...`

## Key Takeaways

1. **Always use Authorization Bearer headers** for Takaro API authentication
2. **Never use Cookie headers** - that's the old/wrong method
3. **Extract token from response body** (`loginResponse.data.data.token`)
4. **Token is in response body**, not in Set-Cookie headers
5. **Refer to official Takaro client code** when in doubt about API usage

## References

- Takaro API: https://api.takaro.io
- OpenAPI Spec: https://api.takaro.io/openapi.json
- Takaro Client Source: `takaro/packages/lib-apiclient/src/lib/client.ts` (line 66)

