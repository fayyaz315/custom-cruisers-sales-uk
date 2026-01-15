const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const axios = require('axios')

const token = process.env.SHOPIFY_ACCESS_TOKEN
const storeUrl = process.env.SHOPIFY_STORE_URL

const dataPath = path.join(__dirname, '../data/unique_categories.json')
const raw = fs.readFileSync(dataPath, 'utf8')
const { categories } = JSON.parse(raw)

let done = 0
let success = 0
let failed = 0
const total = categories.length

const mutationCreate = `
mutation CollectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    userErrors {
      field
      message
    }
    collection {
      id
      title
    }
  }
}
`

const mutationPublish = `
mutation publishCollection($id: ID!, $pubId: ID!) {
  publishablePublish(id: $id, input: { publicationId: $pubId }) {
    userErrors {
      field
      message
    }
  }
}
`

const queryPublications = `
{
  publications(first: 50) {
    edges {
      node {
        id
        name
      }
    }
  }
}
`

async function graphql(query, variables) {
  const url = `https://${storeUrl}/admin/api/2024-01/graphql.json`
  return axios.post(
    url,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    }
  )
}

async function getPublications() {
  const res = await graphql(queryPublications)
  return res.data.data.publications.edges.map(e => e.node)
}

async function createCollection(category) {
  const variables = {
    input: {
      title: category.name,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [
          {
            column: "TAG",
            relation: "EQUALS",
            condition: category.name
          }
        ]
      }
    }
  }
  return graphql(mutationCreate, variables)
}

async function publishCollection(id, publications) {
  for (const p of publications) {
    await graphql(mutationPublish, { id, pubId: p.id })
  }
}

async function run() {
  console.log(`🚀 Loading publications...\n`)
  const publications = await getPublications()

  console.log(`📚 Found ${publications.length} publications`)
  publications.forEach(p => console.log(`   • ${p.name} — ${p.id}`))
  console.log(`\n🏁 Starting: ${total} collections\n`)

  for (const c of categories) {
    const remaining = total - (done + 1)

    try {
      const res = await createCollection(c)
      const data = res.data.data.collectionCreate

      if (data.userErrors && data.userErrors.length > 0) {
        const errMsg = data.userErrors.map(e => e.message).join(', ')
        done++
        failed++
        console.log(`❌ ${c.name} (${done}/${total}) — ${remaining} left — ${errMsg}`)
        continue
      }

      const id = data.collection.id
      await publishCollection(id, publications)

      done++
      success++
      console.log(`✅ ${c.name} (${done}/${total}) — ${remaining} left — 📦 ID: ${id} — 🌍 Published`)

    } catch (err) {
      done++
      failed++

      const message =
        err.response?.data?.errors ||
        err.response?.data ||
        err.message

      console.log(`🔥 ERROR for ${c.name} (${done}/${total}) — ${remaining} left`)
      console.log(message)
    }
  }

  console.log(`\n🎉 Finished`)
  console.log(`👍 Created: ${success}`)
  console.log(`⚠️ Failed: ${failed}`)
}

run()
