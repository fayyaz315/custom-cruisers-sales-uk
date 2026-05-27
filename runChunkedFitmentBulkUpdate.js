const axios = require("axios")
const fs = require("fs")
const path = require("path")
const FormData = require("form-data")
require("dotenv").config()

const SHOP =
  process.env.SHOPIFY_STORE_URL

const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN

const API_VERSION =
  "2026-04"

const client =
  axios.create({
    baseURL:
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,

    timeout: 120000,

    headers: {
      "X-Shopify-Access-Token":
        TOKEN,

      "Content-Type":
        "application/json"
    }
  })

const dataDirectory =
  path.join(
    __dirname,
    "shopify-fitments-data"
  )

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function createStagedUpload(
  filename
) {
  console.log(
    `\nCreating staged upload for ${filename}`
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

        filename,

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

    process.exit()
  }

  return result
    .stagedTargets[0]
}

async function uploadJsonlFile(
  stagedTarget,
  filePath
) {
  console.log(
    `Uploading ${path.basename(filePath)}`
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

  console.log(
    "Upload completed"
  )
}

async function startBulkMutation(
  stagedTarget
) {
  console.log(
    "Starting bulk mutation..."
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

    process.exit()
  }

  console.log(
    `Operation ID: ${result.bulkOperation.id}`
  )

  return result.bulkOperation.id
}

async function waitForCompletion(
  operationId
) {
  console.log(
    "Waiting for completion..."
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
      `Status: ${operation.status}`
    )

    console.log(
      `Objects: ${operation.objectCount}`
    )

    if (
      operation.status ===
      "COMPLETED"
    ) {
      console.log(
        "Chunk completed"
      )

      return
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
  filename
) {
  console.log(
    "\n======================================"
  )

  console.log(
    `PROCESSING ${filename}`
  )

  console.log(
    "======================================"
  )

  const filePath =
    path.join(
      dataDirectory,
      filename
    )

  const stagedTarget =
    await createStagedUpload(
      filename
    )

  await uploadJsonlFile(
    stagedTarget,
    filePath
  )

  const operationId =
    await startBulkMutation(
      stagedTarget
    )

  await waitForCompletion(
    operationId
  )

  console.log(
    `${filename} completed`
  )
}

async function run() {
  const chunkFiles =
    fs
      .readdirSync(
        dataDirectory
      )
      .filter(file =>
        file.startsWith(
          "missing-fitments-update-"
        ) &&
        file.endsWith(
          ".jsonl"
        )
      )
      .sort()

  console.log(
    `Found ${chunkFiles.length} chunk files`
  )

  for (const file of chunkFiles) {
    await processChunk(
      file
    )

    console.log(
      "\nWaiting 10 seconds before next chunk...\n"
    )

    await sleep(10000)
  }

  console.log(
    "\nALL CHUNKS COMPLETED\n"
  )
}

run().catch(error => {
  console.log(
    error.message
  )

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
})