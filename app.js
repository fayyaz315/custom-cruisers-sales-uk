require("dotenv").config()

const express = require("express")
const cors = require("cors")
const mongoose = require("mongoose")

const { syncToShopify } = require("./sync-to-shopify")
const SyncProgress = require("./models/SyncProgress")

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.NODE_ENV === "production" ? process.env.PORT : 3000

let dailyLimitReached = false
let nextResumeTime = null

// ----------------------------------------------------
// CONTINUOUS SHOPIFY SYNC LOOP
// ----------------------------------------------------
async function runShopifySyncLoop() {
  console.log('\n' + '='.repeat(60))
  console.log('🚀 SHOPIFY SYNC WORKER STARTED')
  console.log('='.repeat(60))
  console.log(`📅 Started at: ${new Date().toLocaleString()}`)
  console.log('='.repeat(60) + '\n')

  while (true) {
    try {
      // Check if we're waiting for daily limit reset
      if (dailyLimitReached && nextResumeTime) {
        if (Date.now() < nextResumeTime) {
          const hoursLeft = (nextResumeTime - Date.now()) / (1000 * 60 * 60)
          console.log(`⏸️  Waiting for daily limit reset... ${hoursLeft.toFixed(1)}h remaining`)
          await new Promise(r => setTimeout(r, 60 * 60 * 1000)) // Wait 1 hour and check again
          continue
        } else {
          // Time to resume
          console.log('\n' + '='.repeat(60))
          console.log('🔄 AUTO-RESUMING AFTER DAILY LIMIT RESET')
          console.log('='.repeat(60) + '\n')
          dailyLimitReached = false
          nextResumeTime = null
        }
      }

      const result = await syncToShopify()

      if (result.complete) {
        console.log('\n' + '='.repeat(60))
        console.log('🎉 ALL PARTS SYNCED!')
        console.log('='.repeat(60))
        console.log(`✅ Completed at: ${new Date().toLocaleString()}`)
        console.log('='.repeat(60) + '\n')
        
        // Keep worker alive but idle
        await new Promise(r => setTimeout(r, 60000))
        continue
      }

      if (result.dailyLimitReached) {
        console.log('\n' + '='.repeat(60))
        console.log('🛑 SHOPIFY DAILY VARIANT LIMIT REACHED')
        console.log('='.repeat(60))
        
        // Calculate tomorrow at 00:01 UTC
        const now = new Date()
        const tomorrow = new Date(now)
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
        tomorrow.setUTCHours(0, 1, 0, 0)
        
        nextResumeTime = tomorrow.getTime()
        dailyLimitReached = true
        
        const hoursUntilResume = (nextResumeTime - Date.now()) / (1000 * 60 * 60)
        
        console.log(`⏰ Will auto-resume at: ${tomorrow.toLocaleString()}`)
        console.log(`⏱️  Time until resume: ${hoursUntilResume.toFixed(1)} hours`)
        console.log(`📍 Current progress: ${result.progress} / ${result.total}`)
        console.log(`📦 Last part: ${result.last_part_number}`)
        console.log('='.repeat(60) + '\n')
        
        continue
      }

      // Normal delay between parts (3 seconds)
      await new Promise(r => setTimeout(r, 3000))

    } catch (err) {
      console.error('❌ Sync loop error:', err.message)
      await new Promise(r => setTimeout(r, 5000)) // wait before retry
    }
  }
}

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get("/", async (req, res) => {
  try {
    const progress = await SyncProgress.findOne()
    const percentage = progress ? ((progress.last_index / 133883) * 100).toFixed(2) : 0
    
    res.json({
      status: "running",
      dailyLimitReached,
      nextResumeTime: nextResumeTime ? new Date(nextResumeTime).toISOString() : null,
      progress: {
        current: progress?.last_index || 0,
        total: 133883,
        percentage: `${percentage}%`,
        lastPart: progress?.last_part_number || null
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------
async function start() {
  try {
    // Connect to MongoDB (using your existing variable name)
    await mongoose.connect(process.env.MONGO_URI)
    console.log("✅ MongoDB connected")

    // Ensure progress document exists
    let progress = await SyncProgress.findOne()
    if (!progress) {
      progress = await SyncProgress.create({
        last_index: 0,
        last_part_number: ""
      })
      console.log("📝 Created initial progress document")
    } else {
      console.log(`📍 Resuming from index: ${progress.last_index}`)
    }

    // Start Express server
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`)
    })

    // Start infinite worker loop
    runShopifySyncLoop()

  } catch (err) {
    console.error("❌ Startup error:", err.message)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Received SIGINT signal')
  await mongoose.connection.close()
  console.log('✅ MongoDB connection closed')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Received SIGTERM signal')
  await mongoose.connection.close()
  console.log('✅ MongoDB connection closed')
  process.exit(0)
})

start()