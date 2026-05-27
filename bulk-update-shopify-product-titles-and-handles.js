const axios = require("axios")
const fs = require("fs")
const path = require("path")
const FormData = require("form-data")
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
  "shopify-product-title-migration-data"
)

const inputJsonFilePath = path.join(
  exportDataDirectory,
  "products-before-title-and-handle-update.json"
)

const bulkJsonlFilePath = path.join(
  exportDataDirectory,
  "bulk-product-title-handle-update-input.jsonl"
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

async function generateBulkJsonlFile() {
  log("Loading source JSON file...")

  if (!fs.existsSync(inputJsonFilePath)) {
    log("Input file not found", {
      path: inputJsonFilePath
    })

    process.exit()
  }

  const rawData = fs.readFileSync(
    inputJsonFilePath,
    "utf8"
  )

  const products = JSON.parse(rawData)

  log("Products loaded successfully", {
    totalProducts: products.length
  })

  const validProducts = products.filter(product =>
    product.id &&
    product.newTitle &&
    product.newHandle
  )

  log("Valid products for bulk update", {
    count: validProducts.length
  })

  const jsonlLines = validProducts.map(product =>
    JSON.stringify({
      input: {
        id: product.id,
        title: product.newTitle,
        handle: product.newHandle
      }
    })
  )

  fs.writeFileSync(
    bulkJsonlFilePath,
    jsonlLines.join("\n")
  )

  log("Bulk JSONL file generated successfully", {
    path: bulkJsonlFilePath,
    lines: jsonlLines.length
  })

  return validProducts.length
}

async function createStagedUpload() {
  log("Requesting Shopify staged upload target...")

  const mutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl

          parameters {
            name
            value
          }
        }

        userErrors {
          field
          message
        }
      }
    }
  `

  const variables = {
    input: [
      {
        resource: "BULK_MUTATION_VARIABLES",
        filename:
          "bulk-product-title-handle-update-input.jsonl",
        mimeType: "text/jsonl",
        httpMethod: "POST"
      }
    ]
  }

  const response = await client.post("", {
    query: mutation,
    variables
  })

  const result =
    response.data.data.stagedUploadsCreate

  if (result.userErrors.length > 0) {
    log("Shopify staged upload errors", {
      errors: result.userErrors
    })

    process.exit()
  }

  const target = result.stagedTargets[0]

  const stagedUploadPath =
    target.parameters.find(
      parameter => parameter.name === "key"
    )?.value

  log("Staged upload target received", {
    url: target.url,
    stagedUploadPath
  })

  return {
    ...target,
    stagedUploadPath
  }
}

async function uploadJsonlFile(target) {
  log("Uploading JSONL file to Shopify storage...")

  const form = new FormData()

  target.parameters.forEach(parameter => {
    form.append(parameter.name, parameter.value)
  })

  form.append(
    "file",
    fs.createReadStream(bulkJsonlFilePath)
  )

  await axios.post(target.url, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity
  })

  log("JSONL file uploaded successfully")
}

async function startBulkMutation(
  stagedUploadPath
) {
  log("Starting Shopify bulk mutation...")

  const mutation = `
    mutation bulkOperationRunMutation(
      $mutation: String!,
      $stagedUploadPath: String!
    ) {
      bulkOperationRunMutation(
        mutation: $mutation,
        stagedUploadPath: $stagedUploadPath
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

  const variables = {
    mutation: `
      mutation call($input: ProductUpdateInput!) {
        productUpdate(product: $input) {
          product {
            id
            title
            handle
          }

          userErrors {
            field
            message
          }
        }
      }
    `,
    stagedUploadPath
  }

  const response = await client.post("", {
    query: mutation,
    variables
  })

  const result =
    response.data.data.bulkOperationRunMutation

  if (result.userErrors.length > 0) {
    log("Bulk mutation errors", {
      errors: result.userErrors
    })

    process.exit()
  }

  log("Bulk mutation started successfully", {
    bulkOperation: result.bulkOperation
  })

  return result.bulkOperation.id
}

async function waitForBulkMutationCompletion(
  bulkOperationId
) {
  log("Waiting for Shopify bulk mutation completion...")

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
              partialDataUrl
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
        `Checking bulk mutation status #${attempt}`
      )

      log("Current bulk operation status", {
        id: operation.id,
        status: operation.status,
        objectCount: operation.objectCount,
        createdAt: operation.createdAt,
        completedAt: operation.completedAt
      })

      if (!operation) {
        log("Bulk operation not found")
        process.exit()
      }

      if (operation.status === "COMPLETED") {
        log(
          "Bulk mutation COMPLETED successfully"
        )

        return operation
      }

      if (operation.status === "FAILED") {
        log("Bulk mutation FAILED", operation)
        process.exit()
      }

      if (operation.status === "CANCELED") {
        log("Bulk mutation CANCELED", operation)
        process.exit()
      }

      log(
        `Still processing... Processed objects so far: ${operation.objectCount}`
      )

      attempt++

      await sleep(10000)
    } catch (error) {
      log(
        "Temporary polling/network error detected"
      )

      console.log(
        error.code || error.message
      )

      log(
        "Retrying status check in 10 seconds..."
      )

      await sleep(10000)
    }
  }
}

async function run() {
  log("======================================")
  log("SHOPIFY BULK TITLE UPDATE STARTED")
  log("======================================")

  const totalProducts =
    await generateBulkJsonlFile()

  log("Products prepared for bulk mutation", {
    totalProducts
  })

  const stagedTarget =
    await createStagedUpload()

  await uploadJsonlFile(stagedTarget)

  const bulkOperationId =
    await startBulkMutation(
      stagedTarget.stagedUploadPath
    )

  log("Bulk mutation operation ID", {
    bulkOperationId
  })

  const finalOperation =
    await waitForBulkMutationCompletion(
      bulkOperationId
    )

  log("======================================")
  log("SHOPIFY BULK TITLE UPDATE FINISHED")
  log("======================================")

  log("FINAL BULK UPDATE REPORT", {
    operationId: finalOperation.id,
    status: finalOperation.status,
    processedObjects:
      finalOperation.objectCount,
    completedAt: finalOperation.completedAt
  })
}

run()