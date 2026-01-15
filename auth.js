const axios = require("axios")
require("dotenv").config()

const env = process.env.PARTS_ENV || "sandbox"

const config = {
  production: {
    API_URL: process.env.PARTS_EUROPE_PROD_API_URL,
    USER_ID: process.env.PARTS_EUROPE_PROD_USER_ID,
    SECRET: process.env.PARTS_EUROPE_PROD_SECRET
  },
  sandbox: {
    API_URL: process.env.PARTS_EUROPE_SANDBOX_API_URL,
    USER_ID: process.env.PARTS_EUROPE_SANDBOX_USER_ID,
    SECRET: process.env.PARTS_EUROPE_SANDBOX_SECRET
  }
}[env]

async function getAccessToken() {
  const response = await axios.post(
    `${config.API_URL}/token`,
    {
      user_id: config.USER_ID,
      secret: config.SECRET
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  )

  return response.data
}

module.exports = { getAccessToken }
