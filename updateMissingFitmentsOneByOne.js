const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP =
  process.env.SHOPIFY_STORE_URL

const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN

const API_VERSION =
  "2026-04"

const client =
  axios.create({
    baseURL:
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,

    timeout: 60000,

    headers: {
      "X-Shopify-Access-Token":
        TOKEN,

      "Content-Type":
        "application/json"
    }
  })

const dataDirectory =
  path.join(
    __dirname,
    "shopify-fitments-data"
  )

const inputFile =
  path.join(
    dataDirectory,
    "products-missing-fitments.jsonl"
  )

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

function log(
  message,
  data = null
) {
  const time =
    new Date().toLocaleString()

  console.log(
    `\n[${time}] ${message}`
  )

  if (data) {
    console.log(
      JSON.stringify(
        data,
        null,
        2
      )
    )
  }
}

function safeJsonParse(
  value
) {
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

function stringifyList(
  values
) {
  return JSON.stringify(
    [
      ...new Set(
        values
          .map(value =>
            String(
              value
            ).trim()
          )
          .filter(Boolean)
      )
    ]
  )
}

function extractFitmentData(
  fitments
) {
  const ids = []
  const vehicleIds = []
  const information = []

  for (const fitment of fitments) {
    if (fitment.id) {
      ids.push(
        fitment.id
      )
    }

    if (
      fitment.vehicle_id
    ) {
      vehicleIds.push(
        fitment.vehicle_id
      )
    }

    const info = []

    if (fitment.make) {
      info.push(
        fitment.make
      )
    }

    if (fitment.model) {
      info.push(
        fitment.model
      )
    }

    if (fitment.year) {
      info.push(
        fitment.year
      )
    }

    if (
      info.length > 0
    ) {
      information.push(
        info.join(" ")
      )
    }
  }

  return {
    ids,
    vehicleIds,
    information
  }
}

async function updateProduct(
  product,
  index,
  total
) {
  try {
    log(
      `Processing ${index}/${total}`
    )

    log(product.title)

    const fitments =
      safeJsonParse(
        product
          .partFitments
          ?.value
      )

    if (
      !Array.isArray(
        fitments
      ) ||
      fitments.length ===
        0
    ) {
      log(
        "No fitment data"
      )

      return
    }

    const extracted =
      extractFitmentData(
        fitments
      )

    const metafields =
      []

    if (
      !product.idsList
        ?.value &&
      extracted.ids.length >
        0
    ) {
      metafields.push({
        ownerId:
          product.id,

        namespace:
          "fitments",

        key:
          "ids_list",

        type:
          "list.single_line_text_field",

        value:
          stringifyList(
            extracted.ids
          )
      })
    }

    if (
      !product
        .vehicleIdsList
        ?.value &&
      extracted
        .vehicleIds
        .length > 0
    ) {
      metafields.push({
        ownerId:
          product.id,

        namespace:
          "fitments",

        key:
          "vehicle_ids_list",

        type:
          "list.single_line_text_field",

        value:
          stringifyList(
            extracted.vehicleIds
          )
      })
    }

    if (
      !product
        .informationList
        ?.value &&
      extracted
        .information
        .length > 0
    ) {
      metafields.push({
        ownerId:
          product.id,

        namespace:
          "fitments",

        key:
          "information_list",

        type:
          "list.single_line_text_field",

        value:
          stringifyList(
            extracted.information
          )
      })
    }

    if (
      metafields.length ===
      0
    ) {
      log(
        "Nothing to update"
      )

      return
    }

    const mutation = `
      mutation metafieldsSet(
        $metafields: [MetafieldsSetInput!]!
      ) {
        metafieldsSet(
          metafields: $metafields
        ) {
          metafields {
            id
            key
          }

          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      metafields
    }

    const response =
      await client.post(
        "",
        {
          query:
            mutation,

          variables
        }
      )

    const result =
      response.data.data
        .metafieldsSet

    if (
      result.userErrors
        .length > 0
    ) {
      log(
        "User errors",
        result.userErrors
      )

      return
    }

    log(
      "Updated successfully",
      {
        metafields:
          metafields.length
      }
    )

    await sleep(300)
  } catch (error) {
    log(
      "Update failed"
    )

    console.log(
      error.message
    )

    if (
      error.response?.data
    ) {
      console.log(
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      )
    }
  }
}

async function run() {
  log(
    "======================================"
  )

  log(
    "STARTING ONE BY ONE FITMENT UPDATE"
  )

  log(
    "======================================"
  )

  const readStream =
    fs.createReadStream(
      inputFile,
      {
        encoding: "utf8"
      }
    )

  let buffer = ""

  const products = []

  await new Promise(
    (resolve, reject) => {
      readStream.on(
        "data",
        chunk => {
          buffer += chunk

          const lines =
            buffer.split("\n")

          buffer =
            lines.pop()

          for (const line of lines) {
            if (!line.trim()) {
              continue
            }

            try {
              products.push(
                JSON.parse(
                  line
                )
              )
            } catch (
              error
            ) {
              console.log(
                error.message
              )
            }
          }
        }
      )

      readStream.on(
        "end",
        resolve
      )

      readStream.on(
        "error",
        reject
      )
    }
  )

  log(
    "Products loaded",
    {
      total:
        products.length
    }
  )

  let index = 0

  for (const product of products) {
    index++

    await updateProduct(
      product,
      index,
      products.length
    )
  }

  log(
    "======================================"
  )

  log(
    "ALL PRODUCTS COMPLETED"
  )

  log(
    "======================================"
  )
}

run()