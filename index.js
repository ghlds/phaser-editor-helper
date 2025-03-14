const fs = require('node:fs');
const path = require('node:path');
const chokidar = require('chokidar');
const { copyFileSync, existsSync } = fs;

const babel = require('@babel/core');
const t = require('@babel/types');

class PhaserEditorHelper {
    constructor(options) {
        this.watchDir = options.watchDir;
        this.outputDir = options.outputDir;
        this.excludePatterns = options.excludePatterns || [];
        this.conversionDir = options.conversionDir;

        // 是否已经开始监听
        this.isWatching = false;
    }

    apply(compiler) {
        if (compiler.options.mode === 'development') {
            compiler.hooks.afterEmit.tap('PhaserEditorHelper', () => {
                this.startWatching();
            });
        }
        if (compiler.options.mode === 'production') {
            compiler.hooks.afterDone.tap('PhaserEditorHelper', () => {
                const outputPath = compiler.options.output.path; // 获取 webpack 输出路径
                const watchDirName = path.basename(this.watchDir);
                const distDir = path.join(outputPath, watchDirName);
                this.cleanNonJsonFiles(distDir);
                this.cleanPublicRootFiles(outputPath);
            });
        }
    }

    startWatching() {
        if (this.isWatching) {
            return;
        }
        this.isWatching = true;

        const watcher = chokidar.watch(this.watchDir, {
            ignored: (path) => {
                return this.excludePatterns.some(pattern => path.includes(pattern));
            },
            persistent: true,
        });

        watcher.on('all', (event, filePath) => {
            if (event === 'add' || event === 'addDir' || event === 'change') {
                // console.log(`文件监听: ${event}, 文件: ${filePath}`);
                this.addFiles(filePath, filePath.replace(this.watchDir, this.outputDir));
            }
            if (event === 'unlink' || event === 'unlinkDir') {
                const targetPath = filePath.replace(this.watchDir, this.outputDir);
                // console.log(`删除事件: ${event}, 文件: ${filePath}`);
                this.deleteFiles(targetPath);
            }
        });

    }

