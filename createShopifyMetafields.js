const axios = require("axios")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2024-01"

const client = axios.create({
  url: `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
  method: "post",
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
  }
})

const metafields = [
  { namespace: "parts_europe", key: "part_number", type: "single_line_text_field", name: "Part Number" },
  { namespace: "parts_europe", key: "vendor_part_number", type: "single_line_text_field", name: "Vendor Part Number" },
  { namespace: "parts_europe", key: "brand_code", type: "single_line_text_field", name: "Brand Code" },
  { namespace: "parts_europe", key: "warehouse_status", type: "single_line_text_field", name: "Warehouse Status" },
  { namespace: "parts_europe", key: "warehouse_country", type: "single_line_text_field", name: "Warehouse Country" },
  { namespace: "parts_europe", key: "eu_harmonized_code", type: "single_line_text_field", name: "EU Harmonized Code" },
  { namespace: "parts_europe", key: "us_harmonized_code", type: "single_line_text_field", name: "US Harmonized Code" },
  { namespace: "parts_europe", key: "com_code", type: "single_line_text_field", name: "COM Code" },
  { namespace: "parts_europe", key: "sub_com_code", type: "single_line_text_field", name: "Sub COM Code" },
  { namespace: "parts_europe", key: "catalog_codes", type: "single_line_text_field", name: "Catalog Codes" },
  { namespace: "parts_europe", key: "product_code", type: "single_line_text_field", name: "Product Code" },
  { namespace: "parts_europe", key: "software_license", type: "boolean", name: "Software License" },
  { namespace: "parts_europe", key: "uom", type: "single_line_text_field", name: "Unit of Measure" },
  { namespace: "parts_europe", key: "dimensions", type: "json", name: "Dimensions" },
  { namespace: "parts_europe", key: "alerts", type: "json", name: "Alerts" },
  { namespace: "parts_europe", key: "source_link", type: "url", name: "Source Link" },

  { namespace: "fitment", key: "vehicles", type: "json", name: "Vehicle Fitments" },

  { namespace: "logistics", key: "length_mm", type: "number_integer", name: "Length (mm)" },
  { namespace: "logistics", key: "width_mm", type: "number_integer", name: "Width (mm)" },
  { namespace: "logistics", key: "height_mm", type: "number_integer", name: "Height (mm)" },
  { namespace: "logistics", key: "weight_kg", type: "number_decimal", name: "Weight (kg)" }
]

async function createMetafield(field) {
  const query = `
    mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          name
          namespace
          key
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  const variables = {
    definition: {
      name: field.name,
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      ownerType: "PRODUCT",
      pin: true
    }
  }

  try {
    const res = await axios.post(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    )

    const result = res.data.data.metafieldDefinitionCreate

    if (result.userErrors.length > 0) {
      console.log(`Skipped (exists or invalid): ${field.namespace}.${field.key}`)
      result.userErrors.forEach(e => console.log(e.message))
    } else {
      console.log(`Created: ${field.namespace}.${field.key}`)
    }
  } catch (err) {
    console.log(`Error: ${field.namespace}.${field.key}`)
    console.log(err.response?.data || err.message)
  }
}

async function run() {
  for (const field of metafields) {
    await createMetafield(field)
  }
  console.log("All metafield definitions processed")
}

run()
