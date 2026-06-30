# 墨Radio

![墨Radio](./docs/assets/readme/cinema-beat-smoke.png)

**墨Radio** 是一款 Windows 桌面沉浸式音乐播放器，基于 Mineradio 二创，采用「一切皆插件」架构，实现水墨风格视觉效果。

## 核心特性

### 🎨 水墨视觉系统

- **水墨流体引擎** — WebGL Navier-Stokes 流体模拟，封面颜色映射
- **千里江山图启动页** — 程序化山水 shader + 墨滴转场
- **粒子系统** — Three.js 粒子 + 水墨色调 + 宣纸纹理
- **印章元素** — 暂停时显示歌曲名印章

### 🧩 插件架构（一切皆插件）

- **EventBus** — 全局事件总线
- **CommandRegistry** — 命令注册/执行系统
- **PluginManager** — 插件生命周期管理（manifest.json + ES module）
- **UIManager** — 插件 UI 挂载槽位系统
- **权限系统** — manifest 声明权限，运行时校验
- **插件设置 UI** — manifest settings 自动渲染为表单
- **插件间通信** — `ctx.require()` 获取其他插件 API
- **错误隔离** — 插件崩溃不影响主进程

### 🐱 内置插件

- **墨猫桌宠** — 随音乐摆动的水墨猫，挂载到 Home 页
- **手势控制** — MediaPipe Hands 手势识别，驱动流体效果

### 🎵 音乐功能（继承 Mineradio）

- 网易云音乐 / QQ 音乐搜索播放
- LX 音源脚本支持
- 歌词舞台 / 桌面歌词
- 3D 歌单架
- 天气电台
- 粒子视觉预设

## 插件开发

### 目录结构

```text
plugins/
├── ink-cat/
│   ├── manifest.json    ← 插件清单
│   └── index.js         ← ES module 入口
└── gesture-control/
    ├── manifest.json
    └── index.js
```

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "type": "ui-component",
  "description": "插件描述",
  "entry": "./index.js",
  "permissions": ["audio-data", "ui-mount", "storage"],
  "settings": {
    "sensitivity": { "type": "range", "min": 0.1, "max": 2.0, "default": 1.0 }
  }
}
```

### 插件入口 (index.js)

```javascript
export default {
  manifest: { id: 'my-plugin', name: '我的插件' },

  activate(ctx) {
    // 监听音频数据
    ctx.audio.onData((data) => {
      console.log(data.bass, data.mid, data.treble);
    });

    // 挂载 UI
    ctx.ui.mount('pet', myElement);

    // 读取设置
    const val = ctx.getSetting('sensitivity', 1.0);

    // 获取其他插件 API
    const otherPlugin = ctx.require('other-plugin-id');

    // 持久化存储
    ctx.storage.set('key', value);
  },

  deactivate() {
    // 清理资源
  }
};
```

### 插件权限

| 权限 | 说明 |
| ---- | ---- |
| `audio-data` | 监听音频数据 |
| `ui-mount` | 挂载 UI 组件 |
| `storage` | 持久化存储 |
| `camera` | 访问摄像头 |
| `commands` | 注册命令 |

## 开发运行

```bash
npm install
npm start
```

## 架构

```text
┌─────────────────────────────────────────┐
│  Electron 主进程                         │
│  ├── main.js        (窗口管理、IPC)      │
│  ├── preload.js     (contextBridge)     │
│  └── lx-sandbox.js  (音源沙箱)           │
├─────────────────────────────────────────┤
│  渲染进程                                 │
│  ├── index.html     (1.3MB 单文件)       │
│  ├── radio-core.js  (插件系统核心)        │
│  ├── fluid-engine.js (流体模拟)          │
│  ├── splash-shan-shui.js (启动页)        │
│  └── plugins/       (插件目录)            │
│      ├── ink-cat/                        │
│      └── gesture-control/                │
└─────────────────────────────────────────┘
```

## 版权与授权

基于 [Mineradio](https://github.com/XxHuberrr/Mineradio) 二创，原项目 GPL-3.0 授权。

Copyright (C) 2026 XxHuberrr. 二创部分遵循相同授权。
