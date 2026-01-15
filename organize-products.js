const axios = require("axios")
const fs = require("fs")
const path = require("path")
require("dotenv").config()

const DATA_DIR = path.join(__dirname, "data")
const env = process.env.PARTS_ENV || "production"
const ENRICHED_PARTS_FILE = path.join(DATA_DIR, `enriched-parts-${env}.json`)
const ORGANIZED_PRODUCTS_FILE = path.join(DATA_DIR, `organized-products-${env}.json`)

function readJSON(file) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// Extract base product name and variant attributes
function parseProductNameAndVariant(partName, partNumber) {
  // Example: "HELMET SOLARIS 2.0 SLATER BK/YL XL" -> base: "HELMET SOLARIS 2.0 SLATER", color: "BK/YL", size: "XL"
  
  const sizePattern = /\b(XS|SM|MD|LG|XL|XXL|2XL|3XL|4XL)\b/i
  const sizeMatch = partName.match(sizePattern)
  
  let baseName = partName
  let size = null
  let color = null
  
  if (sizeMatch) {
    size = sizeMatch[0].toUpperCase()
    baseName = partName.substring(0, sizeMatch.index).trim()
  }
  
  // Try to extract color (usually before size)
  const colorPattern = /\b([A-Z]{2,3}\/[A-Z]{2,3}|[A-Z]{2,3})\s+(XS|SM|MD|LG|XL|XXL|2XL|3XL|4XL)/i
  const colorMatch = partName.match(colorPattern)
  
  if (colorMatch) {
    color = colorMatch[1]
    baseName = partName.substring(0, colorMatch.index).trim()
  }
  
  return {
    baseName: baseName || partName,
    size,
    color
  }
}

function organizeProducts() {
  const enrichedParts = readJSON(ENRICHED_PARTS_FILE)
  
  const productGroups = {}
  
  enrichedParts.forEach(part => {
    const { baseName, size, color } = parseProductNameAndVariant(
      part.details.part_name,
      part.part_number
    )
    
    // Use base name + brand as the product key
    const productKey = `${baseName}_${part.details.brand_code || ''}`.toLowerCase().replace(/\s+/g, '_')
    
    if (!productGroups[productKey]) {
      productGroups[productKey] = {
        base_name: baseName,
        brand: part.details.brand_code,
        product_type: part.details.product_code || "Parts",
        vendor_part_number: part.details.vendor_part_number,
        base_details: part.details,
        base_supplier: part.supplier,
        variants: []
      }
    }
    
    productGroups[productKey].variants.push({
      part_number: part.part_number,
      size,
      color,
      price: part.price.retail_price || 0,
      cost: part.price.price || 0,
      stock: part.availability.eu_availability || 0,
      media: part.media,
      fitments: part.fitments,
      details: part.details
    })
  })
  
  // Convert to array
  const organizedProducts = Object.values(productGroups)
  
  saveJSON(ORGANIZED_PRODUCTS_FILE, organizedProducts)
  console.log(`Organized ${organizedProducts.length} products with variants`)
  
  // Print summary
  organizedProducts.forEach(product => {
    console.log(`${product.base_name}: ${product.variants.length} variants`)
  })
}

organizeProducts()