const axios = require("axios")
const fs = require("fs")
const path = require("path")
const XLSX = require("xlsx")
require("dotenv").config()

const { getAccessToken } = require("./auth")

const env = "production"

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

const JSON_FILE = path.join(
  DATA_DIR,
  `brands-${env}.json`
)

const EXCEL_FILE = path.join(
  DATA_DIR,
  `brands-${env}.xlsx`
)

async function fetchBrands() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    })
  }

  const {
    access_token,
    token_type
  } = await getAccessToken()

  let page = 1
  let hasNextPage = true
  let allBrands = []

  console.log(
    "Fetching brands from production..."
  )

  while (hasNextPage) {
    const startTime = Date.now()

    const response =
      await axios.get(
        `${API_BASE_URL}/v1/brands`,
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
      brands = [],
      has_next_page
    } = response.data

    allBrands.push(...brands)

    const duration =
      (
        (Date.now() - startTime) /
        1000
      ).toFixed(2)

    console.log(
      `Page ${page} fetched | Records: ${brands.length} | Total: ${allBrands.length} | Time: ${duration}s`
    )

    hasNextPage =
      has_next_page

    page++
  }

  fs.writeFileSync(
    JSON_FILE,
    JSON.stringify(
      allBrands,
      null,
      2
    ),
    "utf8"
  )

  console.log(
    `JSON saved: ${JSON_FILE}`
  )

  const excelRows =
    allBrands.map(brand => ({
      id:
        brand.id || "",

      code:
        brand.code || "",

      name:
        brand.name || "",

      display_name:
        brand.display_name || "",

      slug:
        brand.slug || ""
    }))

  const workbook =
    XLSX.utils.book_new()

  const worksheet =
    XLSX.utils.json_to_sheet(
      excelRows
    )

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Brands"
  )

  XLSX.writeFile(
    workbook,
    EXCEL_FILE
  )

  console.log(
    `Excel saved: ${EXCEL_FILE}`
  )

  console.log(
    `Total brands collected: ${allBrands.length}`
  )
}

fetchBrands().catch(error => {
  console.error(
    "Error while fetching brands"
  )

  console.error(
    error.response?.data ||
    error.message
  )
})