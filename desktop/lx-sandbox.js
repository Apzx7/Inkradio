/**
 * LX 音源沙箱窗口管理
 * 隐藏 BrowserWindow + contextBridge 执行不信任的音源脚本
 */

const { BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const zlib = require('zlib')

// 沙箱窗口实例
let sandboxWindow = null
let currentScriptId = ''
const pendingRequests = new Map()

// 音源存储路径
function getSourcesPath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'lx-sources.json')
}

// 创建沙箱窗口
async function createSandboxWindow() {
  if (sandboxWindow && !sandboxWindow.isDestroyed()) return sandboxWindow

  const partition = `persist:lx-sandbox-${crypto.randomBytes(4).toString('hex')}`

  sandboxWindow = new BrowserWindow({
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      spellcheck: false,
      webgl: false,
      images: false,
      enableWebSQL: false,
      disableDialogs: true,
      preload: path.join(__dirname, 'lx-preload.js'),
      session: session.fromPartition(partition)
    }
  })

  // 安全：拦截导航
  sandboxWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  sandboxWindow.webContents.on('will-redirect', (e) => e.preventDefault())
  sandboxWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())

  // 安全：拒绝新窗口
  sandboxWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 安全：拒绝所有权限
  sandboxWindow.webContents.session.setPermissionRequestHandler((_, __, resolve) => {
    resolve(false)
  })

  // 加载空白页面
  await sandboxWindow.loadURL('data:text/html,<html><body></body></html>')

  return sandboxWindow
}

// 监听沙箱事件
ipcMain.on('lx-sandbox:event', (_event, payload) => {
  // 脚本发送的事件（如 inited）
})

ipcMain.on('lx-sandbox:response', (_event, payload) => {
  const pending = pendingRequests.get(payload.requestKey)
  if (!pending) return

  clearTimeout(pending.timer)
  pendingRequests.delete(payload.requestKey)

  if (payload.error) {
    pending.reject(new Error(payload.error))
  } else {
    pending.resolve(payload.data)
  }
})

ipcMain.on('lx-sandbox:error', (_event, error) => {
  console.error('[LX Sandbox Error]', error.message, error.filename || '')
})

