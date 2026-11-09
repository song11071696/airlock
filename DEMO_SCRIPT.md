# Airlock 演示视频录制脚本（≤ 3:00，纯屏幕 + 字幕，无配音、无露脸）

网址：https://song11071696.github.io/airlock/
设备：你的 MacBook Air，Chrome，Gemini Nano 已显示 “ready”。
字幕：下面每个镜头的 **Caption** 是英文字幕原文。录制时**不用**加字幕，录完把视频发我，我用 ffmpeg 把字幕、片头片尾卡和架构图合成进去，并剪掉等待时间。

---

## 0. 录前准备（约 5 分钟，只做一次）

1. Chrome 打开 `https://song11071696.github.io/airlock/`，**只留这一个标签页**。
2. 隐藏书签栏：`⌘ + Shift + B`。页面缩放 110%：`⌘ +` 一下（字更清楚）。
3. Chrome 窗口最大化（双击标题栏），不要全屏模式（全屏会挡住 Wi-Fi 图标，第 9 镜要用）。
4. 顶部状态栏应显示三个绿色/蓝色标签：
   `On-device: Gemini Nano ready` · `Network: online` · `Cloud: gemini-3.5-flash-lite`
   如果 Nano 不是 ready，先别录，告诉我。
5. Mac 开勿扰：控制中心 → 专注模式 → 勿扰（防止通知弹出）。
6. 先完整彩排一遍第 1–9 镜（不录），确认云端和离线都能出结果，然后**刷新页面**再正式录。
   - 注意：断网后**不要刷新页面**（没有离线缓存，刷新会打不开）。

## 1. QuickTime 录屏步骤

1. 打开 QuickTime Player → 菜单 **文件 → 新建屏幕录制**（或按 `⌘ + Shift + 5`）。
2. 底部工具栏选 **“录制所选部分”**，框选 Chrome 窗口（含顶部 macOS 菜单栏右侧的 Wi-Fi 图标更好，第 9 镜能看到断网）。
3. **选项** → 麦克风选 **“无”**；勾选 **“显示鼠标点按”**；计时器选“无”。
4. 点 **录制**。录完点菜单栏的 ■ 停止按钮（或 `⌘ + Control + Esc`）。
5. **文件 → 存储**，存成 `airlock-take1.mov`。
6. 可以分段录（例如第 1–8 镜一段，第 9 镜一段），每段单独存，文件名标好顺序。等待模型时间不用卡，我会剪掉。
7. 把 `.mov` 文件发我（太大的话用 AirDrop 到手机再发，或传网盘）。

---

## 2. 分镜（时间是剪辑后的成片时间）

### 镜头 1 — 片头卡（0:00–0:08，我后期加，你不用录）
**Caption:** You got a letter. It has a deadline. You can't paste it into a chatbot.

### 镜头 2 — 状态栏（0:08–0:18）
- 操作：鼠标慢慢划过顶部三个标签，停 2 秒。
- **Caption:** Airlock runs Gemini Nano in Chrome on this laptop, and Gemini in the cloud — via Firebase AI Logic hybrid inference.

### 镜头 3 — 放入信件（0:18–0:28）
- 操作：点第 1 步里的按钮 **“Eviction notice (fictional)”**。文本框出现驱逐通知。鼠标滑过收信人姓名、地址、账号停 1 秒。
- **Caption:** A fictional eviction notice. Name, address, account number, landlord's phone — all in plain text.

### 镜头 4 — 运行 Airlock（0:28–0:45）
- 操作：点 **“Run the airlock →”**。等第 2 步 “Airlock review” 出现。
- 鼠标指向左边 **“Stays on this device”** 的芯片（看到带 `Nano` 小标的芯片时停一下）。
- **Caption:** Step 1, on device: text rules + Gemini Nano find every personal detail. Nothing has left the laptop.

### 镜头 5 — 出站内容 + 角色令牌（0:45–1:05）
- 操作：鼠标移到右边 **“Leaves this device”** 框，依次停在 `[[RECIPIENT_PERSON_1]]`、`[[SENDER_PHONE_1]]` 上。再指向绿色的 **“✓ Leak check passed”** 和标题旁的字节数。
- **Caption:** This is exactly what goes to the cloud. Your details become tokens — and tokens know whose they are: the tenant's vs the landlord's.

