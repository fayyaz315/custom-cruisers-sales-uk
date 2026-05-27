const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  timeout: 120000,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

const outputDirectory = path.join(
  __dirname,
  "shopify-taxonomy-data"
)

if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory, {
    recursive: true
  })
}

const outputFilePath = path.join(
  outputDirectory,
  "shopify-vehicle-taxonomy.json"
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

async function fetchVehicleTaxonomy() {
  log("======================================")
  log("FETCHING VEHICLE TAXONOMY")
  log("======================================")

  let hasNextPage = true
  let cursor = null

  const allCategories = []

  while (hasNextPage) {
    const query = `
      query getVehicleTaxonomy(
        $after: String
      ) {
        taxonomy {
          categories(
            first: 250,
            after: $after,
            descendantsOf: "gid://shopify/TaxonomyCategory/vp"
          ) {
            edges {
              cursor

              node {
                id
                name
                fullName
                level
                isLeaf
                parentId
                childrenIds
              }
            }

            pageInfo {
              hasNextPage
            }
          }
        }
      }
    `

    const variables = {
      after: cursor
    }

    const response =
      await client.post("", {
        query,
        variables
      })

    if (
      response.data.errors
    ) {
      console.log(
        JSON.stringify(
          response.data,
          null,
          2
        )
      )

      process.exit()
    }

    const categories =
      response.data.data
        .taxonomy
        .categories

    for (const edge of categories.edges) {
      allCategories.push({
        id:
          edge.node.id,

        name:
          edge.node.name,

        fullName:
          edge.node.fullName,

        level:
          edge.node.level,

        isLeaf:
          edge.node.isLeaf,

        parentId:
          edge.node.parentId,

        childrenIds:
          edge.node.childrenIds
      })

      cursor =
        edge.cursor
    }

    hasNextPage =
      categories.pageInfo
        .hasNextPage

    log(
      "Vehicle taxonomy progress",
      {
        categories:
          allCategories.length,

        hasNextPage
      }
    )
  }

  const leafCategories =
    allCategories.filter(
      category =>
        category.isLeaf
    )

  fs.writeFileSync(
    outputFilePath,
    JSON.stringify(
      leafCategories,
      null,
      2
    )
  )

  const stats =
    fs.statSync(
      outputFilePath
    )

  log(
    "Vehicle taxonomy export completed",
    {
      totalCategories:
        allCategories.length,

      leafCategories:
        leafCategories.length,

      path:
        outputFilePath,

      fileSize:
        stats.size
    }
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY VEHICLE TAXONOMY EXPORT STARTED")
  log("======================================")

  await fetchVehicleTaxonomy()

  log("======================================")
  log("SHOPIFY VEHICLE TAXONOMY EXPORT FINISHED")
  log("======================================")
}

run()