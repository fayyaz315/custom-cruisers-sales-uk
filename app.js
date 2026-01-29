const express = require('express')
const { syncToShopify } = require('./sync-to-shopify')

const app = express()
const PORT = process.env.PORT || 3000

let isSyncing = false
let syncInterval = null
let dailyLimitReached = false
let nextResumeTime = null

app.use(express.json())

// Auto-resume check (runs every hour)
setInterval(() => {
  if (dailyLimitReached && nextResumeTime && Date.now() >= nextResumeTime) {
    console.log('🔄 Auto-resuming sync after daily limit reset...')
    dailyLimitReached = false
    nextResumeTime = null
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
  
  syncInterval = setInterval(async () => {
    if (!isSyncing || dailyLimitReached) {
      clearInterval(syncInterval)
      return
    }
    
    try {
      const result = await syncToShopify()
      
      if (result.complete) {
        console.log('✅ Sync complete!')
        isSyncing = false
        clearInterval(syncInterval)
      } else if (result.dailyLimitReached) {
        console.log('🛑 Daily limit reached - will auto-resume tomorrow')
        
        // Calculate tomorrow at 00:01 UTC (when Shopify resets limits)
        const now = new Date()
        const tomorrow = new Date(now)
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
        tomorrow.setUTCHours(0, 1, 0, 0) // 00:01 UTC
        
        nextResumeTime = tomorrow.getTime()
        dailyLimitReached = true
        
        const hoursUntilResume = (nextResumeTime - Date.now()) / (1000 * 60 * 60)
        console.log(`⏰ Will auto-resume at ${tomorrow.toISOString()}`)
        console.log(`   (in ${hoursUntilResume.toFixed(1)} hours)`)
        
        clearInterval(syncInterval)
      }
    } catch (e) {
      console.error('Sync error:', e.message)
    }
  }, 3000)
}

app.post('/api/sync/start', (req, res) => {
  startSync()
  res.json({ 
    message: 'Sync started',
    dailyLimitReached,
    nextResumeTime: nextResumeTime ? new Date(nextResumeTime).toISOString() : null
  })
})

app.post('/api/sync/stop', (req, res) => {
  isSyncing = false
  dailyLimitReached = false
  nextResumeTime = null
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
  res.json({ message: 'Sync stopped' })
})

app.get('/api/sync/status', (req, res) => {
  res.json({ 
    syncing: isSyncing,
    dailyLimitReached,
    nextResumeTime: nextResumeTime ? new Date(nextResumeTime).toISOString() : null
  })
})

// Auto-start sync on server startup
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`🚀 Auto-starting sync...`)
  startSync()
})
