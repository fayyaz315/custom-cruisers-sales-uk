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

const LOCATION_ID =
  process.env.SHOPIFY_LOCATION_ID

const env =
  process.env.PARTS_ENV ||
  "sandbox"

const INPUT_FILE = path.join(
  __dirname,
  "data",
  `availability-details-${env}.json`
)

const OUTPUT_DIRECTORY =
  path.join(
    __dirname,
    "data",
    "inventory-sync"
  )

if (
  !fs.existsSync(
    OUTPUT_DIRECTORY
  )
) {
  fs.mkdirSync(
    OUTPUT_DIRECTORY,
    {
      recursive: true
    }
  )
}

const CHUNK_SIZE = 5000

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

function log(
  message,
  data = null
) {
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

function loadInventoryData() {
  log(
    "======================================"
  )

  log(
    "LOADING INVENTORY DATA"
  )

  log(
    "======================================"
  )

  const data =
    JSON.parse(
      fs.readFileSync(
        INPUT_FILE,
        "utf8"
      )
    )

  log(
    "Inventory records loaded",
    {
      records:
        data.length
    }
  )

  return data
}

async function getVariantBySku(
  sku
) {
  const query = `
    query getVariant(
      $query: String!
    ) {
      productVariants(
        first: 1,
        query: $query
      ) {
        edges {
          node {
            id
            sku

            inventoryQuantity

            inventoryItem {
              id
            }
          }
        }
      }
    }
  `

  const variables = {
    query: `sku:${sku}`
  }

  const response =
    await client.post(
      "",
      {
        query,
        variables
      }
    )

  const edge =
    response.data.data
      .productVariants.edges[0]

  if (!edge) {
    return null
  }

  return edge.node
}

async function createJsonlFile(
  records,
  chunkNumber
) {
  log(
    "======================================"
  )

  log(
    `CREATING JSONL CHUNK ${chunkNumber}`
  )

  log(
    "======================================"
  )

  const jsonlLines = []

  let processed = 0

  for (const record of records) {
    processed++

    const sku =
      record.part_number

    console.log(
      `Checking ${processed}/${records.length} | ${sku}`
    )

    const variant =
      await getVariantBySku(
        sku
      )

    if (!variant) {
      console.log(
        `❌ Variant not found for SKU ${sku}`
      )

      continue
    }

    const currentQty =
      variant.inventoryQuantity ||
      0

    const newQty =
      record.quantity || 0

    const delta =
      newQty - currentQty

    if (delta === 0) {
      console.log(
        `✅ Already synced ${sku}`
      )

      continue
    }

    console.log(
      `🔄 ${sku} | Shopify: ${currentQty} | New: ${newQty} | Delta: ${delta}`
    )

    jsonlLines.push(
      JSON.stringify({
        input: {
          reason:
            "correction",

          name:
            "available",

          changes: [
            {
              delta,

              inventoryItemId:
                variant.inventoryItem.id,

              locationId:
                LOCATION_ID
            }
          ]
        }
      })
    )

    await sleep(100)
  }

  const jsonlFilePath =
    path.join(
      OUTPUT_DIRECTORY,
      `inventory-sync-${chunkNumber}.jsonl`
    )

  fs.writeFileSync(
    jsonlFilePath,
    jsonlLines.join("\n")
  )

  log(
    "JSONL generated",
    {
      path:
        jsonlFilePath,

      updates:
        jsonlLines.length
    }
  )

  return jsonlFilePath
}

async function createStagedUpload(
  chunkNumber
) {
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
          `inventory-sync-${chunkNumber}.jsonl`,

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

async function uploadFile(
  stagedTarget,
  filePath
) {
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
      filePath
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
}

async function runBulkMutation(
  stagedTarget
) {
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

  return response.data.data
    .bulkOperationRunMutation
    .bulkOperation.id
}

async function waitForOperation(
  operationId
) {
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
          }
        }
      }
    `

    const response =
      await client.post(
        "",
        {
          query,

          variables: {
            id:
              operationId
          }
        }
      )

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
      break
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

async function processChunk(
  records,
  chunkNumber
) {
  const jsonlFilePath =
    await createJsonlFile(
      records,
      chunkNumber
    )

  const stagedTarget =
    await createStagedUpload(
      chunkNumber
    )

  await uploadFile(
    stagedTarget,
    jsonlFilePath
  )

  const operationId =
    await runBulkMutation(
      stagedTarget
    )

  await waitForOperation(
    operationId
  )

  log(
    `CHUNK ${chunkNumber} COMPLETED`
  )
}

async function syncInventoryBulk() {
  log(
    "======================================"
  )

  log(
    "STARTING INVENTORY BULK SYNC"
  )

  log(
    "======================================"
  )

  const allRecords =
    loadInventoryData()

  let chunkNumber = 1

  for (
    let i = 0;
    i < allRecords.length;
    i += CHUNK_SIZE
  ) {
    const chunk =
      allRecords.slice(
        i,
        i + CHUNK_SIZE
      )

    await processChunk(
      chunk,
      chunkNumber
    )

    chunkNumber++

    await sleep(5000)
  }

  log(
    "======================================"
  )

  log(
    "INVENTORY SYNC FINISHED"
  )

  log(
    "======================================"
  )
}

module.exports =
  syncInventoryBulk