# 墨Radio

![image.png](https://cdn.jsdelivr.net/gh/Apzx7/obsidian-images/img/20260630224205128.png)

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

### 环境要求

- Node.js >= 18
- npm >= 9
- Windows 10/11 (x64)

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/Apzx7/Inkradio.git
cd Inkradio

# 安装依赖
npm install

# 启动开发模式
npm start
```

### 常用命令

```bash
npm start              # 启动 Electron 开发模式
npm run build:win      # 构建 Windows NSIS 安装包
npm run build:win:dir  # 构建免安装目录版本（调试用）
```

### 项目结构

```text
├── desktop/           # Electron 主进程
│   ├── main.js        # 入口：窗口管理、IPC、生命周期
│   ├── preload.js     # contextBridge API
│   ├── lx-sandbox.js  # LX 音源沙箱
│   └── lx-preload.js  # 沙箱 preload
├── public/            # 渲染进程（前端）
│   ├── index.html     # 主界面（1.3MB 单文件）
│   ├── radio-core.js  # 插件系统核心
│   ├── fluid-engine.js # 水墨流体引擎
│   ├── splash-shan-shui.js # 启动页
│   ├── plugins/       # 插件目录
│   │   ├── ink-cat/          # 墨猫桌宠
│   │   ├── gesture-control/  # 手势控制
│   │   └── ink-lyrics/       # 水墨歌词
│   └── vendor/        # 第三方库（Three.js、GSAP）
├── build/             # 安装器资源（图标、NSIS 脚本）
├── server.js          # 本地 API 服务器
├── dj-analyzer.js     # 节拍分析
└── package.json
```

### 调试技巧

- `Ctrl+Shift+I` 打开 DevTools
- 主进程日志在终端输出
- 插件日志前缀：`[Plugin:xxx]`
- 流体引擎日志前缀：`[FluidEngine]`

### 构建安装包

```bash
# Windows NSIS 安装包
npm run build:win
# 输出：dist/墨Radio-0.1.0-Setup.exe

# 免安装目录版（调试用）
npm run build:win:dir
# 输出：dist/win-unpacked/墨Radio.exe
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
