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
const OUTPUT_FILE = path.join(DATA_DIR, `vehicles-${env}.json`)

async function fetchVehicles() {
  if (!API_BASE_URL) {
    throw new Error(`Missing API base URL for environment: ${env}`)
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  console.log(`Environment: ${env}`)
  console.log("Requesting access token...")

  const { access_token, token_type } = await getAccessToken()

  console.log("Access token received")
  console.log("Starting vehicles fetch...")

  let page = 1
  let hasNextPage = true
  let allVehicles = []
  let totalFetched = 0
  let firstPrinted = false

  while (hasNextPage) {
    const startTime = Date.now()

    const response = await axios.get(
      `${API_BASE_URL}/v1/vehicles`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        params: {
          fitments_exists: true,
          page,
          limit: 5000
        },
        timeout: 30000
      }
    )

    const { vehicles = [], has_next_page } = response.data

    if (!firstPrinted && vehicles.length > 0) {
      console.log("First vehicle object:")
      console.log(JSON.stringify(vehicles[0], null, 2))
      firstPrinted = true
    }

    const count = vehicles.length
    totalFetched += count
    allVehicles.push(...vehicles)
    hasNextPage = has_next_page

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(
      `Page ${page} fetched | Records: ${count} | Total: ${totalFetched} | Time: ${duration}s`
    )

    page++
  }

  console.log("All pages fetched")
  console.log(`Total vehicles collected: ${allVehicles.length}`)
  console.log("Saving data to file...")

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allVehicles, null, 2),
    "utf8"
  )

  console.log(`Saved successfully to ${OUTPUT_FILE}`)
}

fetchVehicles().catch(error => {
  console.error("Error while fetching vehicles")
  console.error(error.response?.data || error.message)
})
