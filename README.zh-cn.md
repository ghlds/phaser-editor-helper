# phaser-editor-helper

[中文文档](./README.zh-cn.md) | [English Documentation](./README.md)

Phaser编辑器接入助手

## 介绍

`phaser-editor-helper` 是一个 `webpack` 插件，旨在非侵入式地将 `Phaser Editor` 集成到使用 `webpack` 构建的游戏项目中，并对 `Phaser Editor` 的输出进行二次处理。

1. 筛选输出内容，排除与代码无关的文件，并将代码完整复制到项目中。
2. 优化 function 模式下的代码，将其转换为组合式代码。
3. 提供友好的 `Typescript` 类型提示，将编辑器中设置为 `public` 的元素统一声明类型并导出，特殊类型可在 `Typescript` 中自定义。

通过使用 `phaser-editor-helper`，开发者可以更方便地管理和使用 `Phaser Editor` 生成的代码，避免因 `Phaser Editor` 的输出混淆项目管理。

## 安装

```bash
npm install phaser-editor-helper --save-dev
```

## 功能说明

### 1. 代码转换

插件会将 function 模式下的代码转换为组合式代码，并为场景添加类型声明。

### 2. 文件监视

在开发模式下，插件会监视编辑器工作目录，自动转换代码并复制到项目中。

### 3. 清理非 JSON 文件

在生产模式下，插件会清理工作目录下的非 JSON 文件。生产模式不需要编辑器的工作文件，例如 `.scene` 等，并且打包时不会包含 `publicroot` 文件中存在的文件。

## 接入 Webpack 项目

### 接入前准备工作

1. 选择一个 webpack 设定好的静态资源目录，例如：`/public`
2. 创建 Phaser Editor 指定的 [`publicroot`](https://help-v3.phasereditor2d.com/asset-pack-editor/public-root.html) 文件
3. 创建一个包含场景、节点脚本等 Phaser Editor 工作目录，例如：`/editor`

## 配置选项

- `watchDir`: 需要监视的目录。
- `outputDir`: 输出目录。
- `excludePatterns`: 排除的文件模式，默认为空数组。
- `conversionDir`: 需要处理的目录。

## 示例

假设项目结构如下：

```
project
|—— public
|   └──assets
|   └──editor
|       └── scenes
|           └── Level
|               └── Scene.ts
|               └── Scene.scene
|       └── script-nodes
|   └──publicroot
├── src
|   └──editor
|       └── scenes
|       └── script-nodes
│   └── scenes
│       └── MyScene.ts
```

在 webpack 配置中添加 `phaser-editor-helper` 插件：

```javascript
const PhaserEditorHelper = require("phaser-editor-helper");

module.exports = {
  // ...existing code...
  plugins: [
    new PhaserEditorHelper({
      watchDir: path.resolve(__dirname, 'public/editor'), // 需要监视的目录
      outputDir: path.resolve(__dirname, 'src/editor'), // 输出目录
      excludePatterns: ['.scene', '.json', '.components', 'node_modules'], // 排除的文件模式
      conversionDir: "public/editor/scenes", // 需要转换的目录
    }),
  ],
};
```

在 `src/scenes/MyScene.ts` 文件中定义场景：

```typescript
import {
    preload,
    editorCreate,
    type SceneExtensions
} from "@/editor/scenes/Level/Scene";

export default class MyScene extends Phaser.Scene implements SceneExtensions {
    constructor() {
        super("MyScene");
    }
    image_1!: Phaser.GameObjects.Image; // 来自类型提示
    preload() {
        preload(this);
    }
    create() {
        editorCreate(this);
        this.image_1.x = 0 // ...existing code...
    }
}
```

插件会自动将 `MyScene` 函数转换为组合式代码，并为场景添加类型声明。
