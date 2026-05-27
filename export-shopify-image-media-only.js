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

const exportDataDirectory = path.join(
  __dirname,
  "shopify-image-alt-text-bulk-data"
)

if (!fs.existsSync(exportDataDirectory)) {
  fs.mkdirSync(exportDataDirectory, {
    recursive: true
  })
}

const outputJsonFilePath = path.join(
  exportDataDirectory,
  "products-image-media-and-title.json"
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

async function startBulkOperation() {
  log("======================================")
  log("STARTING IMAGE MEDIA BULK EXPORT")
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
                title

                media(first: 250) {
                  edges {
                    node {
                      ... on MediaImage {
                        id
                        alt
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

  const response = await client.post("", {
    query: mutation
  })

  const result =
    response.data.data.bulkOperationRunQuery

  if (result.userErrors.length > 0) {
    log("Bulk operation errors", {
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

async function waitForCompletion(
  bulkOperationId
) {
  log("======================================")
  log("WAITING FOR BULK EXPORT")
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

      const response = await client.post("", {
        query,
        variables
      })

      const operation =
        response.data.data.node

      log(
        `Checking bulk export status #${attempt}`
      )

      log("Current bulk export status", {
        id: operation.id,
        status: operation.status,
        objectCount: operation.objectCount,
        createdAt: operation.createdAt,
        completedAt: operation.completedAt
      })

      if (operation.status === "COMPLETED") {
        log("Bulk export completed successfully")

        return operation.url
      }

      if (operation.status === "FAILED") {
        log("Bulk export FAILED", operation)

        process.exit()
      }

      if (operation.status === "CANCELED") {
        log("Bulk export CANCELED", operation)

        process.exit()
      }

      attempt++

      await sleep(10000)
    } catch (error) {
      log("Temporary polling/network error")

      console.log(
        error.code || error.message
      )

      await sleep(10000)
    }
  }
}

async function downloadAndProcessFile(
  fileUrl
) {
  log("======================================")
  log("DOWNLOADING BULK EXPORT FILE")
  log("======================================")

  const response = await axios.get(fileUrl, {
    responseType: "stream"
  })

  const tempJsonlPath = path.join(
    exportDataDirectory,
    "products-image-media-and-title.jsonl"
  )

  const writer = fs.createWriteStream(
    tempJsonlPath
  )

  response.data.pipe(writer)

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve)
    writer.on("error", reject)
  })

  log("Bulk JSONL file downloaded", {
    path: tempJsonlPath
  })

  log("======================================")
  log("PROCESSING JSONL FILE")
  log("======================================")

  const lines = fs
    .readFileSync(tempJsonlPath, "utf8")
    .split("\n")
    .filter(Boolean)

  log("JSONL lines loaded", {
    totalLines: lines.length
  })

  const productsMap = new Map()

  for (const line of lines) {
    const item = JSON.parse(line)

    if (item.__typename === "Product") {
      productsMap.set(item.id, {
        id: item.id,
        title: item.title,
        media: []
      })
    }

    if (
      item.__typename === "MediaImage" &&
      item.__parentId
    ) {
      const product =
        productsMap.get(item.__parentId)

      if (product) {
        product.media.push({
          id: item.id,
          alt: item.alt || ""
        })
      }
    }
  }

  const products = Array.from(
    productsMap.values()
  )

  let totalImages = 0

  products.forEach(product => {
    totalImages += product.media.length
  })

  log("Products processed successfully", {
    totalProducts: products.length,
    totalImages
  })

  fs.writeFileSync(
    outputJsonFilePath,
    JSON.stringify(products, null, 2)
  )

  log("Final image media JSON saved", {
    path: outputJsonFilePath
  })

  log("======================================")
  log("IMAGE MEDIA EXPORT FINISHED")
  log("======================================")
}

async function run() {
  log("======================================")
  log("SHOPIFY IMAGE MEDIA EXPORT STARTED")
  log("======================================")

  const bulkOperationId =
    await startBulkOperation()

  log("Bulk operation ID", {
    bulkOperationId
  })

  const fileUrl =
    await waitForCompletion(
      bulkOperationId
    )

  log("Bulk export file URL received")

  await downloadAndProcessFile(fileUrl)

  log("======================================")
  log("SHOPIFY IMAGE MEDIA EXPORT COMPLETED")
  log("======================================")
}

run()