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
const BRANDS_FILE = path.join(DATA_DIR, `brands-${env}.json`)
const OUTPUT_FILE = path.join(DATA_DIR, `brand-details-${env}.json`)

async function fetchBrandDetails() {
  if (!fs.existsSync(BRANDS_FILE)) {
    throw new Error("Brands file not found. Fetch brands list first.")
  }

  const brands = JSON.parse(fs.readFileSync(BRANDS_FILE, "utf8"))

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const { access_token, token_type } = await getAccessToken()

  let allBrandDetails = []
  let index = 1

  for (const brand of brands) {
    const brandCode = brand.code || brand.brand_code

    console.log(`Fetching brand ${index}/${brands.length} | Code: ${brandCode}`)

    const response = await axios.get(
      `${API_BASE_URL}/v1/brands/${encodeURIComponent(brandCode)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        timeout: 30000
      }
    )

    allBrandDetails.push(response.data)
    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allBrandDetails, null, 2),
    "utf8"
  )

  console.log(`All brand details saved to ${OUTPUT_FILE}`)
}

fetchBrandDetails().catch(error => {
  console.error("Error while fetching brand details")
  console.error(error.response?.data || error.message)
})
