require("dotenv").config()

const express = require("express")
const cors = require("cors")
const mongoose = require("mongoose")

const fetchAvailabilityUpdates =
  require("./fetchAvailabilityUpdates")

const fetchAvailabilityDetails =
  require("./fetchAvailabilityDetails")

const exportShopifyInventory =
  require("./exportShopifyInventory")

const createInventoryUpdateJsonl =
  require("./createInventoryUpdateJsonl")

const runInventoryBulkUpdate =
  require("./runInventoryBulkUpdate")

const app = express()

app.use(cors())
app.use(express.json())

const PORT =
  process.env.NODE_ENV ===
  "production"
    ? process.env.PORT
    : 3000

function logSection(title) {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(`🚀 ${title}`)

  console.log(
    "=".repeat(100)
  )
}

function logStep(step) {
  console.log(
    "\n" + "-".repeat(100)
  )

  console.log(`🔄 ${step}`)

  console.log(
    "-".repeat(100)
  )
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}

// ----------------------------------------------------
// INVENTORY PIPELINE
// ----------------------------------------------------
async function runInventoryPipeline() {
  while (true) {
    const startedAt =
      Date.now()

    try {
      logSection(
        "INVENTORY PIPELINE STARTED"
      )

      // ----------------------------------------------------
      // STEP 1
      // ----------------------------------------------------
      logStep(
        "STEP 1 - FETCHING AVAILABILITY UPDATES"
      )

      await fetchAvailabilityUpdates()

      // ----------------------------------------------------
      // STEP 2
      // ----------------------------------------------------
      logStep(
        "STEP 2 - FETCHING PART DETAILS"
      )

      await fetchAvailabilityDetails()

      // ----------------------------------------------------
      // STEP 3
      // ----------------------------------------------------
      logStep(
        "STEP 3 - EXPORTING SHOPIFY INVENTORY"
      )

      await exportShopifyInventory()

      // ----------------------------------------------------
      // STEP 4
      // ----------------------------------------------------
      logStep(
        "STEP 4 - CREATING INVENTORY UPDATE JSONL"
      )

      await createInventoryUpdateJsonl()

      // ----------------------------------------------------
      // STEP 5
      // ----------------------------------------------------
      logStep(
        "STEP 5 - RUNNING BULK INVENTORY UPDATE"
      )

      await runInventoryBulkUpdate()

      // ----------------------------------------------------
      // FINISHED
      // ----------------------------------------------------
      const duration =
        (
          (Date.now() -
            startedAt) /
          1000
        ).toFixed(2)

      logSection(
        "PIPELINE COMPLETED"
      )

      console.log(
        `✅ Total duration: ${duration}s`
      )

      console.log(
        "\n⏳ Waiting 5 minutes before next cycle...\n"
      )

      await sleep(
        5 * 60 * 1000
      )
    } catch (error) {
      logSection(
        "PIPELINE ERROR"
      )

      console.log(
        `❌ ${error.message}`
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

      if (error.stack) {
        console.log(
          "\nSTACK TRACE:\n"
        )

        console.log(error.stack)
      }

      console.log(
        "\n⏳ Retrying in 10 seconds...\n"
      )

      await sleep(10000)
    }
  }
}

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get(
  "/",
  async (req, res) => {
    try {
      res.json({
        status: "running",
        service:
          "inventory-sync",
        startedAt:
          new Date().toISOString()
      })
    } catch (err) {
      res.status(500).json({
        error:
          err.message
      })
    }
  }
)

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------
async function start() {
  try {
    logSection(
      "APPLICATION STARTING"
    )

    console.log(
      "📌 Connecting to MongoDB..."
    )

    await mongoose.connect(
      process.env.MONGO_URI
    )

    console.log(
      "✅ MongoDB connected"
    )

    app.listen(
      PORT,
      () => {
        console.log(
          `✅ Server running on port ${PORT}`
        )
      }
    )

    console.log(
      "🚀 Starting inventory pipeline..."
    )

    runInventoryPipeline()
  } catch (error) {
    logSection(
      "STARTUP ERROR"
    )

    console.log(
      `❌ ${error.message}`
    )

    process.exit(1)
  }
}

// ----------------------------------------------------
// SHUTDOWN
// ----------------------------------------------------
process.on(
  "SIGINT",
  async () => {
    logSection(
      "SIGINT RECEIVED"
    )

    await mongoose.connection.close()

    console.log(
      "✅ MongoDB connection closed"
    )

    process.exit(0)
  }
)

process.on(
  "SIGTERM",
  async () => {
    logSection(
      "SIGTERM RECEIVED"
    )

    await mongoose.connection.close()

    console.log(
      "✅ MongoDB connection closed"
    )

    process.exit(0)
  }
)

start()