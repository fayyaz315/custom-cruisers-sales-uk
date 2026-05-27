const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

async function startBulkOperation() {
  log("Starting Shopify product export bulk operation...")

  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                id
                title
                handle
                vendor

                variants(first: 1) {
                  edges {
                    node {
                      sku
                    }
                  }
                }
              }
            }
          }
        }
        """
      ) {
        bulkOperation {
          id
          status
          createdAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  try {
    const res = await client.post("", { query })

    const result = res.data.data.bulkOperationRunQuery

    if (result.userErrors.length > 0) {
      log("Bulk operation returned user errors", result.userErrors)
      process.exit()
    }

    log("Bulk operation created successfully", result.bulkOperation)

    return result.bulkOperation.id
  } catch (error) {
    log("Failed to create bulk operation")

    console.log(
      error.response?.data || error.message
    )

    process.exit()
  }
}

async function waitForCompletion() {
  log("Waiting for Shopify to process product export...")

  let attempt = 1

  while (true) {
    try {
      log(`Checking operation status... Attempt #${attempt}`)

      const query = `
        {
          currentBulkOperation {
            id
            status
            errorCode
            objectCount
            fileSize
            createdAt
            completedAt
            url
          }
        }
      `

      const res = await client.post("", { query })

      const operation =
        res.data.data.currentBulkOperation

      if (!operation) {
        log("No current bulk operation found")
        process.exit()
      }

      log("Current operation status", operation)

      if (operation.status === "COMPLETED") {
        log("Bulk operation completed successfully")

        log("Total exported Shopify objects", {
          objectCount: operation.objectCount
        })

        return operation.url
      }

      if (operation.status === "FAILED") {
        log("Bulk operation FAILED", operation)
        process.exit()
      }

      if (operation.status === "CANCELED") {
        log("Bulk operation CANCELED", operation)
        process.exit()
      }

      log(
        `Still processing... Exported objects so far: ${operation.objectCount}`
      )

      attempt++

      await new Promise(resolve =>
        setTimeout(resolve, 5000)
      )
    } catch (error) {
      log("Error while checking bulk operation")

      console.log(
        error.response?.data || error.message
      )

      process.exit()
    }
  }
}

function generateHandle(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

async function downloadAndProcessFile(url) {
  try {
    log("Downloading Shopify JSONL export file...")

    const response = await axios.get(url)

    log("JSONL file downloaded successfully")

    const lines = response.data.trim().split("\n")

    log(`Total JSONL rows received: ${lines.length}`)

    const productsMap = {}

    let productRows = 0
    let variantRows = 0

    for (const line of lines) {
      const item = JSON.parse(line)

      if (
        item.id &&
        item.title &&
        item.handle
      ) {
        productsMap[item.id] = {
          id: item.id,

          oldTitle: item.title,
          oldHandle: item.handle,

          vendor: item.vendor || "",
          sku: "",

          newTitle: "",
          newHandle: ""
        }

        productRows++
      }

      else if (
        item.sku &&
        item.__parentId
      ) {
        const parent =
          productsMap[item.__parentId]

        if (parent) {
          parent.sku = item.sku

          parent.newTitle =
            `${parent.oldTitle} ${parent.vendor} ${parent.sku}`
              .replace(/\s+/g, " ")
              .trim()

          parent.newHandle =
            generateHandle(parent.newTitle)
        }

        variantRows++
      }
    }

    log("JSONL parsing completed")

    log("Parsed row statistics", {
      productRows,
      variantRows
    })

    const finalProducts =
      Object.values(productsMap)

    log("Final processed product count", {
      totalProducts: finalProducts.length
    })

    console.log(
      `\nProcessed Products: ${finalProducts.length}`
    )

    const exportDataDirectory = path.join(
      __dirname,
      "shopify-product-title-migration-data"
    )

    if (!fs.existsSync(exportDataDirectory)) {
      fs.mkdirSync(exportDataDirectory)

      log("Export data directory created")
    }

    const exportFilePath = path.join(
      exportDataDirectory,
      "products-before-title-and-handle-update.json"
    )

    fs.writeFileSync(
      exportFilePath,
      JSON.stringify(finalProducts, null, 2)
    )

    log("Final export JSON file saved successfully", {
      path: exportFilePath
    })
  } catch (error) {
    log("Error while downloading or processing export file")

    console.log(
      error.response?.data || error.message
    )

    process.exit()
  }
}

async function run() {
  log("===================================")
  log("SHOPIFY PRODUCT EXPORT STARTED")
  log("===================================")

  log("Shop configuration", {
    shop: SHOP,
    apiVersion: API_VERSION
  })

  const operationId =
    await startBulkOperation()

  log("Bulk operation ID", {
    operationId
  })

  const downloadUrl =
    await waitForCompletion()

  log("Download URL received", {
    downloadUrl
  })

  await downloadAndProcessFile(downloadUrl)

  log("===================================")
  log("SHOPIFY PRODUCT EXPORT FINISHED")
  log("===================================")
}

run()