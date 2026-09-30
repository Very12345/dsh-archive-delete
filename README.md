# dsh-archive-delete

独立 DSH 插件，包名 `@very12345/dsh-archive-delete`。在 DSH 侧栏为已归档会话提供删除控件，并同步移除会话目录和归档登记。可以单独使用，不依赖网页模型后端或飞书桥接。

## 安装与使用

```sh
dsh plugin --profile desktop add github:Very12345/dsh-archive-delete
# CLI WebUI 可选择 --profile web
```

当前使用 GitHub 源码安装；也可在本仓库执行 `npm pack`，再用 `dsh plugin --profile <name> add file:/absolute/path/package.tgz` 安装本地包。npm 公共仓库暂无可直接安装的 scoped 包。

加载新版本后重启对应 DSH 宿主/profile。在已归档会话行中选择删除；普通会话不显示删除控件。需要 DSH 的 Web GUI 接口及 Node.js >= 20，当前工作区兼容目标为 DSH 0.2 系列。

从 0.2.5 起，侧栏删除控件直接订阅 DSH Workspace 的归档状态。新归档确认后自动显示控件，无需刷新页面或切换窗口；取消归档时自动隐藏控件并移出批量选择。后台列表只补充磁盘及悬空条目统计，迟到的旧响应不会覆盖新归档状态。

## 删除边界

- 默认只删除已归档的会话，接口与 GUI 采用同一范围。
- 删除会话目录，并更新 `storages/workspace.json` 中的 `global.archivedSessionIds`。
- 会话存在锁时，使用 `flock` 探测是否仍被占用；无法确认锁已释放时拒绝删除。
- Windows 没有 `flock` 时，对仍存在锁文件的会话保守拒绝；没有锁文件的已归档会话仍可删除。
- 兼容 `session[.<format>].jsonl.zstd` 日志名称，不通过旧 DSH 版本常量判断格式。

宿主路由为 `/plugins/dsh-archive-delete/list` 和 `/plugins/dsh-archive-delete/delete`，以 exact route 注册。会话目录按照 `DSH_HOME`、`WEBAGENT_HOME/deepseek-harness`、`~/.dsh` 的顺序解析，已有部署仍可沿用显式目录。

## 源码与验证

| 文件 | 职责 |
| --- | --- |
| `index.js` | 归档列表、删除接口及会话存储处理 |
| `client.js` | DSH 侧栏控件与批量选择 |
| `cordis.patch.yml` | 官方 bundle 插件配置 |
| `test/`、`selftest-entry.cjs` | 隔离临时目录的宿主测试及客户端入口检查 |

```sh
npm test
npm pack --dry-run
npm pack
```

测试不读取真实 DSH 会话。私人部署脚本保留在本地 `scripts/`，不进入插件包。发布入口和客户端注册名使用完整包名，避免裸名在 profile 中解析失败。

## 许可证

MIT，见 [LICENSE](./LICENSE)，关系及商标说明见 [NOTICE](./NOTICE)。
