# LogViewer 规则包撰写说明（给外部 AI）

只输出一份符合 `schema/rulepack-v1.schema.json` 的 JSON，不要 Markdown 围栏，不要解释。

生成后调用 MCP 工具 `encrypt_rulepack`，把 JSON 加密成 `.lvrule` 文件。用户在 LogViewer「解析 → 导入规则」用同一口令导入。不要让用户粘贴明文 JSON。

## 帧约定

默认 `frame.kind` = `length_prefix`（咖啡机等定长帧）：

- 发送头：`AA 55`（字节 `[170,85]`）
- 接收头：`A5 5A`（字节 `[165,90]`）
- 长度字节：其后命令 + 载荷 + 校验的字节数
- 校验：末字节之前所有字节的低 8 位和（`sum8_before_last`）
- 同一命令字可用 `dir`、`len`（整帧字节数）、`payload_prefix`（命令后载荷前缀）区分多条定义；匹配取最具体的一条。无 `role` 的条目参与定长帧匹配。

`frame.kind` = `mdb_adapter`（MDB-RS232 支付串口）时用另一套帧规则：

- 无帧头、无长度字节；`tx_header` / `rx_header` 可空
- 发送：首字节为命令，可选次字节子命令；默认无校验
- 接收单字节 `00` / `FF` / `AA` → ACK / NAK / RET（`role: control`）
- 接收首字节属于 `frame.device_bases` → 主动上报（`role: report`，无校验）
- 其余接收 → 绑定本文件最近一条发送命令的应答（`role: reply`），或无 `role: event` 匹配无设备前缀的 POLL 事件；校验多为 `sum8_tail`（末字节为前面数据低 8 位和，不含总线地址）

`frame.kind` = `mixed`：同一行规则同时覆盖 AA55 定长帧与 MDB 裸帧。发送/接收头与 `length_prefix` 相同；帧头匹配走定长帧，否则走 MDB。定长帧命令不要写 `role`；MDB 命令必须写 `role`。

MDB 命令可选字段：`dir`、`sub`、`role`（`command`|`report`|`reply`|`control`|`event`）、`checksum`（`none`|`sum8_tail`）、`len`（整帧精确长度）。匹配优先「方向 + 命令 + 子命令 + 长度」。

## 行规则

用正则从整行取出方向与十六进制。需覆盖：

1. `Device:/dev/ttyS7 > HEX` / `< HEX`
2. `Coffee-Machine:...---发送：HEX` / `---接收：HEX`
3. MDB：`Payment:/dev/ttyS9 > HEX` / `< HEX`

`dir_map` 只能映射到 `tx` 或 `rx`。Heart / RunInfo / 连接成功等非帧行不要匹配。

## 解码步骤类型

- `uint`：`offset` / `width` / `endian`（`be`|`le`）
- `bits`：从已解析整数取位段，再用 `map` 成枚举
- `flags`：位序号、文案、是否故障、可选故障码；可选 `id` 供 view 绑定
- `groups`：定宽位组，值等于某数时记故障；可选 `id` 供 view 绑定
- `hex_dump`：整段载荷十六进制
- `ascii`：`offset` / `width`，读 ASCII（去空格/NUL）

## 卡片视图 `view`（可选）

省略 `view` 时，解析卡片默认两行：指令作用（命令标题）+ 说明句。说明句把每个字段写成 `十六进制：说明；` 接在同一句里。

需要自定义布局时，在命令上写最多 32 个控件：

- `heading`：可选 `text`，否则用命令标题
- `kv`：`bind` 指向 `uint` / `bits` 的 `id`
- `status`：`bind` 指向状态位段 `id`
- `flags`：`bind` 指向 `flags`/`groups` 的 `id`，或 `flags.from` / `groups.code`
- `hex`：`bind` 指向 `hex_dump` 的 `id`，或 `from_bytes: [offset, width]`

写了 `view` 时只按声明渲染，不再追加默认说明句。

## 最小示例

参考规则包结构写出完整 JSON 后，用 `encrypt_rulepack` 加密。导入导出加密文件扩展名为 `.lvrule`。用户也可在应用内「解密规则」改完后再「加密规则」导入。