    // 添加文件
    addFiles(sourcePath, targetPath) {
        if (fs.existsSync(sourcePath)) {
            // 如果是目录，创建目录
            if (fs.lstatSync(sourcePath).isDirectory()) {
                fs.mkdirSync(targetPath, { recursive: true });
            } else {
                // 如果是文件，看看是否是需要转换的文件
                const ext = path.extname(sourcePath);
                if ((ext === '.js' || ext === '.ts') && this.conversionDir && path.normalize(sourcePath).includes(path.normalize(this.conversionDir))) {
                    // 读取源文件内容
                    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
                    const hasClassExport = /export\s+class\s+/g.test(sourceContent); // 是否有类导出
                    const functionMatches = sourceContent.match(/function\s+\w+\s*\(/g); // 是否有函数
                    // 如果有类导出，并且有函数，则进行转换
                    if (!hasClassExport && functionMatches) {
                        this.perfectFunction(sourcePath, sourceContent, targetPath);
                        return
                    }
                }
                // 如果不是需要转换的文件，直接复制
                copyFileSync(sourcePath, targetPath);
            }
            // console.log('已添加目标路径:', targetPath);
        }
    }

    deleteFiles(targetPath) {
        // console.log('已删除目标路径:', targetPath);
        if (fs.existsSync(targetPath)) {
            if (fs.lstatSync(targetPath).isDirectory()) {
                fs.rmdirSync(targetPath, { recursive: true });
            } else {
                fs.unlinkSync(targetPath);
            }
            console.log('已删除目标路径:', targetPath);
        }
    }

    perfectFunction(sourcePath, sourceContent, destPath) {
        // console.log('进行了强化---', sourcePath);
        const scenePublicTargets = this.readSceneFile(sourcePath);
        // console.log('scenePublicTargets', scenePublicTargets);

        const newInstanceNames = new Map();
        const validInstanceNames = new Set();

        let _this = this;
        const ext = path.extname(sourcePath);

        const plugin = {
            visitor: {
                FunctionDeclaration(path) {
                    if (!t.isExportNamedDeclaration(path.parent)) {
                        const exportDeclaration = t.exportNamedDeclaration(path.node, []);
                        path.replaceWith(exportDeclaration);
                    }
                    if (ext === '.ts') {
                        _this.addParameter(path.node, 'scene', 'Phaser.Scene');
                    } else {
                        _this.addParameter(path.node, 'scene');
                    }
                },
                MemberExpression(path) {
                    if (t.isThisExpression(path.node.object)) {
                        path.node.object = t.identifier('scene');
                    }
                },
                NewExpression(path) {
                    const args = path.node.arguments;
                    if (args.length > 0 && t.isThisExpression(args[0])) {
                        args[0] = t.identifier('scene');
                    }
                },
                VariableDeclarator(path) {
                    if (ext === '.js') {
                        return;
                    }
                    const { id, init } = path.node;
                    if (init && t.isNewExpression(init)) {
                        const instanceName = id.name;
                        const typeName = init.callee.name;
                        newInstanceNames.set(instanceName, typeName);
                    }
                },
                AssignmentExpression(path) {
                    if (ext === '.js') {
                        return;
                    }
                    const left = path.node.left;
                    const right = path.node.right;
                    // console.log('Checking AssignmentExpression:', path.toString());

                    if (t.isMemberExpression(left) && t.isIdentifier(right)) {
                        const leftPropertyName = left.property.name;
                        const rightName = right.name;

                        // 检查 this.xxx = xxx 或 scene.xxx = xxx
                        if (
                            (t.isThisExpression(left.object) ||
                                (t.isIdentifier(left.object) && left.object.name === 'scene')) &&
                            leftPropertyName === rightName &&
                            newInstanceNames.has(rightName)
                        ) {
                            // console.log(`Found potential match: ${path.toString()}`);
                            // console.log(`Adding valid instance: ${rightName}`);
                            validInstanceNames.add(rightName);
                        }
                    }
                },
                Program: {
                    exit(path) {
                        if (ext === '.js') {
                            return;
                        }
                        const typeProperties = [];
                        // console.log('newInstanceNames', newInstanceNames);
                        // console.log('validInstanceNames', validInstanceNames);
                        validInstanceNames.forEach((instanceName) => {
                            const typeName = newInstanceNames.get(instanceName);
                            if (typeName) {
                                typeProperties.push(
                                    t.tsPropertySignature(
                                        t.identifier(instanceName),
                                        t.tsTypeAnnotation(t.tsTypeReference(t.identifier(typeName)))
                                    )
                                );
                            }
                        });

                        scenePublicTargets.forEach((target) => {
                            typeProperties.push(
                                t.tsPropertySignature(
                                    t.identifier(target.label),
                                    t.tsTypeAnnotation(t.tsTypeReference(t.identifier(target.type)))
                                )
                            );
                        });

                        if (typeProperties.length > 0) {
                            const typeAlias = t.exportNamedDeclaration(
                                t.tsTypeAliasDeclaration(
                                    t.identifier('SceneExtensions'),
                                    null,
                                    t.tsTypeLiteral(typeProperties)
                                )
                            );

                            path.pushContainer('body', typeAlias);
                        }
                    }
                }
            }
        };

        const output = babel.transformSync(sourceContent, {
            plugins: [plugin],
            parserOpts: {
                sourceType: 'module',
                plugins: ['typescript']
            },
            generatorOpts: {
                decoratorsBeforeExport: true,
            }
        });

        const { code } = output;
        fs.writeFileSync(destPath, code, 'utf-8');

    }


    addParameter(node, paramName, paramType) {
        // Check if the parameter already exists
        const paramExists = node.params?.some(param => t.isIdentifier(param, { name: paramName }));
        if (!paramExists) {
            // Create a new parameter
            const param = t.identifier(paramName);

            // If the file is TypeScript, add a type annotation
            if (paramType) {
                param.typeAnnotation = t.tsTypeAnnotation(
                    t.tsUnionType([
                        t.tsTypeReference(t.identifier(paramType)),
                        t.tsAnyKeyword()
                    ])
                );
            }

            // Prepend the new parameter to the parameters list
            node.params = node.params || [];
            node.params.unshift(param);
        }
    }


    readSceneFile(sourcePath) {
        const sceneFilePath = sourcePath.replace(/\.(js|ts)$/, '.scene');
        if (!existsSync(sceneFilePath)) {
            return [];
        }
        const sceneContent = JSON.parse(fs.readFileSync(sceneFilePath, 'utf-8'));
        const displayList = sceneContent.displayList || [];
        const publicProperties = this.extractPublicProperties(displayList);
        return publicProperties;
    }

    extractPublicProperties(displayList) {
        const publicProperties = [];

        const traverseList = (list) => {
            list.forEach(item => {
                if (item.scope === 'PUBLIC' && item.type) {
                    let phaserType = this.phaserTypeFilter(item);
                    if (phaserType) {
                        publicProperties.push(phaserType);
                    }
                }
                if (item.list && item.list.length > 0) {
                    traverseList(item.list);
                }
            });
        }

        traverseList(displayList);
        return publicProperties;
    }


    phaserTypeFilter(item) {
        let phaserObjectsTypes = ["Image", "Sprite", "TileSprite", "NineSlice", "ThreeSlice", "Video", "Container", "Layer", "Text", "BitmapText", "Rectangle", "Ellipse", "Triangle", "Polygon", "RoundedRectangleGraphics", "RoundedRectangleImage"]
        if (phaserObjectsTypes.includes(item.type)) {
            return {
                label: item.label,
                type: `Phaser.GameObjects.${item.type}`
            }
        }
        switch (item.type) {
            case 'ArcadeImage':
                return {
                    label: item.label,
                    type: 'Phaser.Physics.Arcade.Image'
                };
            case 'ArcadeSprite':
                return {
                    label: item.label,
                    type: 'Phaser.Physics.Arcade.Sprite'
                };
            case 'Collider':
                return {
                    label: item.label,
                    type: 'Phaser.Physics.Arcade.Collider'
                };
            case 'b2Body':
                return {
                    label: item.label,
                    type: 'b2Body'
                }
            case 'b2OffsetPolygonShape':
                return {
                    label: item.label,
                    type: 'b2OffsetPolygonShape'
                }
            case 'b2BoxShape':
                return {
                    label: item.label,
                    type: 'b2BoxShape'
                }
            case 'b2PolygonShape':
                return {
                    label: item.label,
                    type: 'b2PolygonShape'
                }
            case 'ParticleEmitter':
                return {
                    label: item.label,
                    type: 'Phaser.GameObjects.Particles.ParticleEmitter'
                }
            case 'TilemapLayer':
                return {
                    label: item.label,
                    type: 'Phaser.Tilemaps.TilemapLayer'
                }
            case 'Tilemap':
                return {
                    label: item.label,
                    type: 'Phaser.Tilemaps.Tilemap'
                }
            case 'EditableTilemap':
                return {
                    label: item.label,
                    type: 'Phaser.Tilemaps.Tilemap'
                }
            case 'SpineGameObject':
                return {
                    label: item.label,
                    type: 'SpineGameObject'
                }
            default:
                return {
                    label: item.label,
                    type: 'any'
                };
        }
    }


    cleanNonJsonFiles(directory) {
        const items = fs.readdirSync(directory, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(directory, item.name);
            if (item.isDirectory()) {
                this.cleanNonJsonFiles(fullPath);
                const remainingItems = fs.readdirSync(fullPath);
                if (remainingItems.length === 0) {
                    fs.rmdirSync(fullPath);
                }
            } else if (path.extname(fullPath) !== '.json') {
                fs.unlinkSync(fullPath);
            }
        }
    }

    cleanPublicRootFiles(directory) {
        const publicRootPath = path.join(directory, 'publicroot');
        if (existsSync(publicRootPath)) {
            const lines = fs.readFileSync(publicRootPath, 'utf-8').split('\n').filter(line => line.trim());
            lines.forEach((line, index) => {
                lines[index] = line.replace(/\r/g, '');
            });
            lines.forEach(line => {
                const filePath = path.join(directory, line.trim() || '/');
                if (existsSync(filePath)) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
            });
            fs.rmSync(publicRootPath, { recursive: true, force: true });
        }
    }
}

module.exports = PhaserEditorHelper;
