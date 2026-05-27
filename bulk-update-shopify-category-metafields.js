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
  "shopify-category-metafields",
  "products-category-metafields.jsonl"
)

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  "shopify-category-metafields-update"
)

if (!fs.existsSync(OUTPUT_DIRECTORY)) {
  fs.mkdirSync(OUTPUT_DIRECTORY, {
    recursive: true
  })
}

const ITEM_CONDITION_VALUE =
  JSON.stringify([
    "gid://shopify/Metaobject/508087304575"
  ])

const MANUFACTURER_TYPE_VALUE =
  JSON.stringify([
    "gid://shopify/Metaobject/508094611839"
  ])

const CHUNK_SIZE = 10000

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

function loadProducts() {
  log("======================================")
  log("LOADING PRODUCTS")
  log("======================================")

  const products =
    fs
      .readFileSync(
        INPUT_FILE,
        "utf8"
      )
      .split("\n")
      .filter(Boolean)
      .map(line =>
        JSON.parse(line)
      )

  log(
    "Products loaded",
    {
      products:
        products.length
    }
  )

  return products
}

async function createJsonlFile(
  products,
  chunkNumber
) {
  log("======================================")
  log(
    `CREATING JSONL CHUNK ${chunkNumber}`
  )
  log("======================================")

  const jsonlLines = []

  for (const product of products) {
    jsonlLines.push(
      JSON.stringify({
        metafields: [
          {
            ownerId:
              product.id,

            namespace:
              "shopify",

            key:
              "item-condition",

            type:
              "list.metaobject_reference",

            value:
              ITEM_CONDITION_VALUE
          },

          {
            ownerId:
              product.id,

            namespace:
              "shopify",

            key:
              "manufacturer-type",

            type:
              "list.metaobject_reference",

            value:
              MANUFACTURER_TYPE_VALUE
          }
        ]
      })
    )
  }

  const jsonlFilePath =
    path.join(
      OUTPUT_DIRECTORY,
      `category-metafields-update-${chunkNumber}.jsonl`
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
    "JSONL file created",
    {
      path:
        jsonlFilePath,

      products:
        products.length,

      fileSize:
        stats.size
    }
  )

  return jsonlFilePath
}

async function createStagedUpload(
  chunkNumber
) {
  log("======================================")
  log("CREATING STAGED UPLOAD")
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
          `category-metafields-update-${chunkNumber}.jsonl`,

        mimeType:
          "text/jsonl",

        httpMethod:
          "POST"
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
    console.log(
      JSON.stringify(
        result.userErrors,
        null,
        2
      )
    )

    process.exit()
  }

  return result
    .stagedTargets[0]
}

async function uploadFile(
  stagedTarget,
  filePath
) {
  log("======================================")
  log("UPLOADING FILE")
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

  log(
    "File uploaded successfully"
  )
}

async function runBulkMutation(
  stagedTarget
) {
  log("======================================")
  log("STARTING BULK MUTATION")
  log("======================================")

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
      $metafields: [MetafieldsSetInput!]!
    ) {
      metafieldsSet(
        metafields: $metafields
      ) {
        metafields {
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

async function waitForOperation(
  operationId
) {
  log("======================================")
  log("WAITING FOR BULK OPERATION")
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
          }
        }
      }
    `

    const response =
      await client.post("", {
        query,
        variables: {
          id:
            operationId
        }
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
  products,
  chunkNumber
) {
  const jsonlFilePath =
    await createJsonlFile(
      products,
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

async function run() {
  log("======================================")
  log("CATEGORY METAFIELDS BULK UPDATE")
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

    await sleep(10000)
  }

  log("======================================")
  log("ALL PRODUCTS UPDATED")
  log("======================================")
}

run()