require("dotenv").config()

const express = require("express")
const cors = require("cors")
const mongoose = require("mongoose")

const { syncToShopify } = require("./shopifySync")
const SyncProgress = require("./models/SyncProgress")

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.NODE_ENV === "production" ? process.env.PORT : 3000

// ----------------------------------------------------
// LOAD OR CREATE PROGRESS ROW
// ----------------------------------------------------
async function getProgress() {
  let progress = await SyncProgress.findOne()
  if (!progress) {
    progress = await SyncProgress.create({
      last_index: 0,
      last_part_number: ""
    })
  }
  return progress
}

// ----------------------------------------------------
// CONTINUOUS SHOPIFY SYNC LOOP (NEVER STOPS)
// ----------------------------------------------------
async function runShopifySyncLoop() {
  console.log("Shopify Sync Worker started...")

  while (true) {
    try {
      const result = await syncToShopify()

      if (result.complete) {
        console.log("All parts have been synced. Worker is idle.")
        await new Promise(r => setTimeout(r, 60000)) // sleep 1 min and keep alive
        continue
      }

      // Save progress into MongoDB
      await SyncProgress.updateOne(
        {},
        {
          last_index: result.progress,
          last_part_number: result.last_part_number,
          updatedAt: new Date()
        }
      )

      console.log(
        `Progress saved → Index: ${result.progress} | Part: ${result.last_part_number}`
      )

    } catch (err) {
      console.error("Sync loop error:", err.message)
      await new Promise(r => setTimeout(r, 5000)) // wait before retry
    }
  }
}

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get("/", (req, res) => {
  res.send("Parts Europe → Shopify Sync Worker running")
})

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB connected")

    await getProgress()

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })

    // Start infinite worker loop
    runShopifySyncLoop()

  } catch (err) {
    console.error("Startup error:", err)
  }
}

start()
