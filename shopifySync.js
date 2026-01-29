const axios = require("axios")
const fs = require("fs")
const path = require("path")
const cheerio = require("cheerio")
require("dotenv").config()
const SyncProgress = require("./models/SyncProgress")

const { getAccessToken } = require("./auth")

// ============================================================================
// CONFIGURATION
// ============================================================================

const env = process.env.PARTS_ENV || "production"
const API_BASE_URL = env === "sandbox"
  ? process.env.PARTS_EUROPE_SANDBOX_API_URL
  : process.env.PARTS_EUROPE_PROD_API_URL

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID
const SHOPIFY_API_VERSION = "2024-01"

const DATA_DIR = path.join(__dirname, "data")
const PARTS_FILE = path.join(DATA_DIR, `parts-${env}.json`)
const BRANDS_FILE = path.join(DATA_DIR, `brands-${env}.json`)
const CURRENT_PRODUCT_FILE = path.join(DATA_DIR, "current-product.json")

async function getProgressFromDB() {
  let progress = await SyncProgress.findOne()
  if (!progress) {
    progress = await SyncProgress.create({
      last_index: 0,
      last_part_number: ""
    })
  }
  return progress
}

async function saveProgressToDB(index, partNumber) {
  await SyncProgress.updateOne(
    {},
    {
      last_index: index,
      last_part_number: partNumber,
      updatedAt: new Date()
    },
    { upsert: true }
  )
}

// Settings
const DELAY_BETWEEN_PARTS = 3000
const DELAY_AFTER_UPLOAD = 2000
const SKIP_SUPPLIER_SCRAPING = false
const SKIP_FITMENTS = false

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// ============================================================================
// UTILITIES
// ============================================================================

function readJSON(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const brandsArray = readJSON(BRANDS_FILE) || []
const brandsLookup = {}
brandsArray.forEach(brand => {
  brandsLookup[brand.code] = brand.name
})

console.log(`📋 Loaded ${Object.keys(brandsLookup).length} brands`)

const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getBrandName(brandCode) {
  return brandsLookup[brandCode] || brandCode || "Unknown"
}

function generateTags(partData) {
  const tags = []
  const brandName = getBrandName(partData.details.brand_code)
  if (brandName && brandName !== "Unknown") tags.push(brandName)
  if (partData.details.product_code) tags.push(partData.details.product_code)
  if (partData.details.catalog_codes) {
    const catalogCodes = partData.details.catalog_codes.split(',').map(c => c.trim())
    tags.push(...catalogCodes.slice(0, 3))
  }
  return [...new Set(tags)].filter(Boolean).join(", ")
}

function getProductType(partData) {
  return partData.details.product_code || 
         (partData.details.catalog_codes ? partData.details.catalog_codes.split(',')[0].trim() : null) ||
         "Parts & Accessories"
}

// ============================================================================
// API FETCH FUNCTIONS
// ============================================================================

async function retryRequest(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (e.response && e.response.status === 429) {
        const waitTime = 15000 * Math.pow(2, i)
        console.log(`⏸️  Rate limit. Waiting ${waitTime / 1000}s...`)
        await delay(waitTime)
        continue
      }
      if (i === retries - 1) throw e
      await delay(1000 * Math.pow(2, i))
    }
  }
}

async function fetchPartData(token, tokenType, partNumber) {
  const apiCalls = [
    retryRequest(async () => {
      const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}`, {
        headers: { Authorization: `${tokenType} ${token}` },
        timeout: 10000
      })
      return r.data
    }),
    retryRequest(async () => {
      const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}/media`, {
        headers: { Authorization: `${tokenType} ${token}` },
        timeout: 10000
      })
      return r.data
    }),
    retryRequest(async () => {
      const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}/price`, {
        headers: { Authorization: `${tokenType} ${token}` },
        timeout: 10000
      })
      return r.data
    }),
    retryRequest(async () => {
      const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}/availability`, {
        headers: { Authorization: `${tokenType} ${token}` },
        timeout: 10000
      })
      return r.data
    })
  ]
  
  if (!SKIP_FITMENTS) {
    apiCalls.push(retryRequest(async () => {
      const r = await axios.get(`${API_BASE_URL}/v1/parts/${partNumber}/fitments`, {
        headers: { Authorization: `${tokenType} ${token}` },
        timeout: 10000
      })
      return r.data
    }).catch(() => ({ fitments: [] })))
  }
  
  const results = await Promise.all(apiCalls)
  const [details, media, price, availability, fitments] = SKIP_FITMENTS 
    ? [...results, { fitments: [] }]
    : results
  
  const supplier = await scrapeSupplierPage(details.link)
  
  return {
    part_number: partNumber,
    details,
    media,
    price,
    availability,
    fitments,
    supplier
  }
}

