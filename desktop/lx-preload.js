/**
 * LX 音源沙箱 Preload
 * 暴露 window.lx 对象给沙箱中的音源脚本
 * 协议兼容洛雪音乐自定义音源
 */

const { contextBridge, ipcRenderer } = require('electron')
const crypto = require('crypto')
const zlib = require('zlib')
const CryptoJS = require('crypto-js')

// 事件处理器
const requestHandlers = new Map()

// 事件白名单
const ALLOWED_SEND_EVENTS = new Set(['inited', 'updateAlert'])
const ALLOWED_ON_EVENTS = new Set(['request'])

contextBridge.exposeInMainWorld('lx', {
  version: '2.0.0',
  env: 'desktop',
  currentScriptInfo: {},

  // 向宿主发送事件
  send(event, data) {
    if (!ALLOWED_SEND_EVENTS.has(event)) return
    ipcRenderer.send('lx-sandbox:event', { event, data })
  },

  // 注册事件处理器
  on(event, handler) {
    if (!ALLOWED_ON_EVENTS.has(event)) return
    requestHandlers.set(event, handler)
  },

  // HTTP 请求代理（走主进程 needle）
  async request(url, options = {}) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('Invalid URL: must start with http:// or https://')
    }
    if (url.length > 2048) {
      throw new Error('URL too long: max 2048 characters')
    }
    const result = await ipcRenderer.invoke('lx-sandbox:http-request', {
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null,
      timeout: Math.min(options.timeout || 10000, 60000),
      form: options.form || null
    })
    if (!result.ok) throw new Error(result.error)
    return result.data
  },

  // 工具函数
  utils: {
    crypto: {
      aesEncrypt(data, mode, key, iv) {
        const keyBytes = CryptoJS.enc.Utf8.parse(key)
        const ivBytes = iv ? CryptoJS.enc.Utf8.parse(iv) : CryptoJS.enc.Utf8.parse('')
        const dataBytes = CryptoJS.enc.Utf8.parse(data)
        const modeMap = { 'aes-ecb': CryptoJS.mode.ECB, 'aes-cbc': CryptoJS.mode.CBC }
        const encrypted = CryptoJS.AES.encrypt(dataBytes, keyBytes, {
          mode: modeMap[mode] || CryptoJS.mode.ECB,
          iv: ivBytes,
          padding: CryptoJS.pad.Pkcs7
        })
        return encrypted.toString()
      },
      aesDecrypt(data, mode, key, iv) {
        const keyBytes = CryptoJS.enc.Utf8.parse(key)
        const ivBytes = iv ? CryptoJS.enc.Utf8.parse(iv) : CryptoJS.enc.Utf8.parse('')
        const modeMap = { 'aes-ecb': CryptoJS.mode.ECB, 'aes-cbc': CryptoJS.mode.CBC }
        const decrypted = CryptoJS.AES.decrypt(data, keyBytes, {
          mode: modeMap[mode] || CryptoJS.mode.ECB,
          iv: ivBytes,
          padding: CryptoJS.pad.Pkcs7
        })
        return decrypted.toString(CryptoJS.enc.Utf8)
      },
      md5(data) {
        return CryptoJS.MD5(data).toString()
      },
      rsaEncrypt(data, publicKey) {
        try {
          return crypto.publicEncrypt(publicKey, Buffer.from(data)).toString('base64')
        } catch {
          return data
        }
      },
      randomBytes(size) {
        return crypto.randomBytes(size)
      }
    },

    buffer: {
      from(data, encoding) {
        return Buffer.from(data, encoding)
      },
      bufToString(buffer, encoding) {
        if (Buffer.isBuffer(buffer)) return buffer.toString(encoding || 'utf-8')
        return String(buffer)
      }
    },

    zlib: {
      inflate(data, callback) {
        zlib.inflate(Buffer.from(data), (err, result) => {
          if (callback) callback(err, result)
        })
      },
      deflate(data, callback) {
        zlib.deflate(Buffer.from(data), (err, result) => {
          if (callback) callback(err, result)
        })
      },
      inflateSync(data) {
        return zlib.inflateSync(Buffer.from(data))
      },
      deflateSync(data) {
        return zlib.deflateSync(Buffer.from(data))
      }
    }
  }
})

// 监听主进程发来的请求，转发给脚本 handler
ipcRenderer.on('lx-sandbox:request', async (_event, { requestKey, data }) => {
  const handler = requestHandlers.get('request')
  if (!handler) {
    ipcRenderer.send('lx-sandbox:response', { requestKey, error: 'No request handler registered' })
    return
  }

  try {
    const result = await handler(data)

    // 校验响应
    if (data.action === 'musicUrl' || data.action === 'pic') {
      if (typeof result !== 'string') {
        ipcRenderer.send('lx-sandbox:response', { requestKey, error: 'Invalid response type' })
        return
      }
      if (!/^https?:\/\//.test(result)) {
        ipcRenderer.send('lx-sandbox:response', { requestKey, error: 'Invalid URL format' })
        return
      }
      if (result.length > 2048) {
        ipcRenderer.send('lx-sandbox:response', { requestKey, error: 'URL too long' })
        return
      }
    }

    ipcRenderer.send('lx-sandbox:response', { requestKey, data: result })
  } catch (err) {
    ipcRenderer.send('lx-sandbox:response', { requestKey, error: String(err) })
  }
})

// 错误捕获
window.addEventListener('error', (e) => {
  ipcRenderer.send('lx-sandbox:error', { message: e.message, filename: e.filename })
})
window.addEventListener('unhandledrejection', (e) => {
  ipcRenderer.send('lx-sandbox:error', { message: String(e.reason) })
})
