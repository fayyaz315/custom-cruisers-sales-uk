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
  "shopify-product-weight-data"
)

if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, {
    recursive: true
  })
}

const organizedVariantWeightJsonlPath = path.join(
  dataDirectory,
  "products-variant-weight-organized.jsonl"
)

const groupedBulkMutationJsonlPath = path.join(
  dataDirectory,
  "bulk-product-variants-weight-update.jsonl"
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

async function generateGroupedBulkJsonl() {
  log("======================================")
  log("GENERATING GROUPED BULK JSONL")
  log("======================================")

  if (
    !fs.existsSync(
      organizedVariantWeightJsonlPath
    )
  ) {
    log(
      "Organized variant JSONL not found",
      {
        path:
          organizedVariantWeightJsonlPath
      }
    )

    process.exit()
  }

  const lines = fs
    .readFileSync(
      organizedVariantWeightJsonlPath,
      "utf8"
    )
    .split("\n")
    .filter(Boolean)

  log("Variant weight JSONL loaded", {
    totalLines:
      lines.length
  })

  const groupedProducts =
    new Map()

  let processedVariants = 0

  for (const line of lines) {
    try {
      const item =
        JSON.parse(line)

      processedVariants++

      if (
        !groupedProducts.has(
          item.productId
        )
      ) {
        groupedProducts.set(
          item.productId,
          {
            productId:
              item.productId,

            variants: []
          }
        )
      }

      const product =
        groupedProducts.get(
          item.productId
        )

      product.variants.push({
        id:
          item.variantId,

        inventoryItem: {
          measurement: {
            weight: {
              value:
                parseFloat(
                  item.weightKg
                ),

              unit:
                "KILOGRAMS"
            }
          }
        }
      })

      log(
        "Prepared variant weight",
        {
          productId:
            item.productId,

          variantId:
            item.variantId,

          weightKg:
            item.weightKg
        }
      )

      if (
        processedVariants %
          1000 ===
        0
      ) {
        log(
          "Grouping progress",
          {
            processedVariants,
            groupedProducts:
              groupedProducts.size
          }
        )
      }
    } catch (error) {
      log(
        "Failed processing variant line"
      )

      console.log(
        error.message
      )
    }
  }

  const groupedLines = []

  for (const [
    productId,
    productData
  ] of groupedProducts) {
    groupedLines.push(
      JSON.stringify({
        productId,

        variants:
          productData.variants
      })
    )
  }

  fs.writeFileSync(
    groupedBulkMutationJsonlPath,
    groupedLines.join("\n")
  )

  log(
    "Grouped bulk mutation JSONL generated successfully",
    {
      path:
        groupedBulkMutationJsonlPath,

      totalProducts:
        groupedLines.length
    }
  )

  return groupedLines.length
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
        resource:
          "BULK_MUTATION_VARIABLES",

        filename:
          "bulk-product-variants-weight-update.jsonl",

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
    "Staged upload target created",
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
  target
) {
  log("======================================")
  log("UPLOADING BULK JSONL")
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
      groupedBulkMutationJsonlPath
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
    "Bulk JSONL uploaded successfully"
  )
}

async function startBulkMutation(
  stagedUploadPath
) {
  log("======================================")
  log("STARTING BULK WEIGHT MUTATION")
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
        $productId: ID!,
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(
          productId: $productId,
          variants: $variants
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
    "Bulk mutation started successfully",
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
        `Checking mutation status #${attempt}`
      )

      log("Current mutation status", {
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
          "Bulk variant weight update completed successfully"
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
      log(
        "Temporary polling error"
      )

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
  log("SHOPIFY BULK VARIANT WEIGHT UPDATE STARTED")
  log("======================================")

  const totalProducts =
    await generateGroupedBulkJsonl()

  log(
    "Grouped product updates prepared",
    {
      totalProducts
    }
  )

  const stagedTarget =
    await createStagedUpload()

  await uploadJsonlFile(
    stagedTarget
  )

  const bulkOperationId =
    await startBulkMutation(
      stagedTarget.stagedUploadPath
    )

  log("Bulk mutation operation ID", {
    bulkOperationId
  })

  const finalOperation =
    await waitForBulkOperation(
      bulkOperationId
    )

  log("======================================")
  log("SHOPIFY BULK VARIANT WEIGHT UPDATE FINISHED")
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