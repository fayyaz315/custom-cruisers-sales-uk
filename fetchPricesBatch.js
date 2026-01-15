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
const OUTPUT_FILE = path.join(DATA_DIR, `prices-batch-${env}.json`)

async function fetchPricesBatch() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const { access_token, token_type } = await getAccessToken()

  let page = 1
  let hasNextPage = true
  let allPrices = []
  let totalFetched = 0
  let firstPrinted = false

  console.log("Fetching prices batch...")

  while (hasNextPage) {
    const startTime = Date.now()

    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/prices-batch`,
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

    const { prices = [], has_next_page } = response.data

    if (!firstPrinted && prices.length > 0) {
      console.log("First price object:")
      console.log(JSON.stringify(prices[0], null, 2))
      firstPrinted = true
    }

    allPrices.push(...prices)
    totalFetched += prices.length
    hasNextPage = has_next_page

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(
      `Page ${page} fetched | Records: ${prices.length} | Total: ${totalFetched} | Time: ${duration}s`
    )

    page++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allPrices, null, 2),
    "utf8"
  )

  console.log(`All prices batch data saved to ${OUTPUT_FILE}`)
  console.log(`Total price records collected: ${allPrices.length}`)
}

fetchPricesBatch().catch(error => {
  console.error("Error while fetching prices batch")
  console.error(error.response?.data || error.message)
})
