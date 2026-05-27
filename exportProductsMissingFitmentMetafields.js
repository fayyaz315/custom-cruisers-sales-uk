const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOPIFY_STORE_URL =
  process.env.SHOPIFY_STORE_URL

const SHOPIFY_ACCESS_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN

const SHOPIFY_API_VERSION =
  "2026-04"

const DATA_DIR = path.join(
  __dirname,
  "shopify-fitments-data"
)

const OUTPUT_FILE =
  path.join(
    DATA_DIR,
    "products-missing-fitments.jsonl"
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

async function startBulkExport() {
  console.log(
    "\n======================================"
  )

  console.log(
    "STARTING FITMENT EXPORT"
  )

  console.log(
    "======================================"
  )

  const mutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                id
                title

                partFitments: metafield(
                  namespace: "fitments",
                  key: "part"
                ) {
                  value
                }

                idsList: metafield(
                  namespace: "fitments",
                  key: "ids_list"
                ) {
                  value
                }

                vehicleIdsList: metafield(
                  namespace: "fitments",
                  key: "vehicle_ids_list"
                ) {
                  value
                }

                informationList: metafield(
                  namespace: "fitments",
                  key: "information_list"
                ) {
                  value
                }
              }
            }
          }
        }
        """
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

  const response =
    await client.post(
      "",
      {
        query: mutation
      }
    )

  const result =
    response.data.data
      .bulkOperationRunQuery

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
    "Bulk export started"
  )

  console.log(
    `Operation ID: ${result.bulkOperation.id}`
  )

  return result.bulkOperation.id
}

async function waitForCompletion(
  operationId
) {
  console.log(
    "\nWaiting for export completion..."
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
            url
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
      return operation.url
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

async function downloadAndFilter(
  url
) {
  console.log(
    "\nDownloading export..."
  )

  const response =
    await axios.get(url, {
      responseType:
        "stream"
    })

  const writer =
    fs.createWriteStream(
      OUTPUT_FILE
    )

  return new Promise(
    (resolve, reject) => {
      let buffer = ""

      let filteredCount = 0
      let processed = 0

      response.data.on(
        "data",
        chunk => {
          buffer +=
            chunk.toString()

          const lines =
            buffer.split("\n")

          buffer =
            lines.pop()

          for (const line of lines) {
            if (!line.trim()) {
              continue
            }

            try {
              processed++

              const product =
                JSON.parse(
                  line
                )

              const hasPartFitments =
                product
                  .partFitments
                  ?.value

              if (
                !hasPartFitments
              ) {
                continue
              }

              const idsEmpty =
                !product
                  .idsList
                  ?.value

              const vehicleEmpty =
                !product
                  .vehicleIdsList
                  ?.value

              const informationEmpty =
                !product
                  .informationList
                  ?.value

              if (
                idsEmpty ||
                vehicleEmpty ||
                informationEmpty
              ) {
                writer.write(
                  JSON.stringify(
                    product
                  ) + "\n"
                )

                filteredCount++

                console.log(
                  `Missing metafields: ${product.title}`
                )
              }

              if (
                processed % 1000 ===
                0
              ) {
                console.log(
                  `Processed: ${processed}`
                )
              }
            } catch (error) {
              console.log(
                "Failed parsing line"
              )

              console.log(
                error.message
              )
            }
          }
        }
      )

      response.data.on(
        "end",
        () => {
          writer.end()

          console.log(
            `\nSaved:\n${OUTPUT_FILE}`
          )

          console.log(
            `Products needing update: ${filteredCount}`
          )

          console.log(
            `Total processed: ${processed}`
          )

          resolve()
        }
      )

      response.data.on(
        "error",
        error => {
          reject(error)
        }
      )
    }
  )
}

async function run() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    })
  }

  const operationId =
    await startBulkExport()

  const fileUrl =
    await waitForCompletion(
      operationId
    )

  await downloadAndFilter(
    fileUrl
  )

  console.log(
    "\nEXPORT COMPLETED\n"
  )
}

run().catch(error => {
  console.log(error.message)

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