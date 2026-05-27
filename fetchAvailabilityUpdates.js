const axios = require("axios")
const fs = require("fs")
const path = require("path")
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

const DATA_DIR = path.join(
  __dirname,
  "data"
)

const OUTPUT_FILE =
  path.join(
    DATA_DIR,
    `availability-updates-${env}.json`
  )

async function fetchAvailabilityUpdates() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 FETCH AVAILABILITY UPDATES STARTED"
  )

  console.log(
    "=".repeat(100)
  )

  if (!fs.existsSync(DATA_DIR)) {
    console.log(
      `📁 Creating data directory`
    )

    fs.mkdirSync(DATA_DIR, {
      recursive: true
    })
  }

  const {
    access_token,
    token_type
  } = await getAccessToken()

  console.log(
    "🔑 Access token received"
  )

  let page = 1

  let hasNextPage = true

  let allChangedParts = []

  while (hasNextPage) {
    console.log(
      "\n" + "-".repeat(100)
    )

    console.log(
      `📄 Fetching page ${page}`
    )

    const startedAt =
      Date.now()

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

    const duration =
      (
        (Date.now() -
          startedAt) /
        1000
      ).toFixed(2)

    const {
      part_numbers = [],
      has_next_page
    } = response.data

    console.log(
      `📦 Records received: ${part_numbers.length}`
    )

    console.log(
      `⏱️ Request time: ${duration}s`
    )

    allChangedParts.push(
      ...part_numbers
    )

    console.log(
      `📊 Total SKUs collected: ${allChangedParts.length}`
    )

    hasNextPage =
      has_next_page

    page++
  }

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    `💾 Saving availability updates`
  )

  console.log(
    OUTPUT_FILE
  )

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      allChangedParts,
      null,
      2
    ),
    "utf8"
  )

  console.log(
    "✅ Availability updates file saved"
  )

  console.log(
    `📦 Total updated SKUs: ${allChangedParts.length}`
  )

  console.log(
    "\n🎉 FETCH AVAILABILITY UPDATES FINISHED\n"
  )

  return allChangedParts
}

module.exports =
  fetchAvailabilityUpdates