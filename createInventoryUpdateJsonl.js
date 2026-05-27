const fs = require("fs")
const path = require("path")
require("dotenv").config()

const env =
  process.env.PARTS_ENV ||
  "sandbox"

const DATA_DIR = path.join(
  __dirname,
  "data"
)

const SHOPIFY_EXPORT_FILE =
  path.join(
    DATA_DIR,
    "shopify-inventory-export.jsonl"
  )

const PARTS_EUROPE_FILE =
  path.join(
    DATA_DIR,
    `availability-details-${env}.json`
  )

const OUTPUT_FILE =
  path.join(
    DATA_DIR,
    "inventory-update.jsonl"
  )

function loadShopifyInventory() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "📦 LOADING SHOPIFY INVENTORY"
  )

  console.log(
    "=".repeat(100)
  )

  const skuMap = new Map()

  const lines =
    fs
      .readFileSync(
        SHOPIFY_EXPORT_FILE,
        "utf8"
      )
      .split("\n")
      .filter(Boolean)

  console.log(
    `📄 Shopify records: ${lines.length}`
  )

  for (const line of lines) {
    const record =
      JSON.parse(line)

    const sku =
      record.sku

    if (!sku) {
      continue
    }

    skuMap.set(sku, {
      sku,

      inventoryItemId:
        record.inventoryItem
          ?.id,

      inventoryQuantity:
        Number(
          record.inventoryQuantity ||
          0
        )
    })
  }

  console.log(
    `✅ SKU map created: ${skuMap.size}`
  )

  return skuMap
}

function loadPartsEuropeInventory() {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "📦 LOADING PARTS EUROPE INVENTORY"
  )

  console.log(
    "=".repeat(100)
  )

  const data =
    JSON.parse(
      fs.readFileSync(
        PARTS_EUROPE_FILE,
        "utf8"
      )
    )

  console.log(
    `📄 Parts Europe records: ${data.length}`
  )

  return data
}

function createInventoryUpdateJsonl() {
  const shopifyInventory =
    loadShopifyInventory()

  const updates =
    loadPartsEuropeInventory()

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "🚀 CREATING INVENTORY UPDATE JSONL"
  )

  console.log(
    "=".repeat(100)
  )

  const jsonlLines = []

  let matched = 0
  let changed = 0
  let skipped = 0

  for (const update of updates) {
    const sku =
      update.part_number

    const shopifyRecord =
      shopifyInventory.get(
        sku
      )

    if (!shopifyRecord) {
      console.log(
        `❌ SKU not found: ${sku}`
      )

      skipped++

      continue
    }

    matched++

    const currentQty =
      Number(
        shopifyRecord.inventoryQuantity ||
        0
      )

    const newQty =
      Number(
        update.quantity || 0
      )

    const delta =
      newQty - currentQty

    console.log(
      "\n" + "-".repeat(100)
    )

    console.log(
      `📦 SKU: ${sku}`
    )

    console.log(
      `📊 Shopify Qty: ${currentQty}`
    )

    console.log(
      `📊 Parts Europe Qty: ${newQty}`
    )

    console.log(
      `📊 Delta: ${delta}`
    )

    if (delta === 0) {
      console.log(
        "✅ Already synced"
      )

      continue
    }

    changed++

    jsonlLines.push(
      JSON.stringify({
        input: {
          reason:
            "correction",

          name:
            "available",

          changes: [
            {
              delta,

              inventoryItemId:
                shopifyRecord.inventoryItemId,

              locationId:
                process.env.SHOPIFY_LOCATION_ID
            }
          ]
        }
      })
    )

    console.log(
      `✅ Update prepared`
    )
  }

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "💾 Saving inventory update JSONL"
  )

  console.log(
    OUTPUT_FILE
  )

  fs.writeFileSync(
    OUTPUT_FILE,
    jsonlLines.join("\n"),
    "utf8"
  )

  console.log(
    "✅ Inventory update JSONL saved"
  )

  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    "📊 FINAL SUMMARY"
  )

  console.log(
    "=".repeat(100)
  )

  console.log(
    `📦 Matched SKUs: ${matched}`
  )

  console.log(
    `🔄 Changed inventory: ${changed}`
  )

  console.log(
    `⚠️ Missing SKUs: ${skipped}`
  )

  console.log(
    `💾 JSONL updates: ${jsonlLines.length}`
  )

  console.log(
    "\n🎉 INVENTORY UPDATE JSONL READY\n"
  )

  return OUTPUT_FILE
}

module.exports =
  createInventoryUpdateJsonl