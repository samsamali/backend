const EbayUser = require("../models/ebayUsers");
const ebayConfig = require("../utils/ebayConfig");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// 🔹 Check if user already has active connection
async function checkExistingConnection(userId) {
  try {
    const existingConnection = await EbayUser.findOne({
      user_id: userId,
      is_active: true,
    });
    return !!existingConnection;
  } catch (error) {
    console.error("Error checking existing connection:", error);
    return false;
  }
}

const ebayController = {
  // 🔹 Step 1: Redirect user to eBay sign-in page
  initiateAuth: async (req, res) => {
    try {
      const userId = req.query.userId || "default-user-id";

      const hasExistingConnection = await checkExistingConnection(userId);
      if (hasExistingConnection) {
        return res.status(400).json({
          success: false,
          message: "User already has an active eBay connection. Please disconnect first.",
        });
      }

      const ruName = encodeURIComponent(ebayConfig.RU_NAME);
      const sessId = encodeURIComponent(JSON.stringify({ userId }));

      // eBay Auth’n’Auth redirect URL
      const authUrl = `${ebayConfig.AUTH_URL}?SignIn&runame=${ruName}&SessID=${sessId}`;

      console.log("Redirecting to eBay Auth’n’Auth URL:", authUrl);
      res.redirect(authUrl);
    } catch (error) {
      console.error("Error initiating Auth:", error);
      res.status(500).json({
        success: false,
        message: "Failed to initiate eBay Auth flow",
        error: error.message,
      });
    }
  },

  // 🔹 Step 2: eBay redirects back to our callback
  handleAuthCallback: async (req, res) => {
    try {
      const { isAuthSuccessful, SessID } = req.query;
      console.log("Auth callback received:", { isAuthSuccessful, SessID });

      if (isAuthSuccessful !== "true") {
        return res.redirect(
          `${FRONTEND_URL}/integrations?error=auth_failed`
        );
      }

      if (!SessID) {
        return res.redirect(
          `${FRONTEND_URL}/integrations?error=no_session_id`
        );
      }

      let userId;
      try {
        const sessData = JSON.parse(decodeURIComponent(SessID));
        userId = sessData.userId;
      } catch (error) {
        return res.redirect(
          `${FRONTEND_URL}/integrations?error=invalid_session`
        );
      }

      // Save connection in DB
      await EbayUser.findOneAndUpdate(
        { user_id: userId },
        {
          ebay_username: "ebay_user", // 👈 yahan API se actual user fetch kar sakte ho
          login_method: "username",
          connected_at: new Date(),
          is_active: true,
          session_id: SessID,
        },
        { upsert: true, new: true }
      );

      return res.redirect(
        `${FRONTEND_URL}/integrations?success=true&message=ebay_store_connected`
      );
    } catch (error) {
      console.error("Error handling Auth callback:", error);
      return res.redirect("http://localhost:3000/integrations?error=server_error");
    }
  },

  // 🔹 Step 3: Disconnect user
  disconnect: async (req, res) => {
    try {
      const userId = req.query.userId;

      const result = await EbayUser.findOneAndUpdate(
        { user_id: userId, is_active: true },
        { is_active: false },
        { new: true }
      );

      if (result) {
        res.json({ success: true, message: "eBay account disconnected successfully" });
      } else {
        res.status(404).json({ success: false, message: "No active eBay connection found" });
      }
    } catch (error) {
      console.error("Error disconnecting eBay account:", error);
      res.status(500).json({ success: false, message: "Failed to disconnect eBay account" });
    }
  },
};

module.exports = { ebayController };
