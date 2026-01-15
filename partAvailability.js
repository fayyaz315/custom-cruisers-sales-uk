const axios = require("axios")
require("dotenv").config()

const { getAccessToken } = require("./auth")

const env = process.env.PARTS_ENV || "production"

const API_CONFIG = {
  production: {
    API_BASE_URL: process.env.PARTS_EUROPE_PROD_API_URL
  },
  sandbox: {
    API_BASE_URL: process.env.PARTS_EUROPE_SANDBOX_API_URL
  }
}[env]

const API_BASE_URL = API_CONFIG.API_BASE_URL

async function checkPartAvailability(partNumber) {
  try {
    const { access_token, token_type } = await getAccessToken()

    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/${encodeURIComponent(partNumber)}/availability`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        timeout: 30000
      }
    )

    console.log("Availability for part:", partNumber)
    console.log(JSON.stringify(response.data, null, 2))
  } catch (error) {
    console.error("Failed to fetch availability")
    console.error(error.response?.data || error.message)
  }
}

checkPartAvailability("00204801")
