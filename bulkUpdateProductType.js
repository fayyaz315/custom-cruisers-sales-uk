const axios = require("axios")
const fs = require("fs")
const path = require("path")
const FormData = require("form-data")
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

const INPUT_FILE = path.join(
  DATA_DIR,
  "products-type-export.jsonl"
)

const JSONL_UPDATE_FILE =
  path.join(
    DATA_DIR,
    "product-type-update.jsonl"
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

function extractProductName(
  html
) {
  if (!html) {
    return null
  }

  const regex =
    /<td><strong>Product Name<\/strong><\/td>\s*<td>(.*?)<\/td>/is

  const match =
    html.match(regex)

  if (!match) {
    return null
  }

  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

function createUpdateJsonl() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 CREATING PRODUCT TYPE UPDATE JSONL"
  )

  console.log(
    "=".repeat(100)
  )

  const lines =
    fs
      .readFileSync(
        INPUT_FILE,
        "utf8"
      )
      .split("\n")
      .filter(Boolean)

  console.log(
    `📄 Products loaded: ${lines.length}`
  )

  const updates = []

  let processed = 0
  let updated = 0
  let skipped = 0

  for (const line of lines) {
    processed++

    const product =
      JSON.parse(line)

    const productName =
      extractProductName(
        product.descriptionHtml
      )

    console.log(
      "\n" + "-".repeat(100)
    )

    console.log(
      `🔄 Processing ${processed}/${lines.length}`
    )

    console.log(
      `📦 ${product.title}`
    )

    if (!productName) {
      console.log(
        "⚠️ Product Name not found"
      )

      skipped++

      continue
    }

    console.log(
      `✅ Product Name: ${productName}`
    )

    updates.push(
      JSON.stringify({
        input: {
          id:
            product.id,

          productType:
            productName
        }
      })
    )

    updated++

    console.log(
      "✅ Update prepared"
    )
  }

  fs.writeFileSync(
    JSONL_UPDATE_FILE,
    updates.join("\n"),
    "utf8"
  )

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "📊 FINAL SUMMARY"
  )

  console.log(
    "=".repeat(100)
  )

  console.log(
    `📦 Processed: ${processed}`
  )

  console.log(
    `✅ Updates prepared: ${updated}`
  )

  console.log(
    `⚠️ Skipped: ${skipped}`
  )

  console.log(
    `💾 JSONL saved:\n${JSONL_UPDATE_FILE}`
  )
}

async function createStagedUpload() {
  console.log(
    "\n🚀 Creating staged upload..."
  )

  const mutation = `
    mutation stagedUploadsCreate(
      $input: [StagedUploadInput!]!
    ) {
      stagedUploadsCreate(
        input: $input
      ) {
        stagedTargets {
          url

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
        resource:
          "BULK_MUTATION_VARIABLES",

        filename:
          "product-type-update.jsonl",

        mimeType:
          "text/jsonl",

        httpMethod:
          "POST"
      }
    ]
  }

  const response =
    await client.post(
      "",
      {
        query: mutation,
        variables
      }
    )

  return response.data.data
    .stagedUploadsCreate
    .stagedTargets[0]
}

async function uploadJsonlFile(
  stagedTarget
) {
  console.log(
    "\n📤 Uploading JSONL..."
  )

  const formData =
    new FormData()

  for (const parameter of stagedTarget.parameters) {
    formData.append(
      parameter.name,
      parameter.value
    )
  }

  formData.append(
    "file",
    fs.createReadStream(
      JSONL_UPDATE_FILE
    )
  )

  await axios.post(
    stagedTarget.url,
    formData,
    {
      headers:
        formData.getHeaders(),

      maxBodyLength:
        Infinity
    }
  )

  console.log(
    "✅ JSONL uploaded"
  )
}

async function runBulkMutation(
  stagedTarget
) {
  console.log(
    "\n🚀 STARTING BULK PRODUCT TYPE UPDATE"
  )

  const stagedUploadPath =
    stagedTarget.parameters.find(
      parameter =>
        parameter.name ===
        "key"
    ).value

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

  const bulkMutation = `
    mutation call(
      $input: ProductInput!
    ) {
      productUpdate(
        input: $input
      ) {
        product {
          id
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
        query: mutation,

        variables: {
          mutation:
            bulkMutation,

          stagedUploadPath
        }
      }
    )

  const result =
    response.data.data
      .bulkOperationRunMutation

  console.log(
    `✅ Bulk operation started`
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
    "\n⏳ Waiting for completion..."
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
      operation.status ===
      "COMPLETED"
    ) {
      console.log(
        "\n✅ BULK UPDATE COMPLETED"
      )

      return
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      throw new Error(
        `Bulk update failed: ${operation.errorCode}`
      )
    }

    await sleep(5000)
  }
}

async function bulkUpdateProductType() {
  createUpdateJsonl()

  const stagedTarget =
    await createStagedUpload()

  await uploadJsonlFile(
    stagedTarget
  )

  const operationId =
    await runBulkMutation(
      stagedTarget
    )

  await waitForCompletion(
    operationId
  )

  console.log(
    "\n🎉 PRODUCT TYPE BULK UPDATE FINISHED\n"
  )
}

bulkUpdateProductType().catch(
  error => {
    console.log(
      "\n❌ BULK UPDATE FAILED\n"
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