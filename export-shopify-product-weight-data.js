const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 60000,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

const dataDirectory = path.join(
  __dirname,
  "shopify-product-weight-data"
)

if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, {
    recursive: true
  })
}

const weightJsonlPath = path.join(
  dataDirectory,
  "products-weight-data.jsonl"
)

const variantsExportJsonlPath = path.join(
  dataDirectory,
  "products-all-variants-export.jsonl"
)

const finalOrganizedJsonlPath = path.join(
  dataDirectory,
  "products-variant-weight-organized.jsonl"
)

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function startVariantExport() {
  log("======================================")
  log("STARTING ALL VARIANTS EXPORT")
  log("======================================")

  const mutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                id

                variants(first: 250) {
                  edges {
                    node {
                      id
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
        }

        userErrors {
          field
          message
        }
      }
    }
  `

  const response = await client.post("", {
    query: mutation
  })

  const result =
    response.data.data.bulkOperationRunQuery

  if (result.userErrors.length > 0) {
    log("Bulk export errors", {
      errors: result.userErrors
    })

    process.exit()
  }

  log("Bulk export started successfully", {
    operationId:
      result.bulkOperation.id,

    status:
      result.bulkOperation.status
  })

  return result.bulkOperation.id
}

async function waitForBulkOperation(
  bulkOperationId
) {
  log("======================================")
  log("WAITING FOR BULK OPERATION")
  log("======================================")

  let attempt = 1

  while (true) {
    try {
      const query = `
        query getBulkOperation($id: ID!) {
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
        id: bulkOperationId
      }

      const response =
        await client.post("", {
          query,
          variables
        })

      const operation =
        response.data.data.node

      log(
        `Checking operation status #${attempt}`
      )

      log("Current operation status", {
        id: operation.id,
        status: operation.status,
        objectCount:
          operation.objectCount,
        createdAt:
          operation.createdAt,
        completedAt:
          operation.completedAt
      })

      if (
        operation.status ===
        "COMPLETED"
      ) {
        log(
          "Bulk export completed successfully"
        )

        return operation.url
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
    } catch (error) {
      log(
        "Temporary polling error"
      )

      console.log(
        error.code ||
          error.message
      )

      await sleep(10000)
    }
  }
}

async function downloadVariantExport(
  fileUrl
) {
  log("======================================")
  log("DOWNLOADING VARIANT EXPORT")
  log("======================================")

  const response = await axios.get(fileUrl, {
    responseType: "stream"
  })

  const writer = fs.createWriteStream(
    variantsExportJsonlPath
  )

  response.data.pipe(writer)

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve)
    writer.on("error", reject)
  })

  log("Variant export downloaded", {
    path: variantsExportJsonlPath
  })
}

async function organizeVariantWeightData() {
  log("======================================")
  log("ORGANIZING VARIANT WEIGHT DATA")
  log("======================================")

  if (
    !fs.existsSync(
      weightJsonlPath
    )
  ) {
    log(
      "Weight JSONL file not found",
      {
        path:
          weightJsonlPath
      }
    )

    process.exit()
  }

  if (
    !fs.existsSync(
      variantsExportJsonlPath
    )
  ) {
    log(
      "Variant export JSONL file not found",
      {
        path:
          variantsExportJsonlPath
      }
    )

    process.exit()
  }

  const weightLines = fs
    .readFileSync(
      weightJsonlPath,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  const variantLines = fs
    .readFileSync(
      variantsExportJsonlPath,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  log("Input files loaded", {
    weightRecords:
      weightLines.length,

    variantRecords:
      variantLines.length
  })

  const weightMap = new Map()

  for (const line of weightLines) {
    try {
      const item =
        JSON.parse(line)

      weightMap.set(
        item.productId,
        item.weightKg
      )
    } catch (error) {
      log(
        "Failed parsing weight line"
      )

      console.log(
        error.message
      )
    }
  }

  log("Weight map created", {
    totalWeightProducts:
      weightMap.size
  })

  const organizedLines = []

  let totalVariants = 0
  let matchedVariants = 0
  let skippedVariants = 0

  for (const line of variantLines) {
    try {
      const item =
        JSON.parse(line)

      if (
        item.__parentId &&
        item.id.includes(
          "ProductVariant"
        )
      ) {
        totalVariants++

        const productId =
          item.__parentId

        const variantId =
          item.id

        const weightKg =
          weightMap.get(
            productId
          )

        if (!weightKg) {
          skippedVariants++

          continue
        }

        matchedVariants++

        log(
          "Preparing variant weight record",
          {
            productId,
            variantId,
            weightKg
          }
        )

        organizedLines.push(
          JSON.stringify({
            variantId,
            productId,
            weightKg
          })
        )

        if (
          matchedVariants %
            1000 ===
          0
        ) {
          log(
            "Organization progress",
            {
              matchedVariants,
              skippedVariants,
              totalVariants
            }
          )
        }
      }
    } catch (error) {
      log(
        "Failed processing variant line"
      )

      console.log(
        error.message
      )
    }
  }

  fs.writeFileSync(
    finalOrganizedJsonlPath,
    organizedLines.join("\n")
  )

  log(
    "Final organized variant weight JSONL saved",
    {
      path:
        finalOrganizedJsonlPath,

      totalVariantRecords:
        organizedLines.length
    }
  )

  log("======================================")
  log("FINAL REPORT")
  log("======================================")

  log(
    "Variant organization summary",
    {
      totalVariants,
      matchedVariants,
      skippedVariants
    }
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY VARIANT EXPORT STARTED")
  log("======================================")

  const bulkOperationId =
    await startVariantExport()

  log("Bulk operation ID", {
    bulkOperationId
  })

  const fileUrl =
    await waitForBulkOperation(
      bulkOperationId
    )

  log("Bulk export URL received")

  await downloadVariantExport(
    fileUrl
  )

  await organizeVariantWeightData()

  log("======================================")
  log("SHOPIFY VARIANT EXPORT FINISHED")
  log("======================================")
}

run()