const axios = require("axios")
require("dotenv").config()

const { getAccessToken } =
  require("./auth")

const env =
  process.env.PARTS_ENV ||
  "sandbox"

const API_CONFIG = {
  production: {
    API_BASE_URL:
      process.env.PARTS_EUROPE_PROD_API_URL
  },

  sandbox: {
    API_BASE_URL:
      process.env.PARTS_EUROPE_SANDBOX_API_URL
  }
}[env]

const API_BASE_URL =
  API_CONFIG.API_BASE_URL

async function fetchAvailabilityUpdates() {
  console.log(
    "\n======================================"
  )

  console.log(
    "FETCHING AVAILABILITY UPDATES"
  )

  console.log(
    "======================================"
  )

  const {
    access_token,
    token_type
  } = await getAccessToken()

  let page = 1

  let hasNextPage = true

  const allSkus = []

  while (hasNextPage) {
    console.log(
      `Fetching page ${page}`
    )

    const response =
      await axios.get(
        `${API_BASE_URL}/v1/parts/availability-changes`,
        {
          headers: {
            Accept:
              "application/json",

            Authorization:
              `${token_type} ${access_token}`
          },

          params: {
            page,
            limit: 1000
          },

          timeout: 30000
        }
      )

    const {
      part_numbers = [],
      has_next_page
    } = response.data

    console.log(
      `Received ${part_numbers.length} SKUs`
    )

    allSkus.push(
      ...part_numbers
    )

    hasNextPage =
      has_next_page

    page++
  }

  console.log(
    `\nTotal changed SKUs: ${allSkus.length}`
  )

  return allSkus
}

module.exports =
  fetchAvailabilityUpdates