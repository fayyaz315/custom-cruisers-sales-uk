const axios = require("axios")
require("dotenv").config()

const SHOP = process.env.SHOPIFY_STORE_URL
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION = "2026-04"

async function cancelBulkOperation() {
  const query = `
    mutation bulkOperationCancel($id: ID!) {
      bulkOperationCancel(id: $id) {
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

  const variables = {
    id: "gid://shopify/BulkOperation/11015825129855"
  }

  try {
    const response = await axios.post(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {
        query,
        variables
      },
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    )

    console.log(
      JSON.stringify(response.data, null, 2)
    )
  } catch (error) {
    console.log(
      error.response?.data || error.message
    )
  }
}

cancelBulkOperation()