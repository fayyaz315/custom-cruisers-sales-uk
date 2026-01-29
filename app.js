const express = require('express')
const { syncToShopify } = require('./sync-to-shopify')

const app = express()
const PORT = process.env.PORT || 3000

let isSyncing = false
let syncInterval = null
let dailyLimitReached = false
let nextResumeTime = null
let stats = {
  totalParts: 133883,
  currentIndex: 0,
  productsCreated: 0,
  lastPartNumber: null,
  startedAt: null,
  lastError: null
}

app.use(express.json())
app.set('view engine', 'ejs')
app.set('views', __dirname + '/views')

// Homepage
app.get('/', (req, res) => {
  const progress = stats.currentIndex > 0 ? ((stats.currentIndex / stats.totalParts) * 100).toFixed(2) : 0
  const remaining = stats.totalParts - stats.currentIndex
  
  let eta = 'Calculating...'
  if (stats.startedAt && stats.currentIndex > 0) {
    const elapsed = (Date.now() - stats.startedAt) / 1000
    const rate = stats.currentIndex / elapsed
    const remainingSeconds = remaining / rate
    const hours = Math.floor(remainingSeconds / 3600)
    const minutes = Math.floor((remainingSeconds % 3600) / 60)
    eta = `${hours}h ${minutes}m`
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shopify Parts Sync</title>
      <meta http-equiv="refresh" content="10">
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 30px;
        }
        .status {
          font-size: 24px;
          font-weight: bold;
          margin: 20px 0;
          padding: 15px;
          border-radius: 5px;
        }
        .status.running {
          background: #d4edda;
          color: #155724;
        }
        .status.stopped {
          background: #f8d7da;
          color: #721c24;
        }
        .status.waiting {
          background: #fff3cd;
          color: #856404;
        }
        .progress-bar {
          width: 100%;
          height: 30px;
          background: #e9ecef;
          border-radius: 15px;
          overflow: hidden;
          margin: 20px 0;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4CAF50, #45a049);
          transition: width 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
        }
        .stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 20px 0;
        }
        .stat-box {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 5px;
          border-left: 4px solid #4CAF50;
        }
        .stat-label {
          color: #666;
          font-size: 14px;
          margin-bottom: 5px;
        }
        .stat-value {
          color: #333;
          font-size: 24px;
          font-weight: bold;
        }
        .buttons {
          margin-top: 30px;
          display: flex;
          gap: 10px;
        }
        button {
          padding: 12px 24px;
          font-size: 16px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.3s ease;
        }
        .btn-start {
          background: #4CAF50;
          color: white;
        }
        .btn-start:hover {
          background: #45a049;
        }
        .btn-stop {
          background: #f44336;
          color: white;
        }
        .btn-stop:hover {
          background: #da190b;
        }
        .btn-start:disabled, .btn-stop:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .info {
          background: #e7f3ff;
          padding: 15px;
          border-radius: 5px;
          margin-top: 20px;
          border-left: 4px solid #2196F3;
        }
        .error {
          background: #ffe7e7;
          padding: 15px;
          border-radius: 5px;
          margin-top: 20px;
          border-left: 4px solid #f44336;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔄 Shopify Parts Sync Dashboard</h1>
        
        <div class="status ${isSyncing ? 'running' : (dailyLimitReached ? 'waiting' : 'stopped')}">
          ${isSyncing ? '🟢 Sync Running' : (dailyLimitReached ? '⏸️ Waiting for Daily Limit Reset' : '🔴 Sync Stopped')}
        </div>
        
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%">
            ${progress}%
          </div>
        </div>
        
        <div class="stats">
          <div class="stat-box">
            <div class="stat-label">Current Progress</div>
            <div class="stat-value">${stats.currentIndex.toLocaleString()} / ${stats.totalParts.toLocaleString()}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Remaining Parts</div>
            <div class="stat-value">${remaining.toLocaleString()}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Products Created</div>
            <div class="stat-value">${stats.productsCreated.toLocaleString()}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Estimated Time</div>
            <div class="stat-value">${eta}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Last Part Number</div>
            <div class="stat-value" style="font-size: 18px;">${stats.lastPartNumber || 'N/A'}</div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Status</div>
            <div class="stat-value" style="font-size: 16px;">
              ${isSyncing ? 'Processing...' : (dailyLimitReached ? 'Waiting' : 'Idle')}
            </div>
          </div>
        </div>
        
        ${dailyLimitReached && nextResumeTime ? `
          <div class="info">
            <strong>⏰ Auto-Resume Scheduled:</strong><br>
            ${new Date(nextResumeTime).toLocaleString()}<br>
            <small>Shopify's daily variant limit has been reached. Sync will automatically resume when the limit resets.</small>
          </div>
        ` : ''}
        
        ${stats.lastError ? `
          <div class="error">
            <strong>⚠️ Last Error:</strong><br>
            ${stats.lastError}
          </div>
        ` : ''}
        
        <div class="buttons">
          <button class="btn-start" onclick="startSync()" ${isSyncing ? 'disabled' : ''}>
            ▶️ Start Sync
          </button>
          <button class="btn-stop" onclick="stopSync()" ${!isSyncing ? 'disabled' : ''}>
            ⏹️ Stop Sync
          </button>
        </div>
        
        <div class="info" style="margin-top: 30px;">
          <strong>ℹ️ About:</strong><br>
          This page auto-refreshes every 10 seconds. The sync runs continuously and will automatically handle Shopify's daily variant creation limits by pausing and resuming the next day.
        </div>
      </div>
      
      <script>
        function startSync() {
          fetch('/api/sync/start', { method: 'POST' })
            .then(() => location.reload())
        }
        
        function stopSync() {
          fetch('/api/sync/stop', { method: 'POST' })
            .then(() => location.reload())
        }
      </script>
    </body>
    </html>
  `)
})

// Check for daily limit reset every hour
setInterval(() => {
  if (dailyLimitReached && nextResumeTime && Date.now() >= nextResumeTime) {
    console.log('🔄 Auto-resuming sync after daily limit reset...')
    dailyLimitReached = false
    nextResumeTime = null
    stats.lastError = null
    startSync()
  }
}, 60 * 60 * 1000) // Check every hour

function startSync() {
  if (isSyncing) {
    console.log('Sync already running')
    return
  }
  
  isSyncing = true
  dailyLimitReached = false
  if (!stats.startedAt) stats.startedAt = Date.now()
  
  console.log('🚀 Starting sync...')
  
  syncInterval = setInterval(async () => {
    if (!isSyncing || dailyLimitReached) {
      clearInterval(syncInterval)
      return
    }
    
    try {
      const result = await syncToShopify()
      
      // Update stats
      if (result.progress) stats.currentIndex = result.progress
      if (result.last_part_number) stats.lastPartNumber = result.last_part_number
      if (!result.error) stats.productsCreated++
      
      if (result.complete) {
        console.log('✅ Sync complete!')
        isSyncing = false
        clearInterval(syncInterval)
        stats.lastError = null
      } else if (result.dailyLimitReached) {
        console.log('🛑 Daily limit reached - will auto-resume tomorrow')
        
        // Calculate tomorrow at 00:01 UTC (when Shopify resets limits)
        const now = new Date()
        const tomorrow = new Date(now)
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
        tomorrow.setUTCHours(0, 1, 0, 0) // 00:01 UTC
        
        nextResumeTime = tomorrow.getTime()
        dailyLimitReached = true
        stats.lastError = 'Daily variant creation limit reached. Will auto-resume tomorrow.'
        
        const hoursUntilResume = (nextResumeTime - Date.now()) / (1000 * 60 * 60)
        console.log(`⏰ Will auto-resume at ${tomorrow.toISOString()}`)
        console.log(`   (in ${hoursUntilResume.toFixed(1)} hours)`)
        
        clearInterval(syncInterval)
      } else if (result.error) {
        stats.lastError = result.error
      }
    } catch (e) {
      console.error('Sync error:', e.message)
      stats.lastError = e.message
    }
  }, 3000)
}

function stopSync() {
  isSyncing = false
  dailyLimitReached = false
  nextResumeTime = null
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
  console.log('🛑 Sync stopped manually')
}

// API endpoints
app.post('/api/sync/start', (req, res) => {
  startSync()
  res.json({ 
    message: 'Sync started',
    dailyLimitReached,
    nextResumeTime: nextResumeTime ? new Date(nextResumeTime).toISOString() : null
  })
})

app.post('/api/sync/stop', (req, res) => {
  stopSync()
  res.json({ message: 'Sync stopped' })
})

app.get('/api/sync/status', (req, res) => {
  res.json({ 
    syncing: isSyncing,
    dailyLimitReached,
    nextResumeTime: nextResumeTime ? new Date(nextResumeTime).toISOString() : null,
    stats
  })
})

// Auto-start sync on server startup
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`🚀 Auto-starting sync...`)
  startSync()
})