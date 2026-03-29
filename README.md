# Lunes Host 自动登录

基于 HAR 文件分析的自动登录脚本，用于 GitHub Action 每天零点自动登录保持会话。

## 功能特性

- 🤖 自动登录 Lunes Host
- ☁️ 支持 Cloudflare 保护 (cf_clearance)
- 📅 每天北京时间 00:00 自动执行
- 🔐 支持 GitHub Secrets 安全存储凭证
- 🐛 支持手动触发和调试模式

## 快速开始

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd lunes-login
```

### 2. 本地测试

```bash
# 复制配置模板
cp config.example.env .env

# 编辑 .env 填入你的登录信息
nano .env

# 运行测试
npm run login
```

### 3. 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets:

| Secret 名称 | 必填 | 说明 |
|-------------|------|------|
| `LOGIN_URL` | ✅ | 登录页面 URL |
| `LOGIN_USERNAME` | ✅ | 用户名 |
| `LOGIN_PASSWORD` | ✅ | 密码 |
| `LOGIN_API_URL` | ❌ | 登录 API 端点 |
| `KEEP_ALIVE_URL` | ❌ | 保持会话的 URL |
| `CF_CLEARANCE` | ❌ | Cloudflare clearance cookie |
| `SESSION_COOKIE` | ❌ | Session cookie |

### 4. 部署到 GitHub

```bash
git add .
git commit -m "Add daily login automation"
git push origin main
```

## 使用方法

### 自动执行

脚本会在每天 **北京时间 00:00** (UTC 16:00) 自动执行。

### 手动触发

1. 打开 GitHub 仓库的 Actions 页面
2. 选择 "Daily Login" workflow
3. 点击 "Run workflow" 按钮

### 调试模式

手动触发时可启用调试模式查看详细日志：

```yaml
debug: true
```

## 文件结构

```
lunes-login/
├── .github/
│   └── workflows/
│       └── daily-login.yml    # GitHub Action 工作流
├── login.js                  # 登录脚本
├── package.json              # Node.js 配置
├── config.example.env         # 配置模板
├── .gitignore                # Git 忽略文件
└── README.md                 # 说明文档
```

## 注意事项

1. **Cloudflare 挑战**: 如果网站有 Cloudflare 保护，可能需要手动获取 `cf_clearance` cookie
2. **登录 API**: 如果登录 API 与默认不同，请修改 `config.example.env` 中的 `LOGIN_API_URL`
3. **安全**: 请勿将包含密码的 `.env` 文件提交到 Git

## 获取 Cloudflare Cookie (如需要)

1. 使用浏览器访问登录页面
2. 完成 Cloudflare 验证 (如果显示)
3. 打开开发者工具 (F12) → Application → Cookies
4. 复制 `cf_clearance` 和 `session` 的值
5. 将值添加到 GitHub Secrets

## 许可证

MIT
