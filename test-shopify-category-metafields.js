const axios = require("axios")
const FormData = require("form-data")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

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

async function getProducts() {
  log("======================================")
  log("FETCHING TEST PRODUCTS")
  log("======================================")

  const query = `
    {
      products(first: 5) {
        edges {
          node {
            id
            title

            metafield(
              namespace: "shopify",
              key: "item-condition"
            ) {
              id
            }

            metafield(
              namespace: "shopify",
              key: "manufacturer-type"
            ) {
              id
            }
          }
        }
      }
    }
  `

  const response =
    await client.post("", {
      query
    })

  const products =
    response.data.data.products.edges
      .map(edge => edge.node)
      .filter(product =>
        product.metafield &&
        product.metafield !== null
      )

  return products
}

async function createJsonlFile(
  products
) {
  log("======================================")
  log("CREATING JSONL FILE")
  log("======================================")

  const jsonlLines = []

  for (const product of products) {
    console.log(
      "\n===================="
    )

    console.log(
      "UPDATING:"
    )

    console.log(
      product.title
    )

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
      "category-metafields-test.jsonl"
    )

  fs.writeFileSync(
    jsonlFilePath,
    jsonlLines.join("\n")
  )

  return jsonlFilePath
}

async function createStagedUpload() {
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
          "category-metafields-test.jsonl",

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

async function run() {
  log("======================================")
  log("CATEGORY METAFIELDS TEST UPDATE")
  log("======================================")

  const products =
    await getProducts()

  log(
    "Products found",
    {
      products:
        products.length
    }
  )

  const jsonlFilePath =
    await createJsonlFile(
      products
    )

  const stagedTarget =
    await createStagedUpload()

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

  log("======================================")
  log("TEST UPDATE COMPLETED")
  log("======================================")
}

run()