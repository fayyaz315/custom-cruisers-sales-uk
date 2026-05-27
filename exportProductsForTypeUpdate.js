const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOPIFY_STORE_URL =
  process.env.SHOPIFY_STORE_URL

const SHOPIFY_ACCESS_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN

const SHOPIFY_API_VERSION =
  "2026-04"

const DATA_DIR = path.join(
  __dirname,
  "data"
)

const OUTPUT_FILE =
  path.join(
    DATA_DIR,
    "products-type-export.jsonl"
  )

const client =
  axios.create({
    baseURL:
      `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,

    timeout: 120000,

    headers: {
      "X-Shopify-Access-Token":
        SHOPIFY_ACCESS_TOKEN,

      "Content-Type":
        "application/json"
    }
  })

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function startBulkExport() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 STARTING PRODUCT EXPORT"
  )

  console.log(
    "=".repeat(100)
  )

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
                descriptionHtml
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
    await client.post(
      "",
      {
        query: mutation
      }
    )

  const result =
    response.data.data
      .bulkOperationRunQuery

  if (
    result.userErrors &&
    result.userErrors.length > 0
  ) {
    console.log(
      JSON.stringify(
        result.userErrors,
        null,
        2
      )
    )

    throw new Error(
      "Bulk export failed"
    )
  }

  console.log(
    "✅ Bulk export started"
  )

  console.log(
    `📦 Operation ID: ${result.bulkOperation.id}`
  )

  return result.bulkOperation.id
}

async function waitForCompletion(
  operationId
) {
  console.log(
    "\n⏳ Waiting for export completion..."
  )

  while (true) {
    const query = `
      query {
        node(id: "${operationId}") {
          ... on BulkOperation {
            id
            status
            errorCode
            objectCount
            fileSize
            url
          }
        }
      }
    `

    const response =
      await client.post(
        "",
        {
          query
        }
      )

    const operation =
      response.data.data.node

    console.log(
      "\n" + "-".repeat(100)
    )

    console.log(
      `📊 Status: ${operation.status}`
    )

    console.log(
      `📦 Objects: ${operation.objectCount}`
    )

    if (
      operation.fileSize
    ) {
      console.log(
        `💾 File size: ${operation.fileSize}`
      )
    }

    if (
      operation.status ===
      "COMPLETED"
    ) {
      console.log(
        "\n✅ Export completed"
      )

      return operation.url
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      throw new Error(
        `Bulk export failed: ${operation.errorCode}`
      )
    }

    await sleep(5000)
  }
}

async function downloadFile(
  url
) {
  console.log(
    "\n📥 Downloading export file..."
  )

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
    (resolve, reject) => {
      writer.on(
        "finish",
        () => {
          console.log(
            `✅ Export saved:\n${OUTPUT_FILE}`
          )

          resolve()
        }
      )

      writer.on(
        "error",
        reject
      )
    }
  )
}

async function exportProductsForTypeUpdate() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    })
  }

  const operationId =
    await startBulkExport()

  const fileUrl =
    await waitForCompletion(
      operationId
    )

  await downloadFile(
    fileUrl
  )

  console.log(
    "\n🎉 PRODUCT EXPORT FINISHED\n"
  )
}

exportProductsForTypeUpdate().catch(
  error => {
    console.log(
      "\n❌ EXPORT FAILED\n"
    )

    console.log(error.message)

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
)