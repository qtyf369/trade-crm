# 项目技术规范

## 技术栈

- 前端: React 19 + TypeScript
- 样式: Tailwind CSS v4
- UI 组件: shadcn/ui `import { Button } from "@/components/ui/button";`
- 图标: lucide-react `import { SearchIcon } from "lucide-react";`
- 图表: echarts-for-react `import ReactECharts from "echarts-for-react";`
- 动画: framer-motion `import { motion } from "framer-motion";`
- 路由: react-router-dom `import { Link, useNavigate } from "react-router-dom";`

---

## 目录结构

```
src/
├── index.tsx            # 入口（勿修改）
├── app.tsx              # 路由配置（仅在 <Routes> 内增删 <Route>）
├── index.css            # 全局样式 + 主题变量
├── components/          # 基础 UI 组件（禁止存放业务组件）
│   ├── layout.tsx       # 全局布局容器（含 <Outlet />）
│   └── ui/              # shadcn/ui 内置组件（勿修改）
├── pages/               # 页面模块（每个页面一个目录）
│   ├── <PageName>/      # 页面目录示例
│   │   ├── PageName.tsx        # 页面入口文件与目录同名
│   │   └── components/         # 页面专属组件
│   └── NotFoundPage/
│       └── NotFoundPage.tsx
├── hooks/               # 自定义 Hooks
└── lib/                 # 工具函数（cn() 等）

public/                  # 静态资源（dev server 原样服务；构建后随 dist/output 同源部署）
```

---

## 模板初始状态

- `app.tsx` 首页路由指向 `pages/HomePage`（占位欢迎页）
- 开发时将 `HomePage` 替换为业务首页，或在 `pages/` 下创建新页面并调整 `index` 路由
- `layout.tsx` 为空壳容器（仅 `<Outlet />`），需根据需求实现导航和布局

---

## 禁止修改的文件

| 文件 | 原因 |
|------|------|
| `src/index.tsx` | Provider 层级 + 样式引入，由模板管理 |
| `src/components/ui/*` | shadcn/ui 内置组件，版本锁定 |

---

## 文件放置规则

| 内容类型 | 放置位置 |
|---------|---------|
| 新页面 | `src/pages/<PageName>/PageName.tsx` |
| 页面专属组件 | `src/pages/<PageName>/components/` |
| 自定义 Hooks | `src/hooks/` |
| 工具函数 | `src/lib/` |
| 静态数据文件 | `public/data/` |
| 静态图片 | `public/images/` |

---

## 导入路径

```typescript
// @/ 别名 → src/
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// public/ 下的静态资源通过 URL 引用（dev 与线上同源）
// <img src="/images/hero.png" />  fetch("/data/config.json")
```

---

## 路由配置

- 新增页面需在 `src/app.tsx` 的 `<Routes>` 内注册 `<Route>`
- `BrowserRouter` 已在 `index.tsx` 中配置，`app.tsx` 中**禁止**再包裹 Router

---

## 主题变量

主题色定义在 `src/index.css`，通过 `:root` CSS 变量 + `@theme inline` 注册到 Tailwind。

| 用途 | Tailwind 类 | CSS 变量 |
|------|------------|----------|
| 页面背景 | `bg-background` | `--background` |
| 主文本 | `text-foreground` | `--foreground` |
| 卡片背景 | `bg-card` | `--card` |
| 次要文本 | `text-muted-foreground` | `--muted-foreground` |
| 主色 | `bg-primary` / `text-primary` | `--primary` |
| 强调色 | `bg-accent` | `--accent` |
| 边框 | `border-border` | `--border` |
| 危险色 | `text-destructive` | `--destructive` |
| 图表色 | `bg-chart-1` ~ `bg-chart-5` | `--chart-1` ~ `--chart-5` |

HSL 格式使用**空格分隔**：`--primary: hsl(150 60% 40%);`

---

# Trade CRM 使用说明

## 第一次运行（别人拿到项目）

### 1. 后端环境（需要 Python 3.10+）
```bash
pip install -r requirements.txt
```

### 2. 前端构建（需要 Node.js 18+）
```bash
npm install
npm run build
```

### 3. 启动
直接双击 `启动CRM.bat`（缺少依赖时会自动安装），或者命令行运行：
```bash
python main.py
```

然后浏览器打开 http://localhost:8000

## 日常使用
- 直接双击 `启动CRM.bat` 就行
- 关闭黑窗口就是停止服务
- 数据备份：`backups/` 目录每天自动保留一份（保留 7 天），
  下载/融合云端数据前也会生成带时间戳的 `.bak_*` 备份

---

# v0.2 优化说明（2026-10-21）

