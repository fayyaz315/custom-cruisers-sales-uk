const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const { getAccessToken } = require("./auth")

const env = process.env.PARTS_ENV || "sandbox"

const API_CONFIG = {
  production: {
    API_BASE_URL: process.env.PARTS_EUROPE_PROD_API_URL
  },
  sandbox: {
    API_BASE_URL: process.env.PARTS_EUROPE_SANDBOX_API_URL
  }
}[env]

const API_BASE_URL = API_CONFIG.API_BASE_URL
const DATA_DIR = path.join(__dirname, "data")
const OUTPUT_FILE = path.join(DATA_DIR, `availability-updates-${env}.json`)

async function fetchAvailabilityUpdates() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const { access_token, token_type } = await getAccessToken()

  let page = 1
  let hasNextPage = true
  let allChangedParts = []

  console.log("Fetching availability updates...")

  while (hasNextPage) {
    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/availability-changes`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        params: {
          page,
          limit: 1000
        },
        timeout: 30000
      }
    )

    const { part_numbers = [], has_next_page } = response.data

    allChangedParts.push(...part_numbers)

    hasNextPage = has_next_page
    page++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allChangedParts, null, 2),
    "utf8"
  )

  console.log(`All availability updates saved to ${OUTPUT_FILE}`)
}

fetchAvailabilityUpdates().catch(error => {
  console.error("Error while fetching availability updates")
  console.error(error.response?.data || error.message)
})
