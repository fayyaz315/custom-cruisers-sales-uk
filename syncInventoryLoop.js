const axios = require("axios")
require("dotenv").config()

const { getAccessToken } = require("./auth")
const fetchAvailabilityUpdates = require("./fetchAvailabilityUpdates")

const env = process.env.PARTS_ENV || "production"

const API_CONFIG = {
  production: {
    API_BASE_URL:
      process.env.PARTS_EUROPE_PROD_API_URL
  },

  sandbox: {
    API_BASE_URL:
      process.env.PARTS_EUROPE_SANDBOX_API_URL
  }
}[env]

const API_BASE_URL =
  API_CONFIG.API_BASE_URL

const SHOP =
  process.env.SHOPIFY_STORE_URL

const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN

const EU_LOCATION_ID =
  process.env.EU_LOCATION_ID

const US_LOCATION_ID =
  process.env.US_LOCATION_ID

const API_VERSION = "2026-07"

const shopifyClient = axios.create({
  baseURL:
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,

  timeout: 60000,

  headers: {
    "X-Shopify-Access-Token":
      TOKEN,

    "Content-Type":
      "application/json"
  }
})

let cachedToken = null

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

async function getValidToken() {
  if (!cachedToken) {
    console.log(
      "🔑 Fetching New Parts Europe Token..."
    )

    cachedToken =
      await getAccessToken()
  }

  return cachedToken
}

async function fetchPartDetail(
  sku
) {
  try {
    let {
      access_token,
      token_type
    } = await getValidToken()

    const makeRequest = async () => {
      return axios.get(
        `${API_BASE_URL}/v1/parts/${sku}/availability`,
        {
          headers: {
            Accept:
              "application/json",

            Authorization:
              `${token_type} ${access_token}`
          },

          timeout: 30000
        }
      )
    }

    try {
      const response =
        await makeRequest()

      return response.data
    } catch (error) {
      if (
        error.response?.status === 401
      ) {
        console.log(
          "🔑 TOKEN EXPIRED | Refreshing token..."
        )

        cachedToken = null

        const refreshed =
          await getValidToken()

        access_token =
          refreshed.access_token

        token_type =
          refreshed.token_type

        const retryResponse =
          await axios.get(
            `${API_BASE_URL}/v1/parts/${sku}/availability`,
            {
              headers: {
                Accept:
                  "application/json",

                Authorization:
                  `${token_type} ${access_token}`
              },

              timeout: 30000
            }
          )

        return retryResponse.data
      }

      throw error
    }
  } catch (error) {
    console.log(
      `❌ PARTS API ERROR | ${sku}`
    )

    console.log(
      error.response?.data ||
      error.message
    )

    return null
  }
}

async function fetchShopifyVariant(
  sku
) {
  try {
    const query = `
      query {
        productVariants(
          first: 1,
          query: "sku:${sku}"
        ) {
          edges {
            node {
              id
              sku

              inventoryItem {
                id

                inventoryLevels(
                  first: 20
                ) {
                  edges {
                    node {
                      location {
                        id
                      }

                      quantities(
                        names: ["available"]
                      ) {
                        quantity
                      }
                    }
                  }
                }
              }

              product {
                title
              }
            }
          }
        }
      }
    `

    const response =
      await shopifyClient.post(
        "",
        { query }
      )

    if (
      response.data.errors
    ) {
      console.log(
        `❌ SHOPIFY GRAPHQL ERROR | ${sku}`
      )

      console.log(
        JSON.stringify(
          response.data.errors,
          null,
          2
        )
      )

      return null
    }

    const edges =
      response.data.data
        ?.productVariants
        ?.edges || []

    if (edges.length === 0) {
      return null
    }

    return edges[0].node
  } catch (error) {
    console.log(
      `❌ SHOPIFY FETCH ERROR | ${sku}`
    )

    console.log(
      error.response?.data ||
      error.message
    )

    return null
  }
}

