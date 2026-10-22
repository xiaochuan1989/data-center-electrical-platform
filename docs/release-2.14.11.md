# v2.14.11 DeepSeek 预设模型、DeepSeek 连接失败提示

2026-10-22。

## 背景

线上"测试连接" DeepSeek 官方接口间歇报 Failed to fetch，用户感觉"每次上线就出问题"。排查结论：与发布无关（v2.14.8 之后 AI 连接代码未改；线上页面在测试浏览器中可正常请求 api.deepseek.com）。api.deepseek.com 的 CDN 节点中 14.29.51.120 连接超时，公共 DNS（8.8.8.8、223.5.5.5）会返回该节点；用户电脑开着系统代理（127.0.0.1:6594），浏览器请求由代理软件自行解析域名，因而间歇落到坏节点；系统 DNS（114.114.114.114）返回的节点正常。用户把 `api.deepseek.com` 加入系统代理例外并重启浏览器后连接恢复。同时发现原提示对 DeepSeek 官方也引导"运行中转转发"，属误导；设置预设模型仍为已失效的 `deepseek-chat`。

## 修改

- 设置中选择 DeepSeek 时预设模型改为 `deepseek-flash`（`index.html` 的 `PROVIDER_MODELS`）。规范书整理的思考策略原本即按 `deepseek-flash`/`deepseek-v4-pro` 配置。
- Base URL 为 `api.deepseek.com` 时，"测试连接"（`index.html`）与 AI 整理（`specConnectionHint`）的网络失败提示改为：接口本身支持网页调用，多为网络/代理/DNS 问题，开着代理软件时把 `api.deepseek.com` 加入系统代理例外或设为直连并完全重启浏览器。中转站与本机转发提示不变。

## 验证

`npm test`（`test_ai_local_proxy.mjs`：DeepSeek 提示指向代理例外且不引导开中转转发）、`python dev_scripts/test.py --quick`、`npm run test:build` 通过；内联脚本语法检查通过。用户加代理例外后线上"测试连接"成功。
