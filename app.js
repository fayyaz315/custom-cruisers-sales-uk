require("dotenv").config()

const express =
  require("express")

const cors =
  require("cors")

const mongoose =
  require("mongoose")

const startInventoryLoop =
  require("./syncInventoryLoop")

const app = express()

app.use(cors())

app.use(express.json())

const PORT =
  process.env.NODE_ENV ===
  "production"
    ? process.env.PORT
    : 3000

function logSection(
  title
) {
  console.log(
    "\n" + "=".repeat(100)
  )

  console.log(
    `🚀 ${title}`
  )

  console.log(
    "=".repeat(100)
  )
}

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      res.json({
        status:
          "running",

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

    logSection(
      "STARTING REALTIME INVENTORY LOOP"
    )

    // startInventoryLoop()
  } catch (error) {
    logSection(
      "STARTUP ERROR"
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