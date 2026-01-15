const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID
const SHOPIFY_API_VERSION = "2024-01"

const DATA_DIR = path.join(__dirname, "data")
const env = process.env.PARTS_ENV || "production"
const ORGANIZED_PRODUCTS_FILE = path.join(DATA_DIR, `organized-products-${env}.json`)
const SHOPIFY_UPLOAD_PROGRESS_FILE = path.join(DATA_DIR, "shopify-upload-progress.json")

function readJSON(file) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
})

function buildDescription(details, supplier) {
  const bulletsHTML = supplier.bullets.length
    ? `<ul>${supplier.bullets.map(b => `<li>${b}</li>`).join("")}</ul>`
    : ""

  const attributesHTML = Object.keys(supplier.attributes).length
    ? `<table>${
        Object.entries(supplier.attributes)
          .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
          .join("")
      }</table>`
    : ""

  const d = details.dimensions || {}

  const dimensionsHTML = `
<table>
<tr><td><strong>Length (mm)</strong></td><td>${d.length || ""}</td></tr>
<tr><td><strong>Width (mm)</strong></td><td>${d.width || ""}</td></tr>
<tr><td><strong>Height (mm)</strong></td><td>${d.height || ""}</td></tr>
<tr><td><strong>Weight (kg)</strong></td><td>${d.weight || ""}</td></tr>
</table>
`

  return `
<h3>Product Information</h3>
${bulletsHTML}
<h3>Product Attributes</h3>
${attributesHTML}
<h3>Dimensions</h3>
${dimensionsHTML}
`.trim()
}

function formatFitmentsForMetafield(fitments) {
  if (!fitments || !fitments.fitments || fitments.fitments.length === 0) {
    return JSON.stringify([])
  }

  const formattedFitments = fitments.fitments.map(f => ({
    id: f.id,
    vehicle_id: f.vehicle_id,
    part_number: f.part_number,
    position: f.position || "",
    information: f.information || ""
  }))

  return JSON.stringify(formattedFitments)
}

async function createProduct(product) {
  const r = await shopify.post("/products.json", { product })
  return r.data.product
}

async function setInventory(inventoryItemId, qty) {
  await shopify.post("/inventory_levels/set.json", {
    location_id: SHOPIFY_LOCATION_ID,
    inventory_item_id: inventoryItemId,
    available: qty
  })
}

async function setInventoryCost(inventoryItemId, cost) {
  await shopify.put(`/inventory_items/${inventoryItemId}.json`, {
    inventory_item: {
      id: inventoryItemId,
      cost: Number(cost),
      tracked: true
    }
  })
}

