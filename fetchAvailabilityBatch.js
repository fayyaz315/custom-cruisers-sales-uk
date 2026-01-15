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
const OUTPUT_FILE = path.join(DATA_DIR, `availability-batch-${env}.json`)

async function fetchAvailabilityBatch() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const { access_token, token_type } = await getAccessToken()

  let page = 1
  let hasNextPage = true
  let allAvailabilities = []
  let totalFetched = 0
  let firstPrinted = false

  console.log("Fetching availability batch...")

  while (hasNextPage) {
    const startTime = Date.now()

    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/availability-batch`,
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

    const { availabilities = [], has_next_page } = response.data

    console.log(`Raw response page ${page} count: ${availabilities.length}`)

    if (!firstPrinted && availabilities.length > 0) {
      console.log("First availability object:")
      console.log(JSON.stringify(availabilities[0], null, 2))
      firstPrinted = true
    }

    allAvailabilities.push(...availabilities)
    totalFetched += availabilities.length
    hasNextPage = has_next_page

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(
      `Page ${page} fetched | Records: ${availabilities.length} | Total: ${totalFetched} | Time: ${duration}s`
    )

    page++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allAvailabilities, null, 2),
    "utf8"
  )

  console.log(`All availability batch data saved to ${OUTPUT_FILE}`)
  console.log(`Total availability records collected: ${allAvailabilities.length}`)

  if (!firstPrinted) {
    console.log("Warning: No availability records were returned by the API.")
  }
}

fetchAvailabilityBatch().catch(error => {
  console.error("Error while fetching availability batch")
  console.error(error.response?.data || error.message)
})
