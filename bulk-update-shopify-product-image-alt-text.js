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
  "shopify-image-alt-text-bulk-data"
)

const inputJsonlFilePath = path.join(
  dataDirectory,
  "products-image-media-and-title.jsonl"
)

const bulkJsonlFilePath = path.join(
  dataDirectory,
  "bulk-image-alt-text-update-input.jsonl"
)

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function generateBulkJsonlFile() {
  log("======================================")
  log("GENERATING BULK IMAGE ALT UPDATE FILE")
  log("======================================")

  if (!fs.existsSync(inputJsonlFilePath)) {
    log("Input JSONL file not found", {
      path: inputJsonlFilePath
    })

    process.exit()
  }

  const lines = fs
    .readFileSync(inputJsonlFilePath, "utf8")
    .split("\n")
    .filter(Boolean)

  log("Input JSONL loaded", {
    totalLines: lines.length
  })

  const productsMap = new Map()

  for (const line of lines) {
    const item = JSON.parse(line)

    if (
      item.id &&
      item.title
    ) {
      productsMap.set(item.id, {
        id: item.id,
        title: item.title,
        images: []
      })
    }

    if (
      item.__parentId &&
      item.alt !== undefined
    ) {
      const product =
        productsMap.get(item.__parentId)

      if (product) {
        product.images.push({
          id: item.id
        })
      }
    }
  }

  const products = Array.from(
    productsMap.values()
  )

  log("Products processed", {
    totalProducts: products.length
  })

  const testProducts = products
    .filter(product =>
      product.images.length > 0
    )

  log("Testing products selected", {
    selectedProducts:
      testProducts.length
  })

  const jsonlLines = []

  for (const product of testProducts) {
    log("Preparing product images", {
      productId: product.id,
      title: product.title,
      imageCount:
        product.images.length
    })

    for (
      let index = 0;
      index < product.images.length;
      index++
    ) {
      const image =
        product.images[index]

      const altText =
        `${product.title} ${index + 1}`

      log("Preparing image alt update", {
        imageId: image.id,
        altText
      })

      jsonlLines.push(
        JSON.stringify({
          media: {
            id: image.id,
            alt: altText
          }
        })
      )
    }
  }

  fs.writeFileSync(
    bulkJsonlFilePath,
    jsonlLines.join("\n")
  )

  log("Bulk image alt JSONL generated", {
    path: bulkJsonlFilePath,
    totalUpdates:
      jsonlLines.length
  })

  return jsonlLines.length
}

async function createStagedUpload() {
  log("======================================")
  log("CREATING STAGED UPLOAD")
  log("======================================")

  const mutation = `
    mutation stagedUploadsCreate(
      $input: [StagedUploadInput!]!
    ) {
      stagedUploadsCreate(input: $input) {
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
        resource: "BULK_MUTATION_VARIABLES",
        filename:
          "bulk-image-alt-text-update-input.jsonl",
        mimeType: "text/jsonl",
        httpMethod: "POST"
      }
    ]
  }

  const response = await client.post("", {
    query: mutation,
    variables
  })

  const result =
    response.data.data.stagedUploadsCreate

  if (result.userErrors.length > 0) {
    log("Staged upload errors", {
      errors: result.userErrors
    })

    process.exit()
  }

  const target =
    result.stagedTargets[0]

  const stagedUploadPath =
    target.parameters.find(
      parameter =>
        parameter.name === "key"
    )?.value

  log("Staged upload created", {
    stagedUploadPath
  })

  return {
    ...target,
    stagedUploadPath
  }
}

async function uploadJsonlFile(target) {
  log("======================================")
  log("UPLOADING JSONL FILE")
  log("======================================")

  const form = new FormData()

  target.parameters.forEach(parameter => {
    form.append(
      parameter.name,
      parameter.value
    )
  })

  form.append(
    "file",
    fs.createReadStream(
      bulkJsonlFilePath
    )
  )

  await axios.post(target.url, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity
  })

  log("JSONL upload completed")
}

async function startBulkMutation(
  stagedUploadPath
) {
  log("======================================")
  log("STARTING BULK IMAGE ALT MUTATION")
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
        $media: FileUpdateInput!
      ) {
        fileUpdate(files: [$media]) {
          files {
            id
            alt
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

  const response = await client.post("", {
    query: mutation,
    variables
  })

  const result =
    response.data.data
      .bulkOperationRunMutation

  if (result.userErrors.length > 0) {
    log("Bulk mutation errors", {
      errors: result.userErrors
    })

    process.exit()
  }

  log("Bulk mutation started", {
    operationId:
      result.bulkOperation.id,
    status:
      result.bulkOperation.status
  })

  return result.bulkOperation.id
}

async function waitForCompletion(
  bulkOperationId
) {
  log("======================================")
  log("WAITING FOR BULK MUTATION")
  log("======================================")

  let attempt = 1

  while (true) {
    try {
      const query = `
        query getBulkOperation($id: ID!) {
          node(id: $id) {
            ... on BulkOperation {
              id
              status
              errorCode
              createdAt
              completedAt
              objectCount
              fileSize
            }
          }
        }
      `

      const variables = {
        id: bulkOperationId
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

      log("Current status", {
        id: operation.id,
        status: operation.status,
        objectCount:
          operation.objectCount,
        createdAt:
          operation.createdAt,
        completedAt:
          operation.completedAt
      })

      if (
        operation.status ===
        "COMPLETED"
      ) {
        log(
          "Bulk image alt update completed successfully"
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
    } catch (error) {
      log("Temporary polling error")

      console.log(
        error.code ||
        error.message
      )

      await sleep(10000)
    }
  }
}

async function run() {
  log("======================================")
  log("SHOPIFY BULK IMAGE ALT UPDATE STARTED")
  log("======================================")

  const totalUpdates =
    await generateBulkJsonlFile()

  log("Bulk updates prepared", {
    totalUpdates
  })

  const stagedTarget =
    await createStagedUpload()

  await uploadJsonlFile(
    stagedTarget
  )

  const bulkOperationId =
    await startBulkMutation(
      stagedTarget.stagedUploadPath
    )

  log("Bulk operation ID", {
    bulkOperationId
  })

  const finalOperation =
    await waitForCompletion(
      bulkOperationId
    )

  log("======================================")
  log("SHOPIFY BULK IMAGE ALT UPDATE FINISHED")
  log("======================================")

  log("FINAL REPORT", {
    operationId:
      finalOperation.id,
    status:
      finalOperation.status,
    processedObjects:
      finalOperation.objectCount,
    completedAt:
      finalOperation.completedAt
  })
}

run()