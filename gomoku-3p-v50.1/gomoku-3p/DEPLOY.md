# 🚀 Railway部署指南

## 步骤1：推送代码到GitHub

```bash
cd /root/clawd/gomoku-3p

# 添加GitHub仓库（如果还没添加）
git remote add origin https://github.com/Clawdbot/gomoku-3p.git

# 推送到GitHub
git push origin master
```

## 步骤2：部署到Railway

1. 打开 https://railway.app
2. 点击 **"Login with GitHub"** 登录
3. 点击 **"New Project"**
4. 选择 **"Deploy from GitHub repo"**
5. 搜索并选择 `gomoku-3p` 仓库
6. Railway会自动检测配置：
   - Build Command: `npm install`
   - Start Command: `node server/index.js`
7. 点击 **"Deploy"**

## 步骤3：获取公网URL

部署完成后：
1. 点击项目进入详情页
2. 在 **Settings** → **Domains** 中查看公网URL
3. 格式如：`https://gomoku-3p-production.up.railway.app`

## 🎮 开始游戏

1. 把公网URL发给朋友
2. 打开浏览器访问
3. 输入名字 → 创建房间 → 分享房间号
4. 开始三人对战！

## 费用说明

- Railway免费套餐：500小时/月，足够个人和朋友使用
- 超出后按小时计费（很便宜）
