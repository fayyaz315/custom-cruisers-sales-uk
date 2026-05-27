const axios = require("axios")
const fs = require("fs")
const path = require("path")
const readline = require("readline")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 120000,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

const outputDirectory = path.join(
  __dirname,
  "shopify-customs-data"
)

if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory, {
    recursive: true
  })
}

const bulkOutputFilePath = path.join(
  outputDirectory,
  "products-customs-export.jsonl"
)

const organizedOutputFilePath = path.join(
  outputDirectory,
  "products-customs-organized.jsonl"
)

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

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

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function startBulkExport() {
  log("======================================")
  log("STARTING CUSTOMS EXPORT")
  log("======================================")

  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                id

                metafield(
                  namespace: "parts_europe",
                  key: "eu_harmonized_code"
                ) {
                  value
                }

                variants {
                  edges {
                    node {
                      id

                      inventoryItem {
                        id
                      }
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
        }

        userErrors {
          field
          message
        }
      }
    }
  `

  const response =
    await client.post("", {
      query
    })

  const result =
    response.data.data
      .bulkOperationRunQuery

  if (
    result.userErrors.length >
    0
  ) {
    log(
      "Bulk export errors",
      {
        errors:
          result.userErrors
      }
    )

    process.exit()
  }

  log(
    "Bulk export started",
    {
      operationId:
        result.bulkOperation.id,

      status:
        result.bulkOperation.status
    }
  )

  return result.bulkOperation.id
}

async function waitForBulkExport(
  bulkOperationId
) {
  log("======================================")
  log("WAITING FOR BULK EXPORT")
  log("======================================")

  let attempt = 1

  while (true) {
    const query = `
      query getBulkOperation(
        $id: ID!
      ) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            createdAt
            completedAt
            objectCount
            fileSize
            url
          }
        }
      }
    `

    const variables = {
      id:
        bulkOperationId
    }

    const response =
      await client.post("", {
        query,
        variables
      })

    const operation =
      response.data.data.node

    log(
      `Checking export status #${attempt}`
    )

    log(
      "Current export operation",
      {
        id:
          operation.id,

        status:
          operation.status,

        objectCount:
          operation.objectCount
      }
    )

    if (
      operation.status ===
      "COMPLETED"
    ) {
      log(
        "Bulk export completed"
      )

      return operation
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      log(
        "Bulk export FAILED",
        operation
      )

      process.exit()
    }

    if (
      operation.status ===
      "CANCELED"
    ) {
      log(
        "Bulk export CANCELED",
        operation
      )

      process.exit()
    }

    attempt++

    await sleep(10000)
  }
}

async function downloadBulkFile(
  url
) {
  log("======================================")
  log("DOWNLOADING BULK FILE")
  log("======================================")

  const response =
    await axios.get(url)

  fs.writeFileSync(
    bulkOutputFilePath,
    response.data
  )

  const stats =
    fs.statSync(
      bulkOutputFilePath
    )

  log(
    "Bulk file downloaded",
    {
      path:
        bulkOutputFilePath,

      fileSize:
        stats.size
    }
  )
}

async function organizeData() {
  log("======================================")
  log("ORGANIZING CUSTOMS DATA")
  log("======================================")

  const readStream =
    fs.createReadStream(
      bulkOutputFilePath
    )

  const rl =
    readline.createInterface({
      input: readStream,
      crlfDelay: Infinity
    })

  const productsMap =
    new Map()

  let processedLines = 0
  let totalVariants = 0

  if (
    fs.existsSync(
      organizedOutputFilePath
    )
  ) {
    fs.unlinkSync(
      organizedOutputFilePath
    )
  }

  for await (const line of rl) {
    try {
      if (!line.trim()) {
        continue
      }

      const item =
        JSON.parse(line)

      processedLines++

      if (
        item.id &&
        item.id.includes(
          "Product/"
        )
      ) {
        productsMap.set(
          item.id,
          {
            productId:
              item.id,

            euHarmonizedCode:
              item.metafield
                ?.value || null
          }
        )

        continue
      }

      if (
        item.id &&
        item.id.includes(
          "ProductVariant/"
        )
      ) {
        const parentProductId =
          item.__parentId

        if (
          !productsMap.has(
            parentProductId
          )
        ) {
          continue
        }

        const parentProduct =
          productsMap.get(
            parentProductId
          )

        if (
          !parentProduct
            .euHarmonizedCode
        ) {
          continue
        }

        const inventoryItemId =
          item.inventoryItem?.id

        if (
          !inventoryItemId
        ) {
          continue
        }

        totalVariants++

        const formatted = {
          productId:
            parentProductId,

          variantId:
            item.id,

          inventoryItemId,

          euHarmonizedCode:
            parentProduct.euHarmonizedCode
        }

        fs.appendFileSync(
          organizedOutputFilePath,
          JSON.stringify(
            formatted
          ) + "\n"
        )
      }

      if (
        processedLines %
          10000 ===
        0
      ) {
        log(
          "Processing progress",
          {
            processedLines,
            totalVariants
          }
        )
      }
    } catch (error) {
      log(
        "Failed processing line"
      )

      console.log(
        error.message
      )
    }
  }

  const stats =
    fs.statSync(
      organizedOutputFilePath
    )

  log(
    "Customs data organized",
    {
      path:
        organizedOutputFilePath,

      processedLines,

      totalVariants,

      fileSize:
        stats.size
    }
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY CUSTOMS EXPORT STARTED")
  log("======================================")

  const bulkOperationId =
    await startBulkExport()

  const operation =
    await waitForBulkExport(
      bulkOperationId
    )

  await downloadBulkFile(
    operation.url
  )

  await organizeData()

  log("======================================")
  log("SHOPIFY CUSTOMS EXPORT FINISHED")
  log("======================================")
}

run()