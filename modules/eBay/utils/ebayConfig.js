require("dotenv").config();

const isSandbox = process.env.EBAY_ENV !== 'production';

module.exports = {
  CLIENT_ID:  process.env.EBAY_CLIENT_ID,
  CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
  DEV_ID:     process.env.EBAY_DEV_ID,
  RU_NAME:    process.env.EBAY_RUNAME,
  CALLBACK_URL: process.env.EBAY_CALLBACK_URL,

  AUTH_URL: isSandbox
    ? "https://signin.sandbox.ebay.com/ws/eBayISAPI.dll"
    : "https://signin.ebay.com/ws/eBayISAPI.dll",

  TOKEN_URL: isSandbox
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token",
};
