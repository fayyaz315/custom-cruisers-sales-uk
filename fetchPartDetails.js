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
const OUTPUT_FILE = path.join(DATA_DIR, `part-details-${env}.json`)

async function fetchPartDetails() {
  if (!fs.existsSync(PARTS_FILE)) {
    throw new Error("Parts file not found. Fetch parts list first.")
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const parts = JSON.parse(fs.readFileSync(PARTS_FILE, "utf8"))

  const { access_token, token_type } = await getAccessToken()

  let allDetails = []
  let index = 1
  let firstPrinted = false

  console.log("Fetching part details...")

  for (const part of parts) {
    const partNumber = part.part_number || part.partNumber || part.number
    const startTime = Date.now()

    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/${encodeURIComponent(partNumber)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        timeout: 30000
      }
    )

    if (!firstPrinted) {
      console.log("First part detail object:")
      console.log(JSON.stringify(response.data, null, 2))
      firstPrinted = true
    }

    allDetails.push(response.data)

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(
      `Fetched ${index}/${parts.length} | ${partNumber} | Time: ${duration}s`
    )

    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allDetails, null, 2),
    "utf8"
  )

  console.log(`All part details saved to ${OUTPUT_FILE}`)
  console.log(`Total parts processed: ${allDetails.length}`)
}

fetchPartDetails().catch(error => {
  console.error("Error while fetching part details")
  console.error(error.response?.data || error.message)
})
