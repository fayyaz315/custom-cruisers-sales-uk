const axios = require("axios")
require("dotenv").config()

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_API_VERSION = "2024-01"

const shopify = axios.create({
  baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
})

async function createLocation(name) {
  try {
    const res = await shopify.post("/locations.json", {
      location: {
        name
      }
    })
    console.log(`✅ Location created: ${name} | ID: ${res.data.location.id}`)
  } catch (e) {
    if (e.response?.data?.errors?.name?.[0]?.includes("already")) {
      console.log(`⚠️ Location already exists: ${name}`)
    } else {
      console.error(`❌ Failed creating location: ${name}`)
      console.error(e.response?.data || e.message)
    }
  }
}

async function run() {
  await createLocation("Parts Europe - EU")
  await createLocation("Parts Europe - US")
}

run()
