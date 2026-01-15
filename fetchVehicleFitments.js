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
const OUTPUT_FILE = path.join(DATA_DIR, `vehicle-fitments-${env}.json`)

async function fetchVehicleFitments() {
  if (!fs.existsSync(VEHICLES_FILE)) {
    throw new Error("Vehicles file not found. Fetch vehicles first.")
  }

  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf8"))

  const { access_token, token_type } = await getAccessToken()

  let allFitments = []
  let index = 1

  for (const vehicle of vehicles) {
    const vehicleId = vehicle.vehicle_id || vehicle.id
    let page = 1
    let hasNextPage = true

    console.log(`Fetching fitments for vehicle ${index}/${vehicles.length} | ID: ${vehicleId}`)

    while (hasNextPage) {
      const response = await axios.get(
        `${API_BASE_URL}/v1/vehicles/${vehicleId}/fitments`,
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

      allFitments.push(
        ...fitments.map(f => ({
          vehicle_id: vehicleId,
          ...f
        }))
      )

      hasNextPage = has_next_page
      page++
    }

    index++
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(allFitments, null, 2),
    "utf8"
  )

  console.log(`All vehicle fitments saved to ${OUTPUT_FILE}`)
}

fetchVehicleFitments().catch(error => {
  console.error("Error while fetching vehicle fitments")
  console.error(error.response?.data || error.message)
})