async function updateInventory(
  inventoryItemId,
  euQuantity,
  usQuantity,
  currentEuQuantity,
  currentUsQuantity,
  sku
) {
  try {
    const mutation = `
      mutation InventoryAdjustQuantities(
        $input: InventoryAdjustQuantitiesInput!
      ) {
        inventoryAdjustQuantities(
          input: $input
        )
        @idempotent(
          key: "${sku}-${Date.now()}"
        ) {
          inventoryAdjustmentGroup {
            createdAt

            changes {
              name
              delta
            }
          }

          userErrors {
            field
            message
          }
        }
      }
    `

    const euDelta =
      euQuantity -
      currentEuQuantity

    const usDelta =
      usQuantity -
      currentUsQuantity

    const changes = []

    if (euDelta !== 0) {
      changes.push({
        inventoryItemId,

        locationId:
          `gid://shopify/Location/${EU_LOCATION_ID}`,

        delta:
          euDelta
      })
    }

    if (usDelta !== 0) {
      changes.push({
        inventoryItemId,

        locationId:
          `gid://shopify/Location/${US_LOCATION_ID}`,

        delta:
          usDelta
      })
    }

    if (changes.length === 0) {
      return true
    }

    const variables = {
      input: {
        reason: "correction",

        name: "available",

        referenceDocumentUri:
          "logistics://parts-europe/inventory-sync",

        changes
      }
    }

    const response =
      await shopifyClient.post(
        "",
        {
          query: mutation,
          variables
        }
      )

    if (
      response.data.errors
    ) {
      console.log(
        `❌ GRAPHQL ERROR | ${sku}`
      )

      console.log(
        JSON.stringify(
          response.data.errors,
          null,
          2
        )
      )

      return false
    }

    const result =
      response.data.data
        ?.inventoryAdjustQuantities

    if (
      result?.userErrors &&
      result.userErrors.length > 0
    ) {
      console.log(
        `❌ UPDATE FAILED | ${sku}`
      )

      console.log(
        JSON.stringify(
          result.userErrors,
          null,
          2
        )
      )

      return false
    }

    return true
  } catch (error) {
    console.log(
      `❌ INVENTORY UPDATE ERROR | ${sku}`
    )

    console.log(
      error.response?.data ||
      error.message
    )

    return false
  }
}

async function processSku(
  sku,
  index,
  total
) {
  const partDetail =
    await fetchPartDetail(
      sku
    )

  if (!partDetail) {
    console.log(
      `❌ [${index}/${total}] ${sku} | Parts API Failed`
    )

    return
  }

  const euQuantity =
    partDetail.eu_availability || 0

  const usQuantity =
    partDetail.us_availability || 0

  const shopifyVariant =
    await fetchShopifyVariant(
      sku
    )

  if (!shopifyVariant) {
    console.log(
      `⚠️ [${index}/${total}] ${sku} | Shopify NOT FOUND`
    )

    return
  }

  let currentEuQuantity = 0
  let currentUsQuantity = 0

  const levels =
    shopifyVariant
      .inventoryItem
      .inventoryLevels
      .edges

  for (const level of levels) {
    const locationId =
      level.node.location.id

    const quantity =
      level.node.quantities[0]
        ?.quantity || 0

    if (
      locationId ===
      `gid://shopify/Location/${EU_LOCATION_ID}`
    ) {
      currentEuQuantity =
        quantity
    }

    if (
      locationId ===
      `gid://shopify/Location/${US_LOCATION_ID}`
    ) {
      currentUsQuantity =
        quantity
    }
  }

  if (
    currentEuQuantity ===
      euQuantity &&
    currentUsQuantity ===
      usQuantity
  ) {
    console.log(
      `✅ [${index}/${total}] ${sku} | EU: ${euQuantity} | US: ${usQuantity} | SYNCED`
    )

    return
  }

  const updated =
    await updateInventory(
      shopifyVariant
        .inventoryItem.id,

      euQuantity,

      usQuantity,

      currentEuQuantity,

      currentUsQuantity,

      sku
    )

  if (updated) {
    console.log(
      `🚀 [${index}/${total}] ${sku} | EU: ${currentEuQuantity} → ${euQuantity} | US: ${currentUsQuantity} → ${usQuantity} | UPDATED`
    )
  } else {
    console.log(
      `❌ [${index}/${total}] ${sku} | UPDATE FAILED`
    )
  }

  await sleep(300)
}

async function startInventoryLoop() {
  while (true) {
    try {
      console.log(
        "\n🌍 ==============================================="
      )

      console.log(
        "🚀 STARTING INVENTORY SYNC LOOP"
      )

      console.log(
        "🌍 ===============================================\n"
      )

      const skus =
        await fetchAvailabilityUpdates()

      console.log(
        `📦 TOTAL CHANGED SKUS: ${skus.length}\n`
      )

      let processed = 0

      for (const sku of skus) {
        processed++

        await processSku(
          sku,
          processed,
          skus.length
        )
      }

      console.log(
        "\n✅ ==============================================="
      )

      console.log(
        "🎉 INVENTORY LOOP COMPLETED"
      )

      console.log(
        "✅ ===============================================\n"
      )

      console.log(
        "⏳ Waiting 10 seconds before restarting...\n"
      )

      await sleep(10000)
    } catch (error) {
      console.log(
        "\n❌ INVENTORY LOOP ERROR"
      )

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

      console.log(
        "\n⏳ Retrying in 10 seconds...\n"
      )

      await sleep(10000)
    }
  }
}

module.exports =
  startInventoryLoop