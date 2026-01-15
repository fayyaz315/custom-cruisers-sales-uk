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
const OUTPUT_FILE = path.join(DATA_DIR, `part-prices-${env}.json`)

async function fetchPartPrices() {
  if (!fs.existsSync(PARTS_FILE)) {
    throw new Error("Parts file not found. Run fetchParts.js first.")
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const parts = JSON.parse(fs.readFileSync(PARTS_FILE, "utf8"))

  const { access_token, token_type } = await getAccessToken()

  let allPrices = []
  let index = 1

  for (const part of parts) {
    const partNumber = part.part_number || part.partNumber || part.number

    console.log(`Fetching price ${index}/${parts.length} | ${partNumber}`)

    const response = await axios.get(
      `${API_BASE_URL}/v1/parts/${encodeURIComponent(partNumber)}/price`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        timeout: 30000
      }
    )

    allPrices.push(response.data)
    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allPrices, null, 2),
    "utf8"
  )

  console.log(`All part prices saved to ${OUTPUT_FILE}`)
}

fetchPartPrices().catch(error => {
  console.error("Error while fetching part prices")
  console.error(error.response?.data || error.message)
})
