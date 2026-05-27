const axios = require("axios")
const fs = require("fs")
const path = require("path")
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
  "shopify-product-types"
)

if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory, {
    recursive: true
  })
}

const outputFilePath = path.join(
  outputDirectory,
  "products-product-types.jsonl"
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

async function startBulkExport() {
  log("======================================")
  log("STARTING PRODUCT TYPES EXPORT")
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
                productType
                vendor
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
      query: mutation
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
      result.userErrors
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

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function waitForBulkOperation(
  operationId
) {
  log("======================================")
  log("WAITING FOR EXPORT")
  log("======================================")

  while (true) {
    const query = `
      query getOperation(
        $id: ID!
      ) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            objectCount
            url
          }
        }
      }
    `

    const variables = {
      id:
        operationId
    }

    const response =
      await client.post("", {
        query,
        variables
      })

    const operation =
      response.data.data.node

    log(
      "Current status",
      {
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
      return operation.url
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      log(
        "Export FAILED",
        operation
      )

      process.exit()
    }

    await sleep(10000)
  }
}

async function downloadFile(
  url
) {
  log("======================================")
  log("DOWNLOADING EXPORT")
  log("======================================")

  const response =
    await axios.get(url, {
      responseType:
        "stream"
    })

  const writer =
    fs.createWriteStream(
      outputFilePath
    )

  response.data.pipe(writer)

  return new Promise(
    (
      resolve,
      reject
    ) => {
      writer.on(
        "finish",
        resolve
      )

      writer.on(
        "error",
        reject
      )
    }
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY PRODUCT TYPES EXPORT STARTED")
  log("======================================")

  const operationId =
    await startBulkExport()

  const downloadUrl =
    await waitForBulkOperation(
      operationId
    )

  await downloadFile(
    downloadUrl
  )

  const stats =
    fs.statSync(
      outputFilePath
    )

  log(
    "Export completed",
    {
      path:
        outputFilePath,

      fileSize:
        stats.size
    }
  )

  log("======================================")
  log("SHOPIFY PRODUCT TYPES EXPORT FINISHED")
  log("======================================")
}

run()