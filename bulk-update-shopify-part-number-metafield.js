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

const dataDirectory = path.join(
  __dirname,
  "shopify-fitments-data"
)

const organizedJsonlPath = path.join(
  dataDirectory,
  "products-fitments-organized.jsonl"
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

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

function getChunkFileName(
  chunkNumber
) {
  return `bulk-fitments-metafields-update-${chunkNumber}.jsonl`
}

function stringifyList(
  values
) {
  return JSON.stringify(
    [
      ...new Set(
        values.map(value =>
          String(value).trim()
        )
      )
    ].filter(Boolean)
  )
}

async function generateBulkJsonlFile(
  chunkProducts,
  chunkNumber
) {
  log("======================================")
  log(`GENERATING CHUNK ${chunkNumber}`)
  log("======================================")

  const chunkFileName =
    getChunkFileName(
      chunkNumber
    )

  const bulkJsonlFilePath =
    path.join(
      dataDirectory,
      chunkFileName
    )

  const jsonlLines = []

  for (const product of chunkProducts) {
    try {
      log(
        "Preparing metafields update",
        {
          productId:
            product.productId,

          ids:
            product.ids.length,

          vehicleIds:
            product.vehicleIds.length,

          information:
            product.information.length
        }
      )

      jsonlLines.push(
        JSON.stringify({
          metafields: [
            {
              ownerId:
                product.productId,

              namespace:
                "fitments",

              key:
                "ids_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  product.ids
                )
            },

            {
              ownerId:
                product.productId,

              namespace:
                "fitments",

              key:
                "vehicle_ids_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  product.vehicleIds
                )
            },

            {
              ownerId:
                product.productId,

              namespace:
                "fitments",

              key:
                "information_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  product.information
                )
            }
          ]
        })
      )
    } catch (error) {
      log(
        "Failed preparing product"
      )

      console.log(
        error.message
      )
    }
  }

  fs.writeFileSync(
    bulkJsonlFilePath,
    jsonlLines.join("\n")
  )

  const stats =
    fs.statSync(
      bulkJsonlFilePath
    )

  log("Chunk JSONL generated", {
    path:
      bulkJsonlFilePath,

    products:
      chunkProducts.length,

    fileSize:
      stats.size
  })

  if (stats.size === 0) {
    log(
      "Generated JSONL is EMPTY"
    )

    process.exit()
  }

  return bulkJsonlFilePath
}

async function createStagedUpload(
  filename
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
        resource:
          "BULK_MUTATION_VARIABLES",

        filename,

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
    log(
      "Staged upload errors",
      {
        errors:
          result.userErrors
      }
    )

    process.exit()
  }

  const target =
    result.stagedTargets[0]

  const stagedUploadPath =
    target.parameters.find(
      parameter =>
        parameter.name ===
        "key"
    )?.value

  log("Staged upload created", {
    stagedUploadPath
  })

  return {
    ...target,
    stagedUploadPath
  }
}

async function uploadJsonlFile(
  target,
  filePath
) {
  log("======================================")
  log("UPLOADING JSONL FILE")
  log("======================================")

  const form =
    new FormData()

  target.parameters.forEach(
    parameter => {
      form.append(
        parameter.name,
        parameter.value
      )
    }
  )

  form.append(
    "file",
    fs.createReadStream(
      filePath
    )
  )

  await axios.post(
    target.url,
    form,
    {
      headers:
        form.getHeaders(),

      maxBodyLength:
        Infinity
    }
  )

  const stats =
    fs.statSync(filePath)

  log(
    "JSONL uploaded successfully",
    {
      fileSize:
        stats.size
    }
  )
}

async function startBulkMutation(
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

  const variables = {
    mutation: `
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
    `,
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
      {
        errors:
          result.userErrors
      }
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

async function waitForBulkMutationCompletion(
  bulkOperationId
) {
  log("======================================")
  log("WAITING FOR BULK MUTATION")
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
            createdAt
            completedAt
            objectCount
          }
        }
      }
    `

    const variables = {
      id:
        bulkOperationId
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
        "Bulk mutation completed successfully"
      )

      return operation
    }

    if (
      operation.status ===
      "FAILED"
    ) {
      log(
        "Bulk mutation FAILED",
        operation
      )

      process.exit()
    }

    if (
      operation.status ===
      "CANCELED"
    ) {
      log(
        "Bulk mutation CANCELED",
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

  const bulkJsonlFilePath =
    await generateBulkJsonlFile(
      chunkProducts,
      chunkNumber
    )

  const stagedTarget =
    await createStagedUpload(
      path.basename(
        bulkJsonlFilePath
      )
    )

  await uploadJsonlFile(
    stagedTarget,
    bulkJsonlFilePath
  )

  const bulkOperationId =
    await startBulkMutation(
      stagedTarget.stagedUploadPath
    )

  await waitForBulkMutationCompletion(
    bulkOperationId
  )

  log(
    `CHUNK ${chunkNumber} COMPLETED`
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY FITMENTS BULK UPDATE STARTED")
  log("======================================")

  const rawData =
    fs.readFileSync(
      organizedJsonlPath,
      "utf8"
    )

  const allProducts =
    rawData
      .split("\n")
      .filter(Boolean)
      .map(line =>
        JSON.parse(line)
      )

  log("Products loaded", {
    totalProducts:
      allProducts.length
  })

  let chunkNumber = 1

  const CHUNK_SIZE = 20000

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

    log(
      "Waiting before next chunk..."
    )

    await sleep(15000)
  }

  log("======================================")
  log("ALL CHUNKS COMPLETED")
  log("======================================")
}

run()