本次优化保持所有原有功能和数据不变，重点修 bug 与提升可维护性。

## 架构调整

| 项 | 优化前 | 优化后 |
|---|---|---|
| 常量/字典 | 国家字典在 `main.py` 里重复 4 份（200+ 行） | 收敛到 `constants.py`，前后端各一份同源定义 |
| 列表查询 | 一次性返回全量，前端做搜索/筛选/排序/分页 | 全部下推到 SQL，分页返回 `{items, total, page, page_size}` |
| 批量操作 | 前端 for 循环逐个发请求（N 次往返，界面卡死） | 单接口 `POST /api/customers/batch` |
| 前端结构 | `CustomersPage.tsx` 单文件 1389 行 | 拆成 6 个组件，主文件 519 行 |
| 日期格式 | 库里混有 ISO 格式（`2026-10-20T10:44:58.193012`），`new Date()` 在 Safari 下解析失败 | 统一为 `YYYY-MM-DD HH:MM:SS`，启动时自动迁移 |
| 数据校验 | 新建客户不算 `data_issues`，逻辑散落 3 处 | 统一入口 `validate_customer()`，新建/更新/导入共用 |
| 依赖清单 | 缺 `openpyxl`/`requests`/`python-multipart`，导入导出和同步功能实际跑不通 | 已补齐 |

## 修复的实际 bug

1. **删除客户报外键错误**：`PRAGMA foreign_keys=ON` 下先删 customers 再删 followups 会失败，
   已调整删除顺序（批量删除同样处理）。
2. **`GROUP BY` + `LIMIT` 只返回一行**：SQLite 在该组合下 LIMIT 先于分组生效，
   已改为子查询先聚合、外层排序分页。
3. **`/api/export?ids=` 500**：`sqlite3.Row` 没有 `.get()` 方法，已统一转为 dict。
4. **详情页保存丢数据**：原实现浅拷贝整个 customer 再提交，后端全字段覆盖写入，
   任一路径不同步都会清空字段。已改为按字段组分别提交（基本信息 / 联系人分离）。
5. **导出 N+1 查询**：每个客户单独查一次最近跟进，已改为一次预取。

## 新增能力

- 跟进记录支持**编辑**（原来只能新增和删除）
- 列表搜索范围扩展到产品和备注
- 暗色模式配色补齐（原来的 `bg-gray-100` 等在暗色下不可读）
- 同步操作加进程内锁；下载/融合前生成带时间戳的备份，不再覆盖同一个 `.bak`

## 数据安全

- `config.json`（含坚果云应用密码）已加入 `.gitignore`，不会进版本库
- `save_config()` 会尝试将配置文件权限收紧为仅所有者可读写

## API 变更（前端已同步适配）

| 接口 | 变化 |
|---|---|
| `GET /api/customers` | 改为分页响应，新增 `search/country/level/status/source/starred/issues/sort_by/sort_asc/page/page_size` 参数 |
| `GET /api/customers/all` | 新增，保留旧的全量数组行为 |
| `POST /api/customers/batch` | 新增，`{ids, action: delete/star/unstar}` |
| `PUT /api/followups/{id}` | 新增，编辑跟进记录 |
| `GET /api/followups` | 改为分页响应，新增 `customer_id` 过滤 |

## 测试

后端 API 65 项断言全部通过（分页/筛选/排序/搜索/批量/CRUD/导入导出/数据校验/外键删除），
前端 `tsc` 零错误，`vite build` 成功，无头浏览器实际渲染四个页面验证通过。

运行测试（需先启动服务）：
```bash
tests\run-all.bat      # Windows
# 或逐个：node tests\api.test.mjs
```

## 数据安全说明

以下文件含敏感信息或用户数据，已在 `.gitignore` 中排除，**不会**提交到仓库：

| 文件 | 内容 |
|---|---|
| `config.json` | 坚果云 WebDAV 账号与应用密码（明文） |
| `trade_crm.db` | 全部客户数据 |
| `*.db.bak` / `*.merge_bak` / `backups/` | 数据库备份 |
| `crm_export.xlsx` | 导出的客户数据 |

换新机器时：复制 `config.json` 过去，或在 CRM 设置里重新绑定坚果云。


## 功能列表
- 客户管理（增删改查、多联系人、多邮箱、社交账号）
- 跟进记录时间线（可编辑、删除、折叠）
- 客户等级：L0/L1/L2/L3/L4、低质、优质
- 客户状态：新线索、初步沟通、已报价未成交、谈判中、已成交、已流失
- 客户来源：阿里巴巴国际站、展会、Google、其他
- 星标客户、筛选、排序、分页
- Excel导入导出（含脏数据标红提醒）
- 批量操作：导出、删除、加星标、取消星标

