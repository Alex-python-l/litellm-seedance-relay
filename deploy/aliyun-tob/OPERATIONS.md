# 企业中转站运维说明

## 日常管理入口

- LiteLLM 管理后台：`<PUBLIC_API_BASE>/ui/admin/relay`
- 企业门户：`<PUBLIC_API_BASE>/ui/portal`
- 企业登录：`<PUBLIC_API_BASE>/ui/relay-login`
- 公共接口状态：`GET <PUBLIC_API_BASE>/v1/public/status`

管理员可以在“运营管理”页面完成以下操作：

- 创建企业账户并生成一次性激活链接
- 重新生成激活链接或密码重置链接
- 为企业充值或扣减额度
- 冻结和重新启用企业账户
- 发布模型价格版本
- 查看 Seedance 上游配置与测试连接
- 查看企业视频任务、实际 Token、收费与状态

企业管理员可以在门户中创建和删除自己的 API Key，查看额度、账目、用量、大模型请求和视频任务。完整 API Key 只在创建时显示一次。

## Seedance 接口

创建任务：

```text
POST /api/v1/open/contents/generations/tasks
Authorization: Bearer <ENTERPRISE_RELAY_KEY>
Idempotency-Key: <UNIQUE_REQUEST_ID>
```

查询任务：

```text
GET /api/v1/open/contents/generations/tasks/<TASK_ID>
Authorization: Bearer <ENTERPRISE_RELAY_KEY>
```

客户 Key 只能查询本企业创建的任务。创建接口会先预占余额；成功后按照上游返回的实际生成 Token 结算，失败会释放预占。后台每分钟自动轮询未完成任务。

## 服务器环境变量

Seedance 凭证只保存在 `/opt/litellm-relay/.env`：

```text
SEEDANCE_API_BASE_URL=https://api.aitaotech.com/api/v1
SEEDANCE_API_KEY=<PROVIDER_KEY>
SEEDANCE_MODEL=doubao-seedance-2-0-260128
SEEDANCE_UPSTREAM_MICROS_PER_MILLION=<UPSTREAM_COST_RATE>
```

`SEEDANCE_UPSTREAM_MICROS_PER_MILLION` 用于后台毛利统计，单位是每百万生成 Token 的微美元成本。客户售价在管理后台发布，不写入环境变量。

## 数据库和备份

PostgreSQL 数据保存在 Docker 命名卷 `litellm-relay_postgres_data`，不依赖容器生命周期。主要业务表包括：

- `LiteLLM_PublicRelayAccount`：企业账户
- `LiteLLM_PublicRelayWallet`：可用额度和预占额度
- `LiteLLM_VerificationToken`：企业 API Key 的哈希和权限
- `LiteLLM_PublicRelayModelPrice`：不可变价格版本
- `LiteLLM_PublicRelayReservation`：请求预占
- `LiteLLM_PublicRelayRequestCharge`：实际结算
- `LiteLLM_PublicRelayLedgerEntry`：额度流水
- `LiteLLM_PublicRelayVideoTask`：Seedance 任务及上游状态

每日备份由 `/opt/litellm-relay/backup.sh` 执行，保存在 `/opt/litellm-relay/backups`。恢复演练使用：

```text
/opt/litellm-relay/restore-check.sh <DUMP_FILE>
```

数据库不应直接用于日常充值、冻结或创建 Key；这些操作必须通过管理后台完成，以保留幂等性、账本和权限同步。
