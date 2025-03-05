const fs = require('node:fs');
const path = require('node:path');
const chokidar = require('chokidar');
const { copyFileSync, mkdirSync, existsSync } = fs;

class PhaserEditorHelper {
    constructor(options) {
        this.watchDir = options.watchDir;
        this.outputDir = options.outputDir;
        this.excludePatterns = options.excludePatterns || [];
        this.conversionDir = options.conversionDir;
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
        const watcher = chokidar.watch(this.watchDir, {
            ignored: this.excludePatterns,
            persistent: true,
        });

        let timeout;
        watcher.on('all', (event, filePath) => {
            if (event === 'add' || event === 'change') {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this.copyDirectory(this.watchDir, this.outputDir);
                }, 1000);
            }
        });
    }

    copyDirectory(source, destination) {
        if (!existsSync(destination)) {
            mkdirSync(destination, { recursive: true });
        }

        fs.readdirSync(source).forEach((item) => {
            const sourcePath = path.join(source, item);
            const destPath = path.join(destination, item);

            if (this.excludePatterns.some((pattern) => sourcePath.includes(pattern))) {
                return;
            }

            const stat = fs.statSync(sourcePath);
            if (stat.isDirectory()) {
                this.copyDirectory(sourcePath, destPath);
            } else {
                const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
                let destContent = existsSync(destPath) ? fs.readFileSync(destPath, 'utf-8') : '';

                const ext = path.extname(sourcePath);
                if ((ext === '.js' || ext === '.ts') && this.conversionDir && path.normalize(sourcePath).includes(path.normalize(this.conversionDir))) {
                    const hasClassExport = /export\s+class\s+/g.test(sourceContent);
                    if (!hasClassExport) {
                        const functionMatches = sourceContent.match(/function\s+\w+\s*\(/g);
                        if (functionMatches) {
                            let newContent = sourceContent;
                            functionMatches.forEach(fn => {
                                const fnName = fn.split(' ')[1].split('(')[0];
                                const exportStatement = `export { ${fnName} };`;
                                newContent += `\n${exportStatement}`;
                            });
                            if (ext === '.ts') {
                                newContent = newContent.replace(/function\s+(\w+)\s*\(/g, 'function $1(scene: Phaser.Scene | any, ');
                                newContent = newContent.replace(/this\./g, 'scene.');
                                newContent = newContent.replace(/new\s+(\w+)\(this,/g, 'new $1(scene,');

                                const sceneProperties = newContent.match(/scene\.\w+/g);
                                const propertiesFromNew = this.extractPropertiesFromNew(newContent);
                                const typeDefinition = this.generateTypeDefinition(sourcePath, propertiesFromNew, newContent);
                                newContent += `\n${typeDefinition}`;
                            } else {
                                newContent = newContent.replace(/function\s+(\w+)\s*\(/g, 'function $1(scene, ');
                                newContent = newContent.replace(/this\./g, 'scene.');
                                newContent = newContent.replace(/new\s+(\w+)\(this,/g, 'new $1(scene,');
                            }
                            if (newContent !== destContent) {
                                fs.writeFileSync(destPath, newContent, 'utf-8');
                            }
                        } else {
                            if (sourceContent !== destContent) {
                                copyFileSync(sourcePath, destPath);
                            }
                        }
                    } else {
                        if (sourceContent !== destContent) {
                            copyFileSync(sourcePath, destPath);
                        }
                    }
                } else {
                    if (sourceContent !== destContent) {
                        copyFileSync(sourcePath, destPath);
                    }
                }
            }
        });
    }

    extractPropertiesFromNew(content) {
        const properties = [];
        const newMatches = content.match(/const\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/g);
        if (newMatches) {
            newMatches.forEach(match => {
                const [_, instanceName, className] = match.match(/const\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/);
                const sceneAssignment = new RegExp(`scene\\.${instanceName}\\s*=\\s*${instanceName}`);
                if (sceneAssignment.test(content)) {
                    properties.push({ instanceName, className });
                }
            });
        }
        return properties;
    }

    typeSupplement(phaserObjectTypeDefinition, content) {
        const regex = /(\w+)\s*:\s*([^;]+);/g;
        const propertyMap = {};
        let match;
        // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
        while ((match = regex.exec(phaserObjectTypeDefinition)) !== null) {
            const [, name, typeDef] = match;
            propertyMap[name] = typeDef.trim();
        }

        const commentRegex = /\/\/\s*(\w+)\s*\(components\)/g;
        const commentMatches = [...content.matchAll(commentRegex)];

        commentMatches.forEach(cMatch => {
            const varName = cMatch[1];
            const lineRegex = new RegExp(`new\\s+(\\w+)\\(${varName}\\)`, 'g');
            const lineMatches = [...content.matchAll(lineRegex)];
            lineMatches.forEach(lineMatch => {
                const className = lineMatch[1];
                if (propertyMap[varName]) {
                    propertyMap[varName] = `${propertyMap[varName]} & { __${className}: ${className} }`;
                }
            });
        });

        let result = '';
        for (const [name, typeDef] of Object.entries(propertyMap)) {
            result += `${name}: ${typeDef}; `;
        }
        return result.trim();
    }

    generateTypeDefinition(sourcePath, propertiesFromNew, content) {
        const sceneFilePath = sourcePath.replace(/\.(js|ts)$/, '.scene');
        if (!existsSync(sceneFilePath)) {
            return '';
        }

        const sceneContent = JSON.parse(fs.readFileSync(sceneFilePath, 'utf-8'));
        const displayList = sceneContent.displayList || [];
        const publicProperties = this.extractPublicProperties(displayList);

        const phaserObjectTypeDefinition = publicProperties.map(prop => `${prop.label}: ${prop.type};`).join(' ');
        const newPropertiesDefinition = propertiesFromNew.map(prop => `${prop.instanceName}: ${prop.className};`).join(' ');

        const typeDefinition = this.typeSupplement(phaserObjectTypeDefinition, content);
        const prefabDefinition = this.typeSupplement(newPropertiesDefinition, content);

        return `type SceneExtensions = { ${typeDefinition} ${prefabDefinition} }; export type { SceneExtensions };`;
    }

    extractPublicProperties(displayList) {
        const publicProperties = [];

        function traverseList(list) {
            list.forEach(item => {
                if (item.scope === 'PUBLIC' && item.type) {
                    publicProperties.push({
                        label: item.label,
                        type: `Phaser.GameObjects.${item.type}`
                    });
                }
                if (item.list && item.list.length > 0) {
                    traverseList(item.list);
                }
            });
        }

        traverseList(displayList);
        return publicProperties;
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
