const vscode = require("vscode");
const { MongoClient } = require("mongodb");
const path = require("path");

// 存储从数据库获取的资源
let resources = [];
// 用于创建装饰器的类型
let decorationType;
// 状态栏项
let statusBarItem;

// 从MongoDB数据库获取资源
async function fetchResources() {
  const uri = "mongodb://localhost:27017/mpadmin"; // MongoDB 连接 URI
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const database = client.db("mpadmin");
    const collection = database.collection("resources");
    resources = await collection.find().toArray();
  } catch (error) {
    console.error("Error fetching resources:", error);
    vscode.window.showErrorMessage("Failed to fetch resources. Please check your database connection.");
  } finally {
    await client.close();
  }
}

// 构建资源树结构
function buildResourceTree(resources) {
  const tree = {};
  resources.forEach((resource) => {
    tree[resource.id] = { ...resource, children: [] };
  });
  resources.forEach((resource) => {
    if (resource.pid && tree[resource.pid]) {
      tree[resource.pid].children.push(tree[resource.id]);
    }
  });
  return Object.values(tree).filter((resource) => !resource.pid);
}

// 获取资源的完整路径
function getResourcePath(resource, tree) {
  const path = [resource.name];
  let parent = tree.find((r) => r.id === resource.pid);
  while (parent) {
    path.unshift(parent.name);
    parent = tree.find((r) => r.id === parent.pid);
  }
  return path.join("-");
}

// 插件激活时调用的函数
function activate(context) {
  console.log("Congratulations, your extension is now active!");

  fetchResources();

  // 创建装饰器类型
  decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: "none;", // 允许原始文本显示
    after: {
      margin: "0", // 移除间距
      textDecoration: "none; opacity: 0.7;",
    },
  });

  // 创建状态栏项
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  statusBarItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
  context.subscriptions.push(statusBarItem);

  // 添加选择变更事件监听器
  vscode.window.onDidChangeTextEditorSelection(handleSelectionChange, null, context.subscriptions);

  // 注册刷新资源的命令
  let disposable = vscode.commands.registerCommand("extension.refreshResources", function () {
    fetchResources();
    vscode.window.showInformationMessage("GetRes resources refreshed");
  });

  context.subscriptions.push(disposable);

  // 注册悬停提供者
  const hoverProvider = vscode.languages.registerHoverProvider("javascript", {
    provideHover(document, position) {
      const lineText = document.lineAt(position).text;
      const match = lineText.match(/getRes\((\d+)\)/);
      if (match) {
        const resourceId = match[1];
        const resource = resources.find((r) => r.id.toString() === resourceId);
        if (resource) {
          const path = getResourcePath(resource, resources);
          const hoverContent = new vscode.MarkdownString();
          hoverContent.appendCodeblock(path, "typescript");
          hoverContent.appendText("\n");
          hoverContent.appendCodeblock(resource.code, "css");
          return new vscode.Hover(hoverContent);
        }
      }
    },
  });

  context.subscriptions.push(hoverProvider);

  // 监听文档变化事件
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
        handleSelectionChange({ textEditor: vscode.window.activeTextEditor });
      }
    },
    null,
    context.subscriptions
  );

  // 注册自动完成提供者
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    "javascript",
    {
      provideCompletionItems(document, position) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.endsWith("getRes(")) {
          return undefined;
        }

        return resources.map((resource) => {
          const item = new vscode.CompletionItem(`${resource.id}: ${getResourcePath(resource, resources)}`, vscode.CompletionItemKind.Value);
          item.detail = getResourcePath(resource, resources);
          item.insertText = resource.id.toString();
          item.sortText = resource.name.toLowerCase(); // 用于排序
          return item;
        });
      },
    },
    "(" // 触发字符
  );

  context.subscriptions.push(completionProvider);

  // 添加新的命令来刷新资源并更新自动完成
  let refreshCommand = vscode.commands.registerCommand("extension.refreshResourcesAndCompletion", async function () {
    await fetchResources();
    vscode.window.showInformationMessage("resources data refreshed.");
  });

  context.subscriptions.push(refreshCommand);
}

// 处理选择变更的函数
function handleSelectionChange(event) {
  const editor = event.textEditor;
  const document = editor.document;

  if (document.languageId !== "javascript") return;

  const decorations = [];

  // 遍历文档中的所有 getRes 调用
  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const lineText = line.text;
    const matches = lineText.matchAll(/getRes\((\d+)\)/g);

    for (const match of matches) {
      const resourceId = match[1];
      const resource = resources.find((r) => r.id.toString() === resourceId);
      if (resource) {
        const path = getResourcePath(resource, resources);
        const idStart = match.index + 7;
        const idEnd = idStart + resourceId.length;

        // 检查光标是否在 ID 上
        const isOnId = editor.selection.active.line === i && editor.selection.active.character >= idStart && editor.selection.active.character <= idEnd;

        // 只有当光标不在 ID 上时，才添加装饰器
        if (!isOnId) {
          decorations.push({
            range: new vscode.Range(i, idEnd, i, idEnd),
            renderOptions: {
              after: {
                contentText: path,
                color: "gray",
              },
            },
          });
        }

        // 如果光标在 ID 上，显示详细信息
        if (isOnId) {
          statusBarItem.text = `${resourceId}:${path}`;
          statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
          statusBarItem.color = new vscode.ThemeColor("statusBarItem.warningForeground");
          statusBarItem.show();
          // 不需要立即返回，因为我们需要处理所有行的装饰器
        }
      }
    }
  }
  // 应用所有装饰器
  editor.setDecorations(decorationType, decorations);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