### 镜头 6 — 点选保留/释放（1:05–1:15）
- 操作：在左边点一下 **ACCOUNT “88-1234-77”** 芯片 → 它变灰（释放），右边 `Tenant Account No:` 后面变回原号码；**再点一次**恢复保留（变回 `[[RECIPIENT_ACCOUNT_1]]`）。
- **Caption:** You decide. Click any detail to release or withhold it. A leak check blocks sending if anything slips through.

### 镜头 7 — 云端分析（1:15–1:45）
- 操作：点 **“Explain this letter →”**。等第 3 步出现，结果标题旁徽章为 **IN CLOUD**。
- 慢慢往下滚：摘要 → **Deadlines**（3 days）→ **Money**（$2,180.00）→ **What to do next**（应能看到房东电话 / 地址被填回，带高亮）。
- **Caption:** Step 2, in the cloud: gemini-3.5-flash-lite sees only the redacted text and explains it — deadline, amount, what to do next.
- 第二条字幕（停在 What to do next 时）：**Caption:** The landlord's phone and office are filled back in on your device — the cloud only ever saw [[SENDER_PHONE_1]].

### 镜头 8 — 回信草稿 + 证据（1:45–2:10）
- 操作：滚到 **“Draft reply”**，鼠标停在高亮的租客姓名上，再停在 `[your phone]` 上。
- 点开 **“Show what the model actually returned (tokens, …)”**，停 2 秒，可看到全是 `[[…]]` 令牌。
- 滚到页面底部 **“Where each step ran”**：ON DEVICE / LOCAL RULES / IN CLOUD 徽章，停 3 秒。
- **Caption:** Your name is filled in locally. The landlord's number is never passed off as yours.
- **Caption:** Proof: what the model returned — tokens only. Every step shows where it ran.

### 镜头 9 — 离线：Wi-Fi 关掉，Nano 接管（2:10–2:40）
（代码已核实支持：断网时 `navigator.onLine=false` → 分析改走 Gemini Nano（`ONLY_ON_DEVICE`），追问也走 Nano；状态栏会显示 `Network: offline`、`Cloud: unreachable (offline)`。）
- 操作：
  1. 点屏幕右上角 Wi-Fi 图标 → **关闭 Wi-Fi**。等 2–5 秒，页面状态栏变成 `Network: offline`（黄色）。
  2. 滚回第 1 步，点 **“Debt collection letter (fictional)”** → 点 **“Run the airlock →”**。
  3. 第 2 步底部提示应写 “Offline or no cloud: next step runs ON DEVICE”。点 **“Explain this letter →”**。
  4. 等结果（Nano 可能要 20–60 秒，照常录，我会剪），徽章为 **ON DEVICE**。
  5. 在第 4 步输入框输入：`Do I have to pay right now?` → 点 **Ask**，答案旁徽章 **ON DEVICE**。
- **Caption:** No signal? Wi-Fi off. Airlock keeps working — Gemini Nano does the analysis on the laptop.
- **Caption:** Offline, nothing can leave the device at all.
- 录完这一镜**再打开 Wi-Fi**。
- 如果彩排时离线分析失败或超过 2 分钟：跳过这一镜告诉我，我改用架构图多停几秒，总时长照样够。

### 镜头 10 — 架构图（2:40–2:52，我后期加）
**Caption:** ONLY_ON_DEVICE for raw text & photos · PREFER_IN_CLOUD for the redacted analysis · PREFER_ON_DEVICE for follow-ups.

### 镜头 11 — 片尾卡（2:52–3:00，我后期加）
**Caption:** Airlock — understand official letters without giving away who you are. song11071696.github.io/airlock · Built with Firebase AI Logic hybrid inference. All letters are fictional.

---

## 3. 注意

- 画面里只出现示例信（全部虚构），不要粘贴任何真实信件或个人信息。
- 不要打开 DevTools Console（里面可能有调试信息）；证据用第 8 镜的 “Show what the model actually returned” 面板。
- 云端那一步如果显示 `Cloud: refused`，停止录制告诉我（说明 Firebase App Check 设置被改回了强制模式）。
