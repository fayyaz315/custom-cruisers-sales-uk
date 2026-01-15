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
const PARTS_FILE = path.join(DATA_DIR, `parts-${env}.json`)
const OUTPUT_FILE = path.join(DATA_DIR, `part-fitments-${env}.json`)

async function fetchPartFitments() {
  if (!fs.existsSync(PARTS_FILE)) {
    throw new Error("Parts file not found. Create parts list first.")
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const parts = JSON.parse(fs.readFileSync(PARTS_FILE, "utf8"))

  const { access_token, token_type } = await getAccessToken()

  let allFitments = []
  let index = 1
  let totalFetched = 0
  let firstPrinted = false

  console.log("Fetching part fitments...")

  for (const part of parts) {
    const partNumber = part.partNumber || part.part_number || part.number

    console.log(`\nPart ${index}/${parts.length} | ${partNumber}`)

    let page = 1
    let hasNextPage = true

    while (hasNextPage) {
      const startTime = Date.now()

      const response = await axios.get(
        `${API_BASE_URL}/v1/parts/${encodeURIComponent(partNumber)}/fitments`,
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

      const { fitments = [], has_next_page } = response.data

      if (!firstPrinted && fitments.length > 0) {
        console.log("First fitment object:")
        console.log(JSON.stringify(fitments[0], null, 2))
        firstPrinted = true
      }

      allFitments.push(
        ...fitments.map(f => ({
          part_number: partNumber,
          ...f
        }))
      )

      totalFetched += fitments.length
      hasNextPage = has_next_page

      const duration = ((Date.now() - startTime) / 1000).toFixed(2)

      console.log(
        `  Page ${page} fetched | Records: ${fitments.length} | Total fitments: ${totalFetched} | Time: ${duration}s`
      )

      page++
    }

    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allFitments, null, 2),
    "utf8"
  )

  console.log(`\nAll part fitments saved to ${OUTPUT_FILE}`)
  console.log(`Total fitments collected: ${allFitments.length}`)

  if (!firstPrinted) {
    console.log("Warning: No fitments were returned by the API.")
  }
}

fetchPartFitments().catch(error => {
  console.error("Error while fetching part fitments")
  console.error(error.response?.data || error.message)
})
