/**
 * 墨Radio 核心 — 事件总线 + 命令系统 + 插件管理
 * "Everything is Plugin" 架构的基础设施
 */

(function () {
  'use strict';

  // ─── 事件总线 ─────────────────────────────────────────────
  function EventBus() {
    this._handlers = {};
  }

  EventBus.prototype.on = function (event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return function () {
      this.off(event, handler);
    }.bind(this);
  };

  EventBus.prototype.off = function (event, handler) {
    var list = this._handlers[event];
    if (!list) return;
    var idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  };

  EventBus.prototype.emit = function (event, data) {
    var list = this._handlers[event];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (err) {
        console.error('[RadioEvent] Error in "' + event + '":', err);
      }
    }
  };

  EventBus.prototype.once = function (event, handler) {
    var self = this;
    var wrapper = function (data) {
      self.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  };

  // ─── 命令注册表 ───────────────────────────────────────────
  function CommandRegistry() {
    this._commands = {};
  }

  CommandRegistry.prototype.register = function (id, handler) {
    this._commands[id] = handler;
  };

  CommandRegistry.prototype.execute = function (id) {
    var handler = this._commands[id];
    if (!handler) {
      console.warn('[RadioCommand] Unknown:', id);
      return null;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      return handler.apply(null, args);
    } catch (err) {
      console.error('[RadioCommand] Error "' + id + '":', err);
      return null;
    }
  };

  CommandRegistry.prototype.getAll = function () {
    return Object.keys(this._commands);
  };

  CommandRegistry.prototype.has = function (id) {
    return !!this._commands[id];
  };

  // ─── 插件存储 ─────────────────────────────────────────────
  function PluginStorage(prefix) {
    this._prefix = prefix || 'radio-plugin:';
  }

  PluginStorage.prototype.get = function (key) {
    try {
      var raw = localStorage.getItem(this._prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  PluginStorage.prototype.set = function (key, value) {
    try {
      localStorage.setItem(this._prefix + key, JSON.stringify(value));
    } catch (e) { console.warn('[RadioStorage] Save failed:', key); }
  };

  PluginStorage.prototype.delete = function (key) {
    localStorage.removeItem(this._prefix + key);
  };

  // ─── UI 挂载管理 ──────────────────────────────────────────
  function UIManager() {
    this._slots = {};
    this._mounted = [];
  }

  // 注册 UI 挂载点
  UIManager.prototype.registerSlot = function (position, element) {
    this._slots[position] = element;
  };

  // 挂载 UI 组件到指定位置
  UIManager.prototype.mount = function (position, element) {
    var slot = this._slots[position];
    if (!slot) {
      // 如果没有预定义 slot，创建一个
      slot = document.createElement('div');
      slot.className = 'radio-plugin-slot radio-plugin-' + position;
      slot.style.cssText = 'position:fixed;z-index:150;pointer-events:auto;';
      if (position.includes('bottom')) slot.style.bottom = '80px';
      if (position.includes('top')) slot.style.top = '44px';
      if (position.includes('right')) slot.style.right = '24px';
      if (position.includes('left')) slot.style.left = '24px';
      document.body.appendChild(slot);
      this._slots[position] = slot;
    }
    slot.appendChild(element);
    this._mounted.push({ position: position, element: element, slot: slot });
  };

  // 移除 UI 组件
  UIManager.prototype.unmount = function (element) {
    for (var i = this._mounted.length - 1; i >= 0; i--) {
      if (this._mounted[i].element === element) {
        this._mounted[i].slot.removeChild(element);
        this._mounted.splice(i, 1);
        break;
      }
    }
  };

  // ─── 插件管理器 ───────────────────────────────────────────
  function PluginManager() {
    this._plugins = {};
    this._active = {};
    this._ctx = null;
    this._pluginDir = 'plugins';
  }

  PluginManager.prototype.init = function (ctx) {
    this._ctx = ctx;
  };

  // 设置插件目录
  PluginManager.prototype.setPluginDir = function (dir) {
    this._pluginDir = dir;
  };

  // 从 manifest.json 加载单个插件
  PluginManager.prototype.loadFromManifest = async function (manifestUrl) {
    try {
      var resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error('Failed to fetch manifest: ' + resp.status);
      var manifest = await resp.json();
      if (!manifest.id || !manifest.entry) {
        console.warn('[RadioPlugin] Invalid manifest:', manifestUrl);
        return null;
      }

      // 解析入口路径（构造完整 URL）
      var baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
      var entry = manifest.entry || './index.js';
      // 去掉 ./ 前缀，拼接完整路径
      if (entry.startsWith('./')) entry = entry.substring(2);
      var entryUrl = baseUrl + entry;

      // 注册插件（延迟加载入口）
      this._plugins[manifest.id] = {
        manifest: manifest,
        instance: null,
        entryUrl: entryUrl,
        loaded: false
      };

      console.log('[RadioPlugin] Registered:', manifest.id);
      return manifest;
    } catch (err) {
      console.warn('[RadioPlugin] Failed to load manifest:', manifestUrl, err);
      return null;
    }
  };

  // 加载并激活插件
  PluginManager.prototype.loadAndActivate = async function (id) {
    var entry = this._plugins[id];
    if (!entry || entry.loaded) return;

    try {
      // import() 需要完整 URL 或以 ./ 开头的相对路径
      var url = entry.entryUrl;
      if (!url.startsWith('http') && !url.startsWith('./') && !url.startsWith('/')) {
        url = './' + url;
      }
      console.log('[RadioPlugin] Loading:', id, 'from', url);
      var module = await import(url);
      entry.instance = module.default || module;

      // 如果插件自带 manifest，用它覆盖
      if (entry.instance && entry.instance.manifest) {
        entry.manifest = { ...entry.manifest, ...entry.instance.manifest };
      }

      entry.loaded = true;
      this.activate(id);
    } catch (err) {
      console.error('[RadioPlugin] Failed to load "' + id + '":', err);
    }
  };

  // 自动扫描并注册 plugins/ 目录下的所有插件（不激活）
  PluginManager.prototype.loadAll = async function () {
    try {
      var manifestFiles = await this._scanPluginDir();
      var self = this;

      for (var i = 0; i < manifestFiles.length; i++) {
        await self.loadFromManifest(manifestFiles[i]);
      }

      var ids = Object.keys(this._plugins);
      console.log('[RadioPlugin] Registered ' + ids.length + ' plugins (not activated)');
      this._ctx.events.emit('plugins:registered', { count: ids.length });
    } catch (err) {
      console.error('[RadioPlugin] Failed to load plugins:', err);
    }
  };

  // 扫描插件目录
  PluginManager.prototype._scanPluginDir = async function () {
    var dir = this._pluginDir;
    var manifests = [];

    // 已知插件列表（可通过服务器目录列表动态获取）
    var knownPlugins = ['ink-cat', 'gesture-control'];

    for (var i = 0; i < knownPlugins.length; i++) {
      var manifestPath = dir + '/' + knownPlugins[i] + '/manifest.json';
      try {
        var resp = await fetch(manifestPath);
        if (resp.ok) {
          var text = await resp.text();
          if (text && text.includes('"id"')) {
            manifests.push(manifestPath);
            console.log('[RadioPlugin] Found manifest:', manifestPath);
          }
        }
      } catch (e) {
        // 插件不存在，跳过
      }
    }

    return manifests;
  };

  // 注册插件
  PluginManager.prototype.register = function (manifest, instance) {
    if (!manifest || !manifest.id) {
      console.warn('[RadioPlugin] Invalid manifest');
      return;
    }
    this._plugins[manifest.id] = {
      manifest: manifest,
      instance: instance || null
    };
  };

  // 激活插件（如果未加载代码则先加载）
  PluginManager.prototype.activate = async function (id) {
    var entry = this._plugins[id];
    if (!entry) {
      console.warn('[RadioPlugin] Unknown:', id);
      return;
    }
    if (this._active[id]) return;

    // 如果插件代码未加载，先加载
    if (!entry.loaded && entry.entryUrl) {
      await this.loadAndActivate(id);
      return;
    }

    try {
      if (entry.instance && entry.instance.activate) {
        var pluginCtx = this._createPluginCtx(id);
        entry.instance.activate(pluginCtx);
        this._active[id] = true;
        this._ctx.events.emit('plugin:activated', { id: id });
        console.log('[RadioPlugin] Activated:', id);
      }
    } catch (err) {
      console.error('[RadioPlugin] Activate failed "' + id + '":', err);
    }
  };

  // 停用插件（支持 async deactivate）
  PluginManager.prototype.deactivate = async function (id) {
    var entry = this._plugins[id];
    if (!entry || !this._active[id]) return;

    try {
      if (entry.instance && entry.instance.deactivate) {
        await entry.instance.deactivate();
      }
    } catch (err) {
      console.error('[RadioPlugin] Deactivate failed "' + id + '":', err);
    }
    delete this._active[id];
    this._ctx.events.emit('plugin:deactivated', { id: id });
    console.log('[RadioPlugin] Deactivated:', id);
  };

  // 权限常量
  var PERMISSIONS = {
    AUDIO_DATA: 'audio-data',
    MOUSE_EVENTS: 'mouse-events',
    CAMERA: 'camera',
    NETWORK: 'network',
    FILESYSTEM: 'filesystem',
    UI_MOUNT: 'ui-mount',
    COMMANDS: 'commands',
    STORAGE: 'storage'
  };

  // 创建插件上下文（根据权限暴露 API）
  PluginManager.prototype._createPluginCtx = function (pluginId) {
    var ctx = this._ctx;
    var entry = this._plugins[pluginId];
    var perms = (entry && entry.manifest && entry.manifest.permissions) || [];

    // 默认权限（所有插件都有）
    var hasAudio = perms.includes(PERMISSIONS.AUDIO_DATA);
    var hasUI = perms.includes(PERMISSIONS.UI_MOUNT);
    var hasCommands = perms.includes(PERMISSIONS.COMMANDS);
    var hasStorage = perms.includes(PERMISSIONS.STORAGE);

    // 构建上下文
    var self = this;
    var pluginCtx = {
      pluginId: pluginId,
      manifest: entry ? entry.manifest : {},

      // 事件总线（所有插件都可以用）
      events: ctx.events,

      // 权限查询
      hasPermission: function (perm) {
        return perms.includes(perm);
      },

      // 获取其他插件的导出 API
      require: function (targetId) {
        var target = self._plugins[targetId];
        if (!target || !target.instance) {
          console.warn('[RadioPlugin] Cannot require "' + targetId + '": not loaded');
          return null;
        }
        // 返回插件的导出（如果有的话）
        if (target.instance.exports) return target.instance.exports;
        // 否则返回插件实例本身（用于直接调用方法）
        return target.instance;
      },

      // 获取插件设置
      getSetting: function (key, defaultVal) {
        try {
          var stored = localStorage.getItem('radio-plugin:' + pluginId + ':setting:' + key);
          return stored !== null ? JSON.parse(stored) : (defaultVal !== undefined ? defaultVal : null);
        } catch (e) { return defaultVal !== undefined ? defaultVal : null; }
      },

      // 日志
      log: function () {
        var args = ['[Plugin:' + pluginId + ']'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
      }
    };

    // 音频 API（需要 audio-data 权限，包装错误处理）
    if (hasAudio) {
      function safeWrap(fn) {
        return function (data) {
          try { fn(data); } catch (err) {
            console.error('[Plugin:' + pluginId + '] Error in audio handler:', err);
          }
        };
      }
      pluginCtx.audio = {
        onData: function (callback) { return ctx.events.on('audio:data', safeWrap(callback)); },
        onBeat: function (callback) { return ctx.events.on('audio:beat', safeWrap(callback)); },
        onTrackChange: function (callback) { return ctx.events.on('audio:track-change', safeWrap(callback)); },
        onPlay: function (callback) { return ctx.events.on('player:play', safeWrap(callback)); },
        onPause: function (callback) { return ctx.events.on('player:pause', safeWrap(callback)); }
      };
    }

    // UI API（需要 ui-mount 权限，包装错误处理）
    if (hasUI) {
      pluginCtx.ui = {
        mount: function (position, element) {
          try { ctx.ui.mount(position, element); } catch (err) {
            console.error('[Plugin:' + pluginId + '] UI mount error:', err);
          }
        },
        unmount: function (element) {
          try { ctx.ui.unmount(element); } catch (err) {
            console.error('[Plugin:' + pluginId + '] UI unmount error:', err);
          }
        }
      };
    }

    // 命令 API（需要 commands 权限）
    if (hasCommands) {
      pluginCtx.commands = {
        register: function (id, handler) { ctx.commands.register(pluginId + ':' + id, handler); },
        execute: function (id) {
          var args = Array.prototype.slice.call(arguments);
          args[0] = pluginId + ':' + id;
          return ctx.commands.execute.apply(ctx.commands, args);
        }
      };
    }

    // 存储 API（需要 storage 权限）
    if (hasStorage) {
      pluginCtx.storage = {
        get: function (key) { return ctx.storage.get(pluginId + ':' + key); },
        set: function (key, value) { ctx.storage.set(pluginId + ':' + key, value); },
        delete: function (key) { ctx.storage.delete(pluginId + ':' + key); }
      };
    }

    return pluginCtx;
  };

  // 列出所有插件
  PluginManager.prototype.list = function () {
    var result = [];
    for (var id in this._plugins) {
      var entry = this._plugins[id];
      result.push({
        id: id,
        name: entry.manifest.name || id,
        version: entry.manifest.version || '0.0.0',
        type: entry.manifest.type || 'unknown',
        active: !!this._active[id]
      });
    }
    return result;
  };

  // ─── 组装全局 Radio 对象 ──────────────────────────────────
  var events = new EventBus();
  var commands = new CommandRegistry();
  var storage = new PluginStorage();
  var ui = new UIManager();
  var plugins = new PluginManager();

  var ctx = {
    events: events,
    commands: commands,
    storage: storage,
    ui: ui
  };

  plugins.init(ctx);

  window.Radio = {
    events: events,
    commands: commands,
    storage: storage,
    ui: ui,
    plugins: plugins,
    permissions: PERMISSIONS,
    version: '0.2.0'
  };

  // 注册内置命令
  commands.register('radio.play', function () { events.emit('player:play'); });
  commands.register('radio.pause', function () { events.emit('player:pause'); });
  commands.register('radio.next', function () { events.emit('player:next'); });
  commands.register('radio.prev', function () { events.emit('player:prev'); });
  commands.register('radio.toggle-play', function () { events.emit('player:toggle-play'); });

  console.log('[Radio] Core v0.1.0 — events, commands, storage, ui, plugins');
})();
