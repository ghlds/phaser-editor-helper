# phaser-editor-helper

[中文文档](./README.zh-cn.md) | [English Documentation](./README.md)

[PhaserEditor](https://phaser.io/editor) 的接入助手

## 介绍

### `phaser-editor-helper` 是一个针对 Phaser Editor 设计的 Webpack 插件

### 插件做了哪些工作？

- 隔离 [PhaserEditor](https://phaser.io/editor) 产生的代码和产物，与Webpack的工程项目分离管理。
- 修正 [Only Generate Methods](https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html) 的产物：

  > [create](https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html) 和 [preload](https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html) 支持传入场景，不再使用 `call` 重定向，自动导出 [create]((https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html)) 和 [preload](https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html) 函数。

- 友好的 `typescript` 类型提示：
  > 当场景类型设置为 `typescript`，插件会为 [作用域设置为public的元素](https://help-v3.phasereditor2d.com/scene-editor/variable-properties.html) 和
  [作用域设置为public的脚本节点](https://help-v3.phasereditor2d.com/scene-editor/variable-properties.html) 进行类型推导，并且合并所有类型推导为 `SceneExtensions` 并统一导出。
- 静态资源管理：
  > 在构建时，保留了完整的静态资源相对路径的资源文件，无需在代码中修改静态资源的引入路径，可配置的剔除与项目无关的静态资源。
- 产出文件管理：
  > 可选择性剔除与开发无关的产物，并完整拷贝到指定目录中，组合式引用场景文件。

## 安装

```bash
npm install phaser-editor-helper --save-dev
```

## 使用说明

开始之前，需要指定一个Webpack的静态资源目录，作为 [PhaserEditor](https://phaser.io/editor) 的工作目录，例如 `/public` 或者 `/static`，他们可能比较常见的存在于你的Webpack项目中。

### 接入前准备工作

2. 在静态资源目录中，创建一个 [PhaserEditor](https://phaser.io/editor) 指定的 [`publicroot`](https://help-v3.phasereditor2d.com/asset-pack-editor/public-root.html) 文件
3. 创建一个包含场景、节点脚本等 [PhaserEditor](https://phaser.io/editor) 工作目录，例如：`/editor`

## 示例

示例项目结构如下：

```
project
├──public
|   └──assets
|   └──editor
|       └──scenes
|           └──Level
|               └──Scene.ts
|               └──Scene.scene
|       └──script-nodes
|       └──...
|   └──publicroot
├── src
|   └──editor
|       └──scenes
|       └──script-nodes
|   └──scenes
|       └──MyScene.ts
|       └──...
```

## 配置插件

- `watchDir`: 需要监视的目录。
- `outputDir`: 要拷贝的目录。
- `excludePatterns`: 排除不需要拷贝的文件类型。
- `conversionDir`: 需要进行二次处理的场景文件集。

在 webpack 配置中添加 `phaser-editor-helper` 插件：

```javascript
const PhaserEditorHelper = require("phaser-editor-helper");

module.exports = {
  // ...existing code...
  plugins: [
    new PhaserEditorHelper({
      watchDir: path.resolve(__dirname, "public/editor"),
      outputDir: path.resolve(__dirname, "src/editor"),
      conversionDir: path.resolve(__dirname, "public/editor/scenes"),
      excludePatterns: [".scene", ".json", ".components", "node_modules"],
    }),
  ],
};
```
### 选择 [Only Generate Methods](https://help-v3.phasereditor2d.com/scene-editor/scene-compiler-scene-settings.html) 来制作游戏
插件会根据你制作的场景，自动处理代码，并优化产出的代码，例如：`Level/Scene.ts`

```typescript
function preload(scene): void {
  scene.load.pack("asset-pack", "xxx/xxx/xxx/asset-pack.json");
}

function editorCreate(scene): void {
  //编辑器生成的代码...例如：
  const image_1 = scene.add.image(0, 0, "1");
  scene.image_1 = image_1;
  scene.events.emit("scene-awake");
}
// 二次处理生成对应类型，并抛出用于组合的方法
export { preload };
export { editorCreate };
type SceneExtensions = {
  image_1: Phaser.GameObjects.Image;
};
export type { SceneExtensions };
```

### 优雅的使用这些代码
在 `src/scenes/MyScene.ts` 中使用

```typescript
import {
  preload,
  editorCreate,
  type SceneExtensions,
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
    this.image_1.x = 0; // ...existing code...
  }
}
```

## 构建发布

> 由于工作目录在公共资源目录下，插件已经内置清除了与编辑器相关的资源，并且保留了完整路径的 `json` 文件，因为 `json` 文件是项目构建时，必备的产物，例如：`asset-pack.json`，你可以放心的执行：

```
npm run build
```

### 额外配置

> 项目中创建的 `publicroot` 只是一个用来给编辑器标识的空文件，但是使用此插件，可在 `publicroot` 文件中设置，要清除public目录下中不需要使用的某些垃圾文件，例如：

```
package.json
package-lock.json
node_modules
log.txt
...
```


## 许可证

[MIT](https://github.com/ghlds/phaser-editor-helper/blob/main/LICENSE)