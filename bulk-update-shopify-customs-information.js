const axios = require("axios")
const FormData = require("form-data")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const INPUT_FILE = path.join(
  __dirname,
  "shopify-customs-data",
  "products-customs-organized.jsonl"
)

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  "shopify-customs-update"
)

if (!fs.existsSync(OUTPUT_DIRECTORY)) {
  fs.mkdirSync(OUTPUT_DIRECTORY, {
    recursive: true
  })
}

const CHUNK_SIZE = 20000

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 120000,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

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

function formatHsCode(code) {
  if (!code) {
    return null
  }

  const digits = String(code)
    .replace(/\D/g, "")
    .slice(0, 6)

  if (digits.length < 6) {
    return null
  }

  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`
}

function loadProducts() {
  log("======================================")
  log("LOADING CUSTOMS DATA")
  log("======================================")

  const lines = fs
    .readFileSync(
      INPUT_FILE,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  const products =
    lines.map(line =>
      JSON.parse(line)
    )

  log(
    "Customs data loaded",
    {
      products:
        products.length
    }
  )

  return products
}

async function createStagedUpload(
  chunkNumber
) {
  log("======================================")
  log(
    `CREATING STAGED UPLOAD ${chunkNumber}`
  )
  log("======================================")

  const mutation = `
    mutation stagedUploadsCreate(
      $input: [StagedUploadInput!]!
    ) {
      stagedUploadsCreate(
        input: $input
      ) {
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
        filename:
          `bulk-customs-update-${chunkNumber}.jsonl`,

        mimeType:
          "text/jsonl",

        httpMethod:
          "POST",

        resource:
          "BULK_MUTATION_VARIABLES"
      }
    ]
  }

  const response =
    await client.post("", {
      query: mutation,
      variables
    })

  const result =
    response.data.data
      .stagedUploadsCreate

  if (
    result.userErrors.length >
    0
  ) {
    log(
      "Staged upload errors",
      result.userErrors
    )

    process.exit()
  }

  const stagedTarget =
    result.stagedTargets[0]

  const stagedUploadPath =
    stagedTarget.parameters.find(
      parameter =>
        parameter.name ===
        "key"
    ).value

  log(
    "Staged upload created",
    {
      stagedUploadPath
    }
  )

  return {
    stagedTarget,
    stagedUploadPath
  }
}

async function uploadJsonlFile(
  stagedTarget,
  filePath
) {
  log("======================================")
  log("UPLOADING JSONL FILE")
  log("======================================")

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

  const response =
    await axios.post(
      stagedTarget.url,
      formData,
      {
        headers:
          formData.getHeaders(),

        maxBodyLength:
          Infinity,

        maxContentLength:
          Infinity
      }
    )

  log(
    "JSONL uploaded successfully",
    {
      status:
        response.status
    }
  )
}

async function runBulkMutation(
  stagedUploadPath
) {
  log("======================================")
  log("STARTING BULK MUTATION")
  log("======================================")

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
      $id: ID!,
      $input: InventoryItemInput!
    ) {
      inventoryItemUpdate(
        id: $id,
        input: $input
      ) {
        inventoryItem {
          id
        }

        userErrors {
          field
          message
        }
      }
    }
  `

  const variables = {
    mutation:
      bulkMutation,

    stagedUploadPath
  }

  const response =
    await client.post("", {
      query: mutation,
      variables
    })

  const result =
    response.data.data
      .bulkOperationRunMutation

  if (
    result.userErrors.length >
    0
  ) {
    log(
      "Bulk mutation errors",
      result.userErrors
    )

    process.exit()
  }

  log(
    "Bulk mutation started",
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
  log("WAITING FOR BULK OPERATION")
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
            objectCount
            fileSize
            createdAt
            completedAt
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
      `Checking status #${attempt}`
    )

    log(
      "Current operation",
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
        "Bulk operation completed"
      )

      return
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      log(
        "Bulk operation FAILED",
        operation
      )

      process.exit()
    }

    if (
      operation.status ===
      "CANCELED"
    ) {
      log(
        "Bulk operation CANCELED",
        operation
      )

      process.exit()
    }

    attempt++

    await sleep(10000)
  }
}

async function processChunk(
  chunkProducts,
  chunkNumber
) {
  log("======================================")
  log(
    `PROCESSING CHUNK ${chunkNumber}`
  )
  log("======================================")

  const jsonlLines = []

  for (const product of chunkProducts) {
    const formattedHsCode =
      formatHsCode(
        product.euHarmonizedCode
      )

    if (!formattedHsCode) {
      continue
    }

    jsonlLines.push(
      JSON.stringify({
        id:
          product.inventoryItemId,

        input: {
          countryCodeOfOrigin:
            "GB",

          harmonizedSystemCode:
            formattedHsCode
        }
      })
    )
  }

  const jsonlFilePath = path.join(
    OUTPUT_DIRECTORY,
    `bulk-customs-update-${chunkNumber}.jsonl`
  )

  fs.writeFileSync(
    jsonlFilePath,
    jsonlLines.join("\n")
  )

  const stats =
    fs.statSync(
      jsonlFilePath
    )

  log(
    "Chunk JSONL generated",
    {
      path:
        jsonlFilePath,

      products:
        jsonlLines.length,

      fileSize:
        stats.size
    }
  )

  const {
    stagedTarget,
    stagedUploadPath
  } =
    await createStagedUpload(
      chunkNumber
    )

  await uploadJsonlFile(
    stagedTarget,
    jsonlFilePath
  )

  const operationId =
    await runBulkMutation(
      stagedUploadPath
    )

  await waitForBulkOperation(
    operationId
  )

  log(
    `CHUNK ${chunkNumber} COMPLETED`
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY CUSTOMS UPDATE STARTED")
  log("======================================")

  const allProducts =
    loadProducts()

  let chunkNumber = 1

  for (
    let i = 0;
    i < allProducts.length;
    i += CHUNK_SIZE
  ) {
    const chunkProducts =
      allProducts.slice(
        i,
        i + CHUNK_SIZE
      )

    await processChunk(
      chunkProducts,
      chunkNumber
    )

    chunkNumber++
  }

  log("======================================")
  log("SHOPIFY CUSTOMS UPDATE FINISHED")
  log("======================================")
}

run()