async function scrapeSupplierPage(url) {
  if (SKIP_SUPPLIER_SCRAPING) {
    return { bullets: [], attributes: {}, hasVariants: false, variantOptions: [] }
  }

  try {
    const r = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
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
    const hasVariantSelector = $('form.variants').length > 0 || $('.apparel-variants').length > 0
    const variantOptions = []
    if (hasVariantSelector) {
      if ($('.variant label:contains("Size")').parent().find('.selector-box').length > 0) {
        variantOptions.push('size')
      }
      if ($('.variant label:contains("Color")').parent().find('.selector-box').length > 0) {
        variantOptions.push('color')
      }
    }
    return { bullets, attributes, hasVariants: hasVariantSelector, variantOptions }
  } catch (e) {
    return { bullets: [], attributes: {}, hasVariants: false, variantOptions: [] }
  }
}

// ============================================================================
// PRODUCT GROUPING
// ============================================================================

function parseProductNameAndVariant(partName) {
  const sizePattern = /\b(XS|SM|S|MD|M|LG|L|XL|XXL|2XL|3XL|4XL|2X|3X|4X|5X)\b/i
  const sizeMatch = partName.match(sizePattern)
  
  let baseName = partName
  let size = null
  let color = null
  
  if (sizeMatch) {
    size = sizeMatch[0].toUpperCase()
    baseName = partName.substring(0, sizeMatch.index).trim()
  }
  
  const colorPattern = /\b([A-Z]{2,3}\/[A-Z]{2,3}|BLACK\/GRAY\/MATTE\/YELLOW|BLACK\/GRAY\/MATTE\/WHITE)\b/i
  const colorMatch = partName.match(colorPattern)
  
  if (colorMatch) {
    color = colorMatch[0]
    const colorIndex = partName.indexOf(colorMatch[0])
    if (colorIndex < (sizeMatch ? sizeMatch.index : partName.length)) {
      baseName = partName.substring(0, colorIndex).trim()
    }
  }
  
  return { 
    baseName: baseName || partName, 
    size, 
    color,
    originalName: partName 
  }
}

function isSameProduct(baseName1, brand1, baseName2, brand2) {
  const name1 = baseName1.toLowerCase().trim().replace(/\s+/g, ' ')
  const name2 = baseName2.toLowerCase().trim().replace(/\s+/g, ' ')
  const brand1Clean = (brand1 || '').toLowerCase().trim()
  const brand2Clean = (brand2 || '').toLowerCase().trim()
  return name1 === name2 && brand1Clean === brand2Clean
}

// ============================================================================
// SHOPIFY UPLOAD
// ============================================================================

function buildDescription(details, supplier) {
  const sections = []
  if (supplier.bullets && supplier.bullets.length > 0) {
    const bulletsHTML = `<ul>${supplier.bullets.map(b => `<li>${b}</li>`).join("")}</ul>`
    sections.push(`<h3>Product Information</h3>\n${bulletsHTML}`)
  }
  if (supplier.attributes && Object.keys(supplier.attributes).length > 0) {
    const attributesHTML = `<table>${
      Object.entries(supplier.attributes)
        .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
        .join("")
    }</table>`
    sections.push(`<h3>Product Attributes</h3>\n${attributesHTML}`)
  }
  const d = details.dimensions || {}
  if (d.length || d.width || d.height || d.weight) {
    const dimensionsHTML = `<table>
${d.length ? `<tr><td><strong>Length (mm)</strong></td><td>${d.length}</td></tr>` : ''}
${d.width ? `<tr><td><strong>Width (mm)</strong></td><td>${d.width}</td></tr>` : ''}
${d.height ? `<tr><td><strong>Height (mm)</strong></td><td>${d.height}</td></tr>` : ''}
${d.weight ? `<tr><td><strong>Weight (kg)</strong></td><td>${d.weight}</td></tr>` : ''}
</table>`
    sections.push(`<h3>Dimensions</h3>\n${dimensionsHTML}`)
  }
  return sections.join('\n\n').trim() || undefined
}

