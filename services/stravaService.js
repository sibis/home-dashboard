const axios = require('axios');
const fs = require('fs');
const { BaseService } = require('../lib/BaseService');
const { AUTH_PATH } = require('../lib/paths');

/**
 * Strava Service - OPTIONAL
 * Provides current week running distance and last run stats
 */
class StravaService extends BaseService {
  constructor(cacheTTLMinutes = 30) {
    super({
      name: 'Strava',
      cacheKey: 'strava',
      cacheTTL: cacheTTLMinutes * 60 * 1000,
      retryAttempts: 2,
      retryCooldown: 1000,
    });
  }

  isEnabled() {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    const auth = this.loadTokens();
    const hasTokens = auth.strava?.tokens != null;
    return !!(clientId && clientSecret && hasTokens);
  }

  loadTokens() {
    try {
      if (fs.existsSync(AUTH_PATH)) {
        return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
      }
    } catch (err) {
      console.warn('[Strava] Failed to load tokens:', err.message);
    }
    return {};
  }

  saveTokens(tokens) {
    try {
      const auth = fs.existsSync(AUTH_PATH) 
        ? JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8')) 
        : {};
      auth.strava = { tokens };
      fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
    } catch (err) {
      console.warn('[Strava] Failed to save tokens:', err.message);
    }
  }

  async refreshAccessToken() {
    const auth = this.loadTokens();
    const refreshToken = auth.strava?.tokens?.refresh_token;
    
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const newTokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: response.data.expires_at,
    };

    this.saveTokens(newTokens);
    return newTokens.access_token;
  }

  async getAccessToken() {
    const auth = this.loadTokens();
    const tokens = auth.strava?.tokens;

    if (!tokens) {
      throw new Error('No Strava tokens found. Please authenticate at /admin');
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at && tokens.expires_at < now + 300) {
      return await this.refreshAccessToken();
    }

    return tokens.access_token;
  }

  async fetchData(config, logger) {
    const accessToken = await this.getAccessToken();

    // Get current week's start (Monday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartTimestamp = Math.floor(weekStart.getTime() / 1000);

    // Fetch activities from Strava
    const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      params: {
        after: weekStartTimestamp,
        per_page: 50, // Get up to 50 activities
      },
      timeout: 10000,
    });

    if (response.status !== 200) {
      throw new Error(`Strava API returned status ${response.status}`);
    }

    return response.data;
  }

  mapToDashboard(activities, config) {
    // Filter for runs only
    const runs = activities.filter(activity => 
      activity.type === 'Run' || activity.sport_type === 'Run'
    );

    // Calculate current week running distance (in meters from API)
    const weekDistance = runs.reduce((total, run) => total + (run.distance || 0), 0);
    const weekDistanceKm = weekDistance / 1000;

    // Get last run
    let lastRun = null;
    if (runs.length > 0) {
      const latest = runs[0]; // Activities are returned in descending date order
      const distanceKm = (latest.distance || 0) / 1000;
      const movingTimeSeconds = latest.moving_time || 0;
      
      // Calculate pace (min/km)
      let pace = null;
      if (distanceKm > 0 && movingTimeSeconds > 0) {
        const paceMinPerKm = movingTimeSeconds / 60 / distanceKm;
        const paceMin = Math.floor(paceMinPerKm);
        const paceSec = Math.round((paceMinPerKm - paceMin) * 60);
        pace = `${paceMin}:${String(paceSec).padStart(2, '0')}`;
      }

      const runDate = new Date(latest.start_date);
      
      lastRun = {
        name: latest.name || 'Run',
        date: runDate.toISOString(),
        distance_km: Math.round(distanceKm * 10) / 10,
        pace_per_km: pace,
        moving_time_seconds: movingTimeSeconds,
        elevation_gain_m: Math.round(latest.total_elevation_gain || 0),
      };
    }

    return {
      week_distance_km: Math.round(weekDistanceKm * 10) / 10,
      total_runs_this_week: runs.length,
      last_run: lastRun,
    };
  }

  /**
   * Generate OAuth authorization URL
   */
  buildAuthUrl(baseUrl) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const redirectUri = `${baseUrl}/auth/strava/callback`;
    const scope = 'activity:read_all';
    
    return `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&approval_prompt=auto`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code, baseUrl) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    const redirectUri = `${baseUrl}/auth/strava/callback`;

    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
    });

    const tokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: response.data.expires_at,
    };

    this.saveTokens(tokens);
    return tokens;
  }
}

// OAuth helper functions for server.js
const service = new StravaService();

function buildAuthUrl(baseUrl) {
  return service.buildAuthUrl(baseUrl);
}

async function handleCallback(code, baseUrl) {
  return await service.exchangeCodeForTokens(code, baseUrl);
}

function isAuthed() {
  const auth = service.loadTokens();
  return auth.strava?.tokens != null;
}

module.exports = { 
  StravaService,
  buildAuthUrl,
  handleCallback,
  isAuthed,
};