// 注册 HTTP 请求处理器
function registerHttpHandler() {
  const needle = require('needle')

  ipcMain.handle('lx-sandbox:http-request', async (_event, opts) => {
    try {
      const response = await needle(opts.method || 'GET', opts.url, {
        headers: opts.headers || {},
        timeout: opts.timeout || 10000,
        parse: false
      })
      return {
        ok: true,
        data: {
          statusCode: response.statusCode,
          headers: response.headers,
          body: response.body.toString()
        }
      }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

// 注册音源管理 IPC handlers
function registerSourceHandlers() {
  // 导入音源
  ipcMain.handle('lx-source:import', async (event) => {
    const { dialog } = require('electron')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no window' }

    try {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JavaScript', extensions: ['js'] }]
      })
      if (result.canceled) return { ok: false, error: 'canceled' }

      const scriptCode = fs.readFileSync(result.filePaths[0], 'utf-8')
      const meta = parseScriptMeta(scriptCode)
      const id = crypto.randomBytes(4).toString('hex')

      // 压缩存储
      const compressed = zlib.deflateSync(Buffer.from(scriptCode, 'utf-8'))
      const encoded = 'gz_' + compressed.toString('base64')

      // 保存
      const sources = loadSources()
      sources.push({
        id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        script: encoded,
        enabled: true
      })
      saveSources(sources)

      return {
        ok: true,
        data: { id, name: meta.name, description: meta.description, version: meta.version, author: meta.author }
      }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 从代码字符串导入音源（URL 导入用）
  ipcMain.handle('lx-source:import-code', async (_event, scriptCode) => {
    try {
      const meta = parseScriptMeta(scriptCode)
      const id = crypto.randomBytes(4).toString('hex')

      const compressed = zlib.deflateSync(Buffer.from(scriptCode, 'utf-8'))
      const encoded = 'gz_' + compressed.toString('base64')

      const sources = loadSources()
      sources.push({
        id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        script: encoded,
        enabled: true
      })
      saveSources(sources)

      return {
        ok: true,
        data: { id, name: meta.name, description: meta.description, version: meta.version, author: meta.author }
      }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 删除音源
  ipcMain.handle('lx-source:delete', async (_event, sourceId) => {
    try {
      const sources = loadSources().filter(s => s.id !== sourceId)
      saveSources(sources)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 获取音源列表
  ipcMain.handle('lx-source:list', async () => {
    try {
      const sources = loadSources().map(({ script, ...rest }) => rest)
      return { ok: true, data: sources }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 搜索音乐
  ipcMain.handle('lx-source:search', async (_event, sourceId, keyword, page) => {
    try {
      const result = await sendToSandbox(sourceId, {
        source: getSourceName(sourceId),
        action: 'musicSearch',
        info: { keyword: keyword, page: page || 1 }
      })
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 获取播放 URL
  ipcMain.handle('lx-source:get-url', async (_event, sourceId, musicInfo, quality) => {
    try {
      const result = await sendToSandbox(sourceId, {
        source: musicInfo.source || getSourceName(sourceId),
        action: 'musicUrl',
        info: { type: quality || '320k', musicInfo }
      })
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // 获取在线音频（主进程 fetch，绕过 CORS）
  ipcMain.handle('lx-source:fetch-audio', async (_event, url) => {
    try {
      const needle = require('needle')
      const response = await needle('get', url, { timeout: 30000, parse: false, follow_max: 5 })
      const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)
      return { ok: true, data: buffer.buffer }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

// 发送请求到沙箱中的脚本
async function sendToSandbox(sourceId, data, timeout = 20000) {
  if (!sandboxWindow || sandboxWindow.isDestroyed()) {
    await createSandboxWindow()
  }

  // 确保脚本已加载
  if (currentScriptId !== sourceId) {
    await loadScriptIntoSandbox(sourceId)
  }

  const requestKey = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestKey)
      reject(new Error(`Request timeout after ${timeout}ms`))
    }, timeout)

    pendingRequests.set(requestKey, { resolve, reject, timer })
    sandboxWindow.webContents.send('lx-sandbox:request', { requestKey, data })
  })
}

// 加载脚本到沙箱
async function loadScriptIntoSandbox(sourceId) {
  const sources = loadSources()
  const source = sources.find(s => s.id === sourceId)
  if (!source) throw new Error(`Source not found: ${sourceId}`)

  // 解压脚本
  let scriptCode
  if (source.script.startsWith('gz_')) {
    const data = Buffer.from(source.script.slice(3), 'base64')
    scriptCode = zlib.inflateSync(data).toString('utf-8')
  } else {
    scriptCode = source.script
  }

  // 重新加载空白页面
  await sandboxWindow.loadURL('data:text/html,<html><body></body></html>')

  // 注入脚本
  await sandboxWindow.webContents.executeJavaScript(scriptCode)
  currentScriptId = sourceId

  // 等待脚本初始化
  await new Promise(resolve => setTimeout(resolve, 500))
}

// 解析脚本元数据
function parseScriptMeta(code) {
  const nameMatch = code.match(/@name\s+(.+)/)
  const descMatch = code.match(/@description\s+(.+)/)
  const versionMatch = code.match(/@version\s+(.+)/)
  const authorMatch = code.match(/@author\s+(.+)/)
  return {
    name: nameMatch?.[1]?.trim() || 'Unknown Source',
    description: descMatch?.[1]?.trim() || '',
    version: versionMatch?.[1]?.trim() || '1.0.0',
    author: authorMatch?.[1]?.trim() || 'Unknown'
  }
}

// 获取音源的第一个源名称
function getSourceName(sourceId) {
  const sources = loadSources()
  const source = sources.find(s => s.id === sourceId)
  if (!source) return ''
  // 从脚本中提取源名
  const match = source.name?.match(/(\w+)/)
  return match?.[1] || 'default'
}

// 加载音源列表
function loadSources() {
  try {
    const filePath = getSourcesPath()
    if (!fs.existsSync(filePath)) return []
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

// 保存音源列表
function saveSources(sources) {
  const filePath = getSourcesPath()
  fs.writeFileSync(filePath, JSON.stringify(sources, null, 2))
}

// 销毁沙箱
async function destroySandbox() {
  for (const [key, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Sandbox destroyed'))
  }
  pendingRequests.clear()

  if (sandboxWindow && !sandboxWindow.isDestroyed()) {
    await sandboxWindow.webContents.session.clearAuthCache()
    await sandboxWindow.webContents.session.clearStorageData()
    await sandboxWindow.webContents.session.clearCache()
    sandboxWindow.destroy()
  }
  sandboxWindow = null
  currentScriptId = ''
}

module.exports = {
  createSandboxWindow,
  registerHttpHandler,
  registerSourceHandlers,
  destroySandbox
}