async function uploadToShopify() {
  const organizedProducts = readJSON(ORGANIZED_PRODUCTS_FILE)
  
  const progress = fs.existsSync(SHOPIFY_UPLOAD_PROGRESS_FILE)
    ? readJSON(SHOPIFY_UPLOAD_PROGRESS_FILE)
    : { last_index: 0, uploaded_products: [] }

  for (let i = progress.last_index; i < organizedProducts.length; i++) {
    const productGroup = organizedProducts[i]

    try {
      console.log(`\nUploading ${i + 1}/${organizedProducts.length}: ${productGroup.base_name}`)

      const description = buildDescription(productGroup.base_details, productGroup.base_supplier)

      const tags = [
        productGroup.base_name,
        productGroup.brand,
        productGroup.product_type
      ].filter(Boolean).join(", ")

      // Collect all unique images from variants
      const allImages = []
      const imageMap = new Map() // track which images belong to which variant
      
      productGroup.variants.forEach((variant, variantIndex) => {
        if (variant.media && variant.media.images) {
          variant.media.images.forEach(img => {
            if (!allImages.find(i => i.src === img.uri)) {
              allImages.push({ src: img.uri })
              imageMap.set(img.uri, variantIndex)
            }
          })
        }
      })

      // Build variants array
      const variants = productGroup.variants.map(variant => {
        const variantData = {
          sku: variant.part_number,
          price: variant.price,
          inventory_management: "shopify"
        }

        // Add size option if present
        if (variant.size) {
          variantData.option1 = variant.size
        }

        // Add color option if present
        if (variant.color) {
          variantData.option2 = variant.color
        }

        return variantData
      })

      // Determine options based on what variants have
      const options = []
      const hasSizes = productGroup.variants.some(v => v.size)
      const hasColors = productGroup.variants.some(v => v.color)

      if (hasSizes) {
        options.push({
          name: "Size",
          values: [...new Set(productGroup.variants.map(v => v.size).filter(Boolean))]
        })
      }

      if (hasColors) {
        options.push({
          name: "Color",
          values: [...new Set(productGroup.variants.map(v => v.color).filter(Boolean))]
        })
      }

      // Prepare product metafields (aggregate data from all variants)
      const allPartNumbers = productGroup.variants.map(v => v.part_number).join(", ")
      const allFitments = productGroup.variants.flatMap(v => v.fitments?.fitments || [])

      const product = {
        title: productGroup.base_name,
        body_html: description,
        vendor: productGroup.brand,
        product_type: productGroup.product_type,
        tags,
        variants,
        options: options.length > 0 ? options : undefined,
        images: allImages,
        metafields: [
          { namespace: "parts_europe", key: "part_numbers", type: "single_line_text_field", value: allPartNumbers },
          { namespace: "parts_europe", key: "vendor_part_number", type: "single_line_text_field", value: productGroup.vendor_part_number || "" },
          { namespace: "parts_europe", key: "brand_code", type: "single_line_text_field", value: productGroup.brand || "" },
          { namespace: "parts_europe", key: "warehouse_status", type: "single_line_text_field", value: productGroup.base_details.warehouse_status || "" },
          { namespace: "parts_europe", key: "warehouse_country", type: "single_line_text_field", value: productGroup.base_details.warehouse_country || "" },
          { namespace: "parts_europe", key: "eu_harmonized_code", type: "single_line_text_field", value: productGroup.base_details.eu_harmonized_code || "" },
          { namespace: "parts_europe", key: "us_harmonized_code", type: "single_line_text_field", value: productGroup.base_details.us_harmonized_code || "" },
          { namespace: "parts_europe", key: "com_code", type: "single_line_text_field", value: productGroup.base_details.com_code || "" },
          { namespace: "parts_europe", key: "sub_com_code", type: "single_line_text_field", value: productGroup.base_details.sub_com_code || "" },
          { namespace: "parts_europe", key: "catalog_codes", type: "single_line_text_field", value: productGroup.base_details.catalog_codes || "" },
          { namespace: "parts_europe", key: "product_code", type: "single_line_text_field", value: productGroup.product_type || "" },
          { namespace: "parts_europe", key: "software_license", type: "boolean", value: String(productGroup.base_details.software_license) },
          { namespace: "parts_europe", key: "uom", type: "single_line_text_field", value: productGroup.base_details.uom || "" },
          { namespace: "parts_europe", key: "dimensions", type: "json", value: JSON.stringify(productGroup.base_details.dimensions || {}) },
          { namespace: "parts_europe", key: "alerts", type: "json", value: JSON.stringify(productGroup.base_details.alerts || {}) },
          { namespace: "parts_europe", key: "source_link", type: "url", value: productGroup.base_details.link || "" },
          { namespace: "fitments", key: "part", type: "json", value: JSON.stringify(allFitments) },
          { namespace: "logistics", key: "length_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.length || 0) },
          { namespace: "logistics", key: "width_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.width || 0) },
          { namespace: "logistics", key: "height_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.height || 0) },
          { namespace: "logistics", key: "weight_kg", type: "number_decimal", value: String(productGroup.base_details.dimensions?.weight || 0) }
        ]
      }

      const createdProduct = await createProduct(product)

      // Set inventory and cost for each variant
      for (let j = 0; j < createdProduct.variants.length; j++) {
        const shopifyVariant = createdProduct.variants[j]
        const originalVariant = productGroup.variants[j]

        await setInventory(shopifyVariant.inventory_item_id, originalVariant.stock)
        await setInventoryCost(shopifyVariant.inventory_item_id, originalVariant.cost)
      }

      progress.uploaded_products.push({
        shopify_id: createdProduct.id,
        title: productGroup.base_name,
        variant_count: productGroup.variants.length
      })
      progress.last_index = i + 1
      saveJSON(SHOPIFY_UPLOAD_PROGRESS_FILE, progress)

      console.log(`✓ Created: ${productGroup.base_name} with ${productGroup.variants.length} variants`)

    } catch (e) {
      console.log(`✗ Failed to upload ${productGroup.base_name}: ${e.message}`)
      if (e.response) {
        console.log(JSON.stringify(e.response.data, null, 2))
      }
      break
    }
  }

  console.log(`\n✓ Upload complete! Created ${progress.uploaded_products.length} products`)
}

uploadToShopify().catch(console.error)