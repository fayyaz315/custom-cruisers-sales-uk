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
const VEHICLES_FILE = path.join(DATA_DIR, `vehicles-${env}.json`)
const OUTPUT_FILE = path.join(DATA_DIR, `vehicle-details-${env}.json`)

async function fetchVehicleDetails() {
  if (!fs.existsSync(VEHICLES_FILE)) {
    throw new Error("Vehicles file not found. Fetch vehicles first.")
  }

  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf8"))

  console.log(`Total vehicles to process: ${vehicles.length}`)
  console.log("Requesting access token...")

  const { access_token, token_type } = await getAccessToken()

  console.log("Access token received")
  console.log("Fetching vehicle details...")

  let allDetails = []
  let index = 1

  for (const vehicle of vehicles) {
    const vehicleId = vehicle.vehicle_id || vehicle.id

    console.log(`Fetching ${index}/${vehicles.length} | Vehicle ID: ${vehicleId}`)
    const startTime = Date.now()

    const response = await axios.get(
      `${API_BASE_URL}/v1/vehicles/${vehicleId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `${token_type} ${access_token}`
        },
        timeout: 30000
      }
    )

    allDetails.push(response.data)

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`Done in ${duration}s`)

    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allDetails, null, 2),
    "utf8"
  )

  console.log(`All vehicle details saved to ${OUTPUT_FILE}`)
}

fetchVehicleDetails().catch(error => {
  console.error("Error while fetching vehicle details")
  console.error(error.response?.data || error.message)
})
