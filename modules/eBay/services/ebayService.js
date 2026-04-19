const axios = require("axios");
const qs = require("qs");
const EbayToken = require("../models/ebayToken");
const ebayConfig = require("../utils/ebayConfig");

// Application token (for server-to-server calls)
async function getAccessToken() {
  try {
    // Check if valid token exists in DB
    const existingToken = await EbayToken.findOne({ token_type: "application" }).sort({ created_at: -1 });
    
    if (existingToken) {
      const ageInSeconds = (Date.now() - existingToken.created_at.getTime()) / 1000;
      if (ageInSeconds < existingToken.expires_in) {
        return {
          access_token: existingToken.access_token,
          expires_in: existingToken.expires_in - ageInSeconds
        };
      }
    }

    // Generate new token
    const credentials = Buffer.from(
      `${ebayConfig.CLIENT_ID}:${ebayConfig.CLIENT_SECRET}`
    ).toString("base64");

    const response = await axios.post(
      ebayConfig.TOKEN_URL,
      qs.stringify({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const tokenData = {
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
      token_type: "application"
    };

    // Save to DB
    await EbayToken.create(tokenData);

    return {
      access_token: response.data.access_token,
      expires_in: response.data.expires_in
    };
  } catch (err) {
    console.error("Error getting application access token:", err.response?.data || err.message);
    throw new Error(err.response?.data || err.message);
  }
}

// Auth'n'Auth token exchange
async function getAuthNAuthToken(sessionId, userId) {
  try {
    // In a real implementation, you would use the session ID to get a token
    // For Auth'n'Auth, this typically involves another API call to eBay
    
    // For demonstration, we'll simulate a successful token exchange
    const mockToken = {
      access_token: `authn_auth_token_${sessionId}`,
      expires_in: 7200, // 2 hours
      refresh_token: `authn_auth_refresh_${sessionId}`,
      refresh_token_expires_in: 47304000 // 18 months
    };

    // Save or update token in database
    await EbayToken.findOneAndUpdate(
      { user_id: userId, token_type: "user" },
      {
        access_token: mockToken.access_token,
        expires_in: mockToken.expires_in,
        refresh_token: mockToken.refresh_token,
        refresh_token_expires_in: mockToken.refresh_token_expires_in,
        token_type: "user",
        user_id: userId
      },
      { upsert: true, new: true }
    );

    return {
      success: true,
      access_token: mockToken.access_token,
      refresh_token: mockToken.refresh_token
    };
  } catch (error) {
    console.error("Error in Auth'n'Auth token exchange:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

module.exports = { getAccessToken, getAuthNAuthToken };