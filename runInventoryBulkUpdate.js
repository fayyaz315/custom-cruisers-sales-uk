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
  "inventory-update.jsonl"
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

async function createStagedUpload() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 CREATING STAGED UPLOAD"
  )

  console.log(
    "=".repeat(100)
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
          "inventory-update.jsonl",

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

  const result =
    response.data.data
      .stagedUploadsCreate

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
      "Failed to create staged upload"
    )
  }

  console.log(
    "✅ Staged upload created"
  )

  return result
    .stagedTargets[0]
}

async function uploadJsonlFile(
  stagedTarget
) {
  console.log(
    "\n📤 Uploading inventory JSONL..."
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
      INPUT_FILE
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
    "\n🚀 STARTING INVENTORY BULK UPDATE"
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
      $input: InventoryAdjustQuantitiesInput!
    ) {
      inventoryAdjustQuantities(
        input: $input
      ) {
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
      "Bulk mutation failed"
    )
  }

  console.log(
    "✅ Bulk inventory update started"
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
    "\n⏳ Waiting for inventory update completion..."
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
        "\n✅ Inventory update completed"
      )

      return
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      throw new Error(
        `Inventory update failed: ${operation.errorCode}`
      )
    }

    await sleep(5000)
  }
}

async function runInventoryBulkUpdate() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `JSONL file missing:\n${INPUT_FILE}`
    )
  }

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
    "\n🎉 INVENTORY BULK UPDATE FINISHED\n"
  )
}

module.exports =
  runInventoryBulkUpdate