async function uploadProductToShopify(productGroup) {
  const description = buildDescription(productGroup.base_details, productGroup.base_supplier)
  const brandName = getBrandName(productGroup.brand_code)
  const tags = generateTags({ details: productGroup.base_details, supplier: productGroup.base_supplier })
  const productType = getProductType({ details: productGroup.base_details })
  
  // DEDUPLICATE VARIANTS
  const uniqueVariants = []
  const variantKeys = new Set()
  
  productGroup.variants.forEach(variant => {
    const key = `${variant.size || 'NONE'}_${variant.color || 'NONE'}`
    if (!variantKeys.has(key)) {
      variantKeys.add(key)
      uniqueVariants.push(variant)
    } else {
      console.log(`    ⚠️  Skipping duplicate variant: ${variant.size || ''} ${variant.color || ''}`)
    }
  })
  
  productGroup.variants = uniqueVariants
  
  const hasSizes = productGroup.variants.some(v => v.size)
  const hasColors = productGroup.variants.some(v => v.color)
  const hasMultipleVariants = productGroup.variants.length > 1
  
  const options = []
  if (hasSizes && hasColors) {
    options.push({ name: "Size" })
    options.push({ name: "Color" })
  } else if (hasSizes) {
    options.push({ name: "Size" })
  } else if (hasColors) {
    options.push({ name: "Color" })
  }
  
  const variants = []
  if (!hasMultipleVariants) {
    variants.push({
      sku: productGroup.variants[0].part_number,
      price: String(productGroup.variants[0].price),
      inventory_management: "shopify"
    })
  } else {
    productGroup.variants.forEach(variant => {
      const variantData = {
        sku: variant.part_number,
        price: String(variant.price),
        inventory_management: "shopify"
      }
      if (hasSizes && hasColors) {
        variantData.option1 = variant.size || "Default"
        variantData.option2 = variant.color || "Default"
      } else if (hasSizes) {
        variantData.option1 = variant.size || "Default"
      } else if (hasColors) {
        variantData.option1 = variant.color || "Default"
      }
      variants.push(variantData)
    })
  }
  
  const finalOptions = hasMultipleVariants && options.length > 0 ? options : undefined
  
  const allPartNumbers = productGroup.variants.map(v => v.part_number).join(", ")
  const allFitments = productGroup.variants.flatMap(v => v.fitments?.fitments || [])
  
  const metafields = [
    { namespace: "parts_europe", key: "part_numbers", type: "single_line_text_field", value: allPartNumbers },
    { namespace: "parts_europe", key: "vendor_part_number", type: "single_line_text_field", value: productGroup.base_details.vendor_part_number || "" },
    { namespace: "parts_europe", key: "brand_code", type: "single_line_text_field", value: productGroup.brand_code || "" },
    { namespace: "parts_europe", key: "brand_name", type: "single_line_text_field", value: brandName },
    { namespace: "parts_europe", key: "warehouse_status", type: "single_line_text_field", value: productGroup.base_details.warehouse_status || "" },
    { namespace: "parts_europe", key: "warehouse_country", type: "single_line_text_field", value: productGroup.base_details.warehouse_country || "" },
    { namespace: "parts_europe", key: "eu_harmonized_code", type: "single_line_text_field", value: productGroup.base_details.eu_harmonized_code || "" },
    { namespace: "parts_europe", key: "us_harmonized_code", type: "single_line_text_field", value: productGroup.base_details.us_harmonized_code || "" },
    { namespace: "parts_europe", key: "com_code", type: "single_line_text_field", value: productGroup.base_details.com_code || "" },
    { namespace: "parts_europe", key: "sub_com_code", type: "single_line_text_field", value: productGroup.base_details.sub_com_code || "" },
    { namespace: "parts_europe", key: "catalog_codes", type: "single_line_text_field", value: productGroup.base_details.catalog_codes || "" },
    { namespace: "parts_europe", key: "product_code", type: "single_line_text_field", value: productGroup.base_details.product_code || "" },
    { namespace: "parts_europe", key: "software_license", type: "boolean", value: String(!!productGroup.base_details.software_license) },
    { namespace: "parts_europe", key: "uom", type: "single_line_text_field", value: productGroup.base_details.uom || "" },
    { namespace: "parts_europe", key: "dimensions", type: "json", value: JSON.stringify(productGroup.base_details.dimensions || {}) },
    { namespace: "parts_europe", key: "alerts", type: "json", value: JSON.stringify(productGroup.base_details.alerts || {}) },
    { namespace: "parts_europe", key: "source_link", type: "url", value: productGroup.base_details.link || "" },
    { namespace: "fitments", key: "part", type: "json", value: JSON.stringify(allFitments) },
    { namespace: "logistics", key: "length_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.length || 0) },
    { namespace: "logistics", key: "width_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.width || 0) },
    { namespace: "logistics", key: "height_mm", type: "number_integer", value: String(productGroup.base_details.dimensions?.height || 0) },
    { namespace: "logistics", key: "weight_kg", type: "number_decimal", value: String(productGroup.base_details.dimensions?.weight || 0) }
  ].filter(m => {
    if (m.type === 'number_integer' || m.type === 'number_decimal') return true
    if (m.type === 'boolean') return true
    if (m.type === 'json') return m.value !== '{}' && m.value !== '[]'
    return m.value && m.value.trim() !== ''
  })
  
  const product = {
    title: productGroup.base_name,
    body_html: description,
    vendor: brandName,
    product_type: productType,
    tags,
    variants,
    options: finalOptions,
    metafields: metafields
  }
  
  console.log(`  → Creating: "${productGroup.base_name}"`)
  console.log(`  → Vendor: ${brandName} | Type: ${productType}`)
  console.log(`  → Variants: ${productGroup.variants.length}${finalOptions ? ` (${finalOptions.map(o => o.name).join(', ')})` : ''}`)
  
  const createdProduct = await shopify.post("/products.json", { product })
  const shopifyProduct = createdProduct.data.product
  
  // Upload images with variant associations
  if (hasMultipleVariants) {
    for (let j = 0; j < productGroup.variants.length; j++) {
      const variant = productGroup.variants[j]
      const shopifyVariant = shopifyProduct.variants[j]
      if (variant.media && variant.media.images && variant.media.images.length > 0) {
        const imageUrl = variant.media.images[0].uri
        await shopify.post(`/products/${shopifyProduct.id}/images.json`, {
          image: { src: imageUrl, variant_ids: [shopifyVariant.id] }
        })
      }
    }
  } else {
    const variant = productGroup.variants[0]
    if (variant.media && variant.media.images) {
      for (const img of variant.media.images) {
        await shopify.post(`/products/${shopifyProduct.id}/images.json`, {
          image: { src: img.uri }
        })
      }
    }
  }
  
  // Set inventory and cost
  for (let j = 0; j < shopifyProduct.variants.length; j++) {
    const shopifyVariant = shopifyProduct.variants[j]
    const originalVariant = productGroup.variants[j]
    await shopify.post("/inventory_levels/set.json", {
      location_id: SHOPIFY_LOCATION_ID,
      inventory_item_id: shopifyVariant.inventory_item_id,
      available: originalVariant.stock
    })
    await shopify.put(`/inventory_items/${shopifyVariant.inventory_item_id}.json`, {
      inventory_item: {
        id: shopifyVariant.inventory_item_id,
        cost: String(originalVariant.cost),
        tracked: true
      }
    })
  }
  
  return shopifyProduct
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================

async function syncToShopify() {
  const allParts = readJSON(PARTS_FILE)
  const progress = await getProgressFromDB()
  
  if (!allParts || allParts.length === 0) {
    console.error("❌ No parts found!")
    return { complete: true, last_part_number: progress.last_part_number }
  }
  
  const startIndex = progress.last_index
  
  if (startIndex >= allParts.length) {
    console.log("✅ All parts have been processed!")
    return { complete: true, last_part_number: progress.last_part_number }
  }
  
  let currentProduct = readJSON(CURRENT_PRODUCT_FILE)
  const { access_token, token_type } = await getAccessToken()
  
  const index = startIndex
  const startTime = Date.now()
  const part = allParts[index]
  
  // ✅ FIX: Get part_number from the part object
  const partNumber = part.part_number || part
  
  try {
    const elapsed = (Date.now() - startTime) / 1000 || 1
    const rate = 1 / elapsed || 1
    const remaining = allParts.length - index
    const eta = remaining / rate
    
    console.log(`[${index + 1}/${allParts.length}] (${((index / allParts.length) * 100).toFixed(2)}%) - ETA: ${(eta / 3600).toFixed(1)}h`)
    console.log(`Fetching ${partNumber}...`)
    
    const partData = await fetchPartData(access_token, token_type, partNumber)
    const { baseName, size, color } = parseProductNameAndVariant(partData.details.part_name)
    
    console.log(`  → ${baseName}${size ? ` (${size})` : ''}${color ? ` (${color})` : ''}`)
    
    if (currentProduct) {
      const sameProduct = isSameProduct(
        baseName, 
        partData.details.brand_code,
        currentProduct.base_name,
        currentProduct.brand_code
      )
      
      const shouldGroupAsVariant = sameProduct && 
        (partData.supplier.hasVariants || currentProduct.base_supplier.hasVariants) &&
        (size || color)
      
      if (shouldGroupAsVariant) {
        currentProduct.variants.push({
          part_number: partNumber,
          size,
          color,
          price: partData.price.retail_price || 0,
          cost: partData.price.price || 0,
          stock: partData.availability.eu_availability || 0,
          media: partData.media,
          fitments: partData.fitments,
          details: partData.details
        })
        console.log(`  ✓ Added as variant #${currentProduct.variants.length}`)
        
        saveJSON(CURRENT_PRODUCT_FILE, currentProduct)
        await saveProgressToDB(index + 1, partNumber)
        console.log(`  💾 Progress saved (variant) → Index: ${index + 1} | Part: ${partNumber}`)
        
      } else {
        console.log(`  → Uploading previous product...`)
        
        try {
          await uploadProductToShopify(currentProduct)
          console.log(`  ✓ Uploaded!\n`)
          await delay(DELAY_AFTER_UPLOAD)
          
        } catch (e) {
          console.log(`  ✗ Upload failed: ${e.message}`)
          if (e.response && e.response.data) {
            console.log(`  Details: ${JSON.stringify(e.response.data.errors)}`)
          }
          
          if (e.response && e.response.data && e.response.data.product) {
            const errorMsg = JSON.stringify(e.response.data.product)
            if (errorMsg.includes('Daily variant creation limit')) {
              console.log(`  🛑 Shopify daily variant limit reached. Stopping sync.`)
              return { 
                complete: false, 
                dailyLimitReached: true,
                progress: index, 
                total: allParts.length, 
                error: 'Daily variant creation limit reached' 
              }
            }
          }
          
          console.log(`  ⚠️  Upload failed but continuing...`)
        }
        
        currentProduct = {
          base_name: baseName,
          brand_code: partData.details.brand_code,
          base_details: partData.details,
          base_supplier: partData.supplier,
          variants: [{
            part_number: partNumber,
            size,
            color,
            price: partData.price.retail_price || 0,
            cost: partData.price.price || 0,
            stock: partData.availability.eu_availability || 0,
            media: partData.media,
            fitments: partData.fitments,
            details: partData.details
          }]
        }
        console.log(`  ✓ Started new product`)
        saveJSON(CURRENT_PRODUCT_FILE, currentProduct)
        await saveProgressToDB(index + 1, partNumber)
        console.log(`  💾 Progress saved (new product) → Index: ${index + 1} | Part: ${partNumber}`)
      }
      
    } else {
      currentProduct = {
        base_name: baseName,
        brand_code: partData.details.brand_code,
        base_details: partData.details,
        base_supplier: partData.supplier,
        variants: [{
          part_number: partNumber,
          size,
          color,
          price: partData.price.retail_price || 0,
          cost: partData.price.price || 0,
          stock: partData.availability.eu_availability || 0,
          media: partData.media,
          fitments: partData.fitments,
          details: partData.details
        }]
      }
      console.log(`  ✓ Started first product`)
      saveJSON(CURRENT_PRODUCT_FILE, currentProduct)
      await saveProgressToDB(index + 1, partNumber)
      console.log(`  💾 Progress saved (first product) → Index: ${index + 1} | Part: ${partNumber}`)
    }
    
    return { 
      complete: false, 
      progress: index + 1, 
      total: allParts.length,
      last_part_number: partNumber
    }
    
  } catch (e) {
    // ✅ FIX: Skip failed parts and move to next one
    console.log(`  ✗ Failed to fetch: ${e.message}`)
    console.log(`  ⚠️  Skipping part ${partNumber} and moving to next...`)
    
    // Save progress to skip this part
    await saveProgressToDB(index + 1, partNumber)
    console.log(`  💾 Progress saved (skipped) → Index: ${index + 1} | Part: ${partNumber}`)
    
    return { 
      complete: false, 
      progress: index + 1, 
      total: allParts.length, 
      skipped: true,
      error: e.message 
    }
  }
}

module.exports = { syncToShopify }

