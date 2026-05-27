const axios = require("axios")
const fs = require("fs")
const path = require("path")
const FormData = require("form-data")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const START_INDEX = 0
const END_INDEX = 50000

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 120000,
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
      JSON.stringify(data, null, 2)
    )
  }
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

function getChunkFileName(
  start,
  end
) {
  return `bulk-fitments-metafields-update-${start}-${end}.jsonl`
}

async function generateBulkJsonl(
  chunkStart,
  chunkEnd
) {
  log("======================================")
  log("GENERATING BULK JSONL")
  log("======================================")

  if (
    !fs.existsSync(
      organizedJsonlPath
    )
  ) {
    log(
      "Organized fitments JSONL not found",
      {
        path:
          organizedJsonlPath
      }
    )

    process.exit()
  }

  const allLines = fs
    .readFileSync(
      organizedJsonlPath,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  log("All organized lines loaded", {
    totalLines:
      allLines.length
  })

  const lines =
    allLines.slice(
      chunkStart,
      chunkEnd
    )

  log("Chunk selected", {
    chunkStart,
    chunkEnd,
    chunkSize:
      lines.length
  })

  const chunkFileName =
    getChunkFileName(
      chunkStart,
      chunkEnd
    )

  const bulkMutationJsonlPath =
    path.join(
      dataDirectory,
      chunkFileName
    )

  const writeStream =
    fs.createWriteStream(
      bulkMutationJsonlPath
    )

  let processedProducts = 0

  for (const line of lines) {
    try {
      const item =
        JSON.parse(line)

      processedProducts++

      log(
        "Preparing metafields",
        {
          productId:
            item.productId,

          ids:
            item.ids.length,

          vehicleIds:
            item.vehicleIds.length,

          information:
            item.information.length
        }
      )

      const metafields = [
        {
          ownerId:
            item.productId,

          namespace:
            "fitments",

          key:
            "ids",

          type:
            "json",

          value:
            JSON.stringify(
              item.ids
            )
        },

        {
          ownerId:
            item.productId,

          namespace:
            "fitments",

          key:
            "vehicle_ids",

          type:
            "json",

          value:
            JSON.stringify(
              item.vehicleIds
            )
        },

        {
          ownerId:
            item.productId,

          namespace:
            "fitments",

          key:
            "information",

          type:
            "json",

          value:
            JSON.stringify(
              item.information
            )
        }
      ]

      writeStream.write(
        JSON.stringify({
          metafields
        }) + "\n"
      )

      if (
        processedProducts %
          1000 ===
        0
      ) {
        log(
          "JSONL generation progress",
          {
            processedProducts
          }
        )
      }
    } catch (error) {
      log(
        "Failed generating line"
      )

      console.log(
        error.message
      )
    }
  }

  await new Promise(resolve => {
    writeStream.end(resolve)
  })

  const stats =
    fs.statSync(
      bulkMutationJsonlPath
    )

  log(
    "Chunk JSONL generated",
    {
      path:
        bulkMutationJsonlPath,

      processedProducts,

      fileSize:
        stats.size
    }
  )

  if (stats.size === 0) {
    log(
      "Generated JSONL is EMPTY"
    )

    process.exit()
  }

  return {
    path:
      bulkMutationJsonlPath,

    processedProducts
  }
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

  log(
    "Staged upload created",
    {
      stagedUploadPath
    }
  )

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
  log("UPLOADING JSONL")
  log("======================================")

  const stats =
    fs.statSync(filePath)

  log("JSONL file stats", {
    bytes:
      stats.size
  })

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

  log(
    "JSONL uploaded successfully"
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

async function waitForBulkOperation(
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
            fileSize
            url
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
      `Checking bulk mutation status #${attempt}`
    )

    log(
      "Current status",
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
  start,
  end
) {
  log("======================================")
  log(
    `PROCESSING CHUNK ${start} → ${end}`
  )
  log("======================================")

  const generatedFile =
    await generateBulkJsonl(
      start,
      end
    )

  const stagedTarget =
    await createStagedUpload(
      path.basename(
        generatedFile.path
      )
    )

  await uploadJsonlFile(
    stagedTarget,
    generatedFile.path
  )

  const bulkOperationId =
    await startBulkMutation(
      stagedTarget.stagedUploadPath
    )

  log("Bulk operation ID", {
    bulkOperationId
  })

  const finalOperation =
    await waitForBulkOperation(
      bulkOperationId
    )

  log("Chunk completed", {
    start,
    end,
    operationId:
      finalOperation.id
  })
}

async function run() {
  log("======================================")
  log("SHOPIFY FITMENTS BULK UPDATE STARTED")
  log("======================================")

  const allLines = fs
    .readFileSync(
      organizedJsonlPath,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  const totalProducts =
    allLines.length

  const CHUNK_SIZE = 50000

  log("Chunk configuration", {
    totalProducts,
    chunkSize:
      CHUNK_SIZE
  })

  for (
    let start = START_INDEX;
    start < totalProducts;
    start += CHUNK_SIZE
  ) {
    const end =
      Math.min(
        start +
          CHUNK_SIZE,
        totalProducts
      )

    await processChunk(
      start,
      end
    )

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