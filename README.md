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

从 0.3.4 起，单条删除、批量删除和悬空记录清理均使用 DSH 官方页面内确认弹窗，由宿主管理焦点、Tab 和 Esc。取消不发送删除请求；确认后恢复页面焦点，避免 Windows 系统确认框关闭后消息复制失效、必须切换窗口才能恢复的问题。

## 删除边界

- 默认只删除已归档的会话，接口与 GUI 采用同一范围。
- 删除会话目录，通过 DSH 原生 Workspace Registry 移除工作区成员、归档与置顶登记，并发布原生会话列表移除事件。服务不可用的旧宿主才使用文件登记兼容路径。
- 真正在运行或结束中的任务会拒绝删除；停止后的会话对象仍驻留内存不再视为“正在运行”。
- 已停止会话可立即从列表移除。宿主仍持有会话对象或文件写锁时，删除意图会持久记录为待清理，在资源释放或宿主重启后自动删除文件并完成登记清理。
- Windows 通过独占文件共享探测真实句柄占用，旧 `session.lock` 文件存在不再直接判定为运行中；其他平台使用 `flock`。无法确认锁已释放时保留文件并等待清理，不强行解除锁。
- 兼容 `session[.<format>].jsonl.zstd` 日志名称，不通过旧 DSH 版本常量判断格式。
- 使用完整会话 ID 定位及同步，不合并不同 run/task 的记录；支持 DSH 的 `~XXXX` 目录编码。

删除成功后会更新原生会话列表，并按稳定行标识隐藏旧缓存行；刚归档的会话、未挂载的行及侧栏重新渲染不依赖此前捕获的按钮节点。批量删除失败的条目继续保留控件，可以重试。

待清理及已删除标记保存在 DSH home 的 `archive-delete/deletions/`，刷新页面不会恢复已移除的行。界面会明确显示待文件清理数量；已删除的会话 ID 不允许重新创建或继续驱动，其他会话不受影响。

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

## 设置页面

设置页与 Windows 电脑操作页使用一致的分区、开关、状态和主题样式，支持窄屏。归档管理保留侧栏选择和删除确认，并提供归档摘要与无效记录清理入口。
