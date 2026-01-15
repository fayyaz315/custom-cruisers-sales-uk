const axios = require("axios")
const fs = require("fs")
const path = require("path")
const cheerio = require("cheerio")
require("dotenv").config()

const { getAccessToken } = require("./auth")

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID
const SHOPIFY_API_VERSION = "2024-01"

const env = process.env.PARTS_ENV || "production"
const API_BASE_URL = env === "sandbox"
  ? process.env.PARTS_EUROPE_SANDBOX_API_URL
  : process.env.PARTS_EUROPE_PROD_API_URL

const DATA_DIR = path.join(__dirname, "data")
const PARTS_FILE = path.join(DATA_DIR, `parts-${env}.json`)
const PROGRESS_FILE = path.join(DATA_DIR, "shopify-progress.json")

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function readJSON(file) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2))
}

const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
})

async function getPartDetails(token, type, part) {
  const r = await axios.get(`${API_BASE_URL}/v1/parts/${part}`, {
    headers: { Authorization: `${type} ${token}` }
  })
  return r.data
}

async function getPartMedia(token, type, part) {
  const r = await axios.get(`${API_BASE_URL}/v1/parts/${part}/media`, {
    headers: { Authorization: `${type} ${token}` }
  })
  return r.data
}

async function getPartPrice(token, type, part) {
  const r = await axios.get(`${API_BASE_URL}/v1/parts/${part}/price`, {
    headers: { Authorization: `${type} ${token}` }
  })
  return r.data
}

async function getPartAvailability(token, type, part) {
  const r = await axios.get(`${API_BASE_URL}/v1/parts/${part}/availability`, {
    headers: { Authorization: `${type} ${token}` }
  })
  return r.data
}

async function getPartFitments(token, type, partNumber) {
  try {
    const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}/fitments`, {
      headers: { Authorization: `${type} ${token}` }
    })
    return r.data
  } catch (e) {
    console.log(`Failed to fetch fitments for ${partNumber}: ${e.message}`)
    return { fitments: [] }
  }
}

function formatFitmentsForMetafield(fitments) {
  if (!fitments || !fitments.fitments || fitments.fitments.length === 0) {
    return JSON.stringify([])
  }

  // Format fitments data for storage
  const formattedFitments = fitments.fitments.map(f => ({
    id: f.id,
    vehicle_id: f.vehicle_id,
    part_number: f.part_number,
    position: f.position || "",
    information: f.information || ""
  }))

  return JSON.stringify(formattedFitments)
}

async function scrapeSupplierPage(url) {
  const r = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  })

  const $ = cheerio.load(r.data)

  const bullets = []
  $(".product-features li").each((_, el) => {
    const t = $(el).text().trim()
    if (t) bullets.push(t)
  })

  const attributes = {}
  $(".info").each((_, el) => {
    const name = $(el).find(".name").text().trim()
    const value = $(el).find(".value").text().trim()
    if (name && value) attributes[name] = value
  })

  return { bullets, attributes }
}

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

async function main() {
  const parts = readJSON(PARTS_FILE)

  const progress = fs.existsSync(PROGRESS_FILE)
    ? readJSON(PROGRESS_FILE)
    : { last_index: 0, completed: [] }

  const { access_token, token_type } = await getAccessToken()

  for (let i = progress.last_index; i < parts.length; i++) {
    const partNumber = parts[i].part_number

    try {
      const details = await getPartDetails(access_token, token_type, partNumber)
      const media = await getPartMedia(access_token, token_type, partNumber)
      const price = await getPartPrice(access_token, token_type, partNumber)
      const availability = await getPartAvailability(access_token, token_type, partNumber)
      const fitments = await getPartFitments(access_token, token_type, partNumber)

      const supplier = await scrapeSupplierPage(details.link)

      const euStock = availability.eu_availability || 0
      const sellPrice = price.retail_price || 0
      const costPrice = price.price || 0

      const description = buildDescription(details, supplier)

      const tags = [
        details.part_name,
        details.brand_code,
        details.product_code
      ].filter(Boolean).join(", ")

      const product = {
        title: details.part_name,
        body_html: description,
        vendor: details.brand_code,
        product_type: details.product_code || "Parts",
        tags,
        variants: [
          {
            sku: partNumber,
            price: sellPrice,
            cost: costPrice,
            inventory_management: "shopify"
          }
        ],
        images: media.images?.map(i => ({ src: i.uri })) || [],
        metafields: [
          { namespace: "parts_europe", key: "part_number", type: "single_line_text_field", value: details.part_number },
          { namespace: "parts_europe", key: "vendor_part_number", type: "single_line_text_field", value: details.vendor_part_number || "" },
          { namespace: "parts_europe", key: "brand_code", type: "single_line_text_field", value: details.brand_code || "" },
          { namespace: "parts_europe", key: "warehouse_status", type: "single_line_text_field", value: details.warehouse_status || "" },
          { namespace: "parts_europe", key: "warehouse_country", type: "single_line_text_field", value: details.warehouse_country || "" },
          { namespace: "parts_europe", key: "eu_harmonized_code", type: "single_line_text_field", value: details.eu_harmonized_code || "" },
          { namespace: "parts_europe", key: "us_harmonized_code", type: "single_line_text_field", value: details.us_harmonized_code || "" },
          { namespace: "parts_europe", key: "com_code", type: "single_line_text_field", value: details.com_code || "" },
          { namespace: "parts_europe", key: "sub_com_code", type: "single_line_text_field", value: details.sub_com_code || "" },
          { namespace: "parts_europe", key: "catalog_codes", type: "single_line_text_field", value: details.catalog_codes || "" },
          { namespace: "parts_europe", key: "product_code", type: "single_line_text_field", value: details.product_code || "" },
          { namespace: "parts_europe", key: "software_license", type: "boolean", value: String(details.software_license) },
          { namespace: "parts_europe", key: "uom", type: "single_line_text_field", value: details.uom || "" },
          { namespace: "parts_europe", key: "dimensions", type: "json", value: JSON.stringify(details.dimensions || {}) },
          { namespace: "parts_europe", key: "alerts", type: "json", value: JSON.stringify(details.alerts || {}) },
          { namespace: "parts_europe", key: "source_link", type: "url", value: details.link || "" },
          { namespace: "fitments", key: "part", type: "json", value: formatFitmentsForMetafield(fitments) },
          { namespace: "logistics", key: "length_mm", type: "number_integer", value: String(details.dimensions?.length || 0) },
          { namespace: "logistics", key: "width_mm", type: "number_integer", value: String(details.dimensions?.width || 0) },
          { namespace: "logistics", key: "height_mm", type: "number_integer", value: String(details.dimensions?.height || 0) },
          { namespace: "logistics", key: "weight_kg", type: "number_decimal", value: String(details.dimensions?.weight || 0) }
        ]
      }

      const created = await createProduct(product)
      const inventoryItemId = created.variants[0].inventory_item_id

      await setInventory(inventoryItemId, euStock)
      await setInventoryCost(inventoryItemId, costPrice)

      progress.completed.push(partNumber)
      progress.last_index = i + 1
      saveProgress(progress)

      console.log(
        `${i + 1}/${parts.length} part=${partNumber} price=${sellPrice} cost=${costPrice} eu_stock=${euStock} images=${media.images?.length || 0} videos=${media.videos?.length || 0} fitments=${fitments.fitments?.length || 0} status=CREATED`
      )
    } catch (e) {
      console.log(
        `${i + 1}/${parts.length} part=${partNumber} status=FAILED error=${e.message}`
      )
      break
    }
  }
}

main()