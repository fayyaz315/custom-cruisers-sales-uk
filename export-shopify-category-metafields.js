const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  "shopify-category-metafields"
)

if (!fs.existsSync(OUTPUT_DIRECTORY)) {
  fs.mkdirSync(OUTPUT_DIRECTORY, {
    recursive: true
  })
}

const OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  "products-category-metafields.jsonl"
)

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 120000,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

function log(message, data = null) {
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

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function startBulkExport() {
  log("======================================")
  log("STARTING CATEGORY METAFIELDS EXPORT")
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

                itemCondition: metafield(
                  namespace: "shopify",
                  key: "item-condition"
                ) {
                  id
                  type
                  value
                }

                manufacturerType: metafield(
                  namespace: "shopify",
                  key: "manufacturer-type"
                ) {
                  id
                  type
                  value
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
      query: mutation
    })

  if (response.data.errors) {
    console.log(
      JSON.stringify(
        response.data.errors,
        null,
        2
      )
    )

    process.exit()
  }

  const result =
    response.data.data
      .bulkOperationRunQuery

  if (
    result.userErrors.length >
    0
  ) {
    console.log(
      JSON.stringify(
        result.userErrors,
        null,
        2
      )
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

async function waitForBulkOperation(
  operationId
) {
  log("======================================")
  log("WAITING FOR BULK EXPORT")
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
      console.log(operation)

      process.exit()
    }

    await sleep(5000)
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
      OUTPUT_FILE
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

async function filterProducts() {
  log("======================================")
  log("FILTERING PRODUCTS")
  log("======================================")

  const lines = fs
    .readFileSync(
      OUTPUT_FILE,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  const filtered = []

  for (const line of lines) {
    const product =
      JSON.parse(line)

    if (
      product.itemCondition &&
      product.manufacturerType
    ) {
      filtered.push(product)
    }
  }

  const filteredFile =
    path.join(
      OUTPUT_DIRECTORY,
      "products-with-category-metafields.jsonl"
    )

  fs.writeFileSync(
    filteredFile,
    filtered
      .map(product =>
        JSON.stringify(product)
      )
      .join("\n")
  )

  log(
    "Filtered products saved",
    {
      products:
        filtered.length,

      path:
        filteredFile
    }
  )
}

async function run() {
  log("======================================")
  log("CATEGORY METAFIELDS EXPORT STARTED")
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

  await filterProducts()

  log("======================================")
  log("CATEGORY METAFIELDS EXPORT FINISHED")
  log("======================================")
}

run()