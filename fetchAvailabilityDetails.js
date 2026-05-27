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

const INPUT_FILE = path.join(
  DATA_DIR,
  `availability-updates-${env}.json`
)

const OUTPUT_FILE = path.join(
  DATA_DIR,
  `availability-details-${env}.json`
)

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function fetchPartDetail(
  accessToken,
  tokenType,
  partNumber
) {
  try {
    console.log(
      `📡 Fetching ${partNumber}`
    )

    const startedAt =
      Date.now()

    const response =
      await axios.get(
        `${API_BASE_URL}/v1/parts/${partNumber}`,
        {
          headers: {
            Accept:
              "application/json",

            Authorization:
              `${tokenType} ${accessToken}`
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

    console.log(
      `✅ Received ${partNumber} | ${duration}s`
    )

    return response.data
  } catch (error) {
    console.log(
      `❌ Failed ${partNumber}`
    )

    console.log(
      error.response?.data ||
      error.message
    )

    return null
  }
}

async function fetchAvailabilityDetails() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 FETCH AVAILABILITY DETAILS STARTED"
  )

  console.log(
    "=".repeat(100)
  )

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    })
  }

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `Input file missing:\n${INPUT_FILE}`
    )
  }

  console.log(
    `📥 Reading availability updates`
  )

  console.log(INPUT_FILE)

  const {
    access_token,
    token_type
  } = await getAccessToken()

  console.log(
    "🔑 Access token received"
  )

  const partNumbers =
    JSON.parse(
      fs.readFileSync(
        INPUT_FILE,
        "utf8"
      )
    )

  console.log(
    `📦 Total SKUs: ${partNumbers.length}`
  )

  const allDetails = []

  let processed = 0

  for (const partNumber of partNumbers) {
    processed++

    console.log(
      "\n" + "-".repeat(100)
    )

    console.log(
      `🔄 Processing ${processed}/${partNumbers.length}`
    )

    console.log(
      `📦 SKU: ${partNumber}`
    )

    const detail =
      await fetchPartDetail(
        access_token,
        token_type,
        partNumber
      )

    if (!detail) {
      console.log(
        `⚠️ Skipping ${partNumber}`
      )

      continue
    }

    const inventoryRecord = {
      part_number:
        detail.part_number,

      vendor_part_number:
        detail.vendor_part_number,

      barcode:
        detail.barcode,

      brand_code:
        detail.brand_code,

      quantity:
        detail.available_quantity ||
        0,

      warehouse_status:
        detail.warehouse_status,

      warehouse_country:
        detail.warehouse_country,

      updated_at:
        new Date().toISOString()
    }

    console.log(
      "📊 Inventory Record:"
    )

    console.log(
      JSON.stringify(
        inventoryRecord,
        null,
        2
      )
    )

    allDetails.push(
      inventoryRecord
    )

    await sleep(250)
  }

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "💾 Saving availability details"
  )

  console.log(
    OUTPUT_FILE
  )

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      allDetails,
      null,
      2
    ),
    "utf8"
  )

  console.log(
    "✅ Availability details saved"
  )

  console.log(
    `📦 Total records: ${allDetails.length}`
  )

  console.log(
    "\n🎉 FETCH AVAILABILITY DETAILS FINISHED\n"
  )

  return allDetails
}

module.exports =
  fetchAvailabilityDetails