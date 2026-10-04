# 昆虫标本采集记录台（gbinsectlog）

面向野外昆虫调查队与标本馆技术员，把「标本采集 → 采集地与生境 → 鉴定状态 → 保藏位置」串成一条可追溯的编目链路，解决采集标签手写易错、鉴定进度无人跟踪、标本入柜后找不到位置的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21815>

常用命令：

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbinsectlog
FRONTEND_PORT=21815
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落，支持直接刷新子路由） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21815
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1115/
├── docker-compose.yml          # 顶层 name: gbinsectlog，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── tailwind.config.js / postcss.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # specimen.ts / site.ts / storage.ts / determination.ts / index.ts
│       ├── stores/             # specimenStore / siteStore / storageStore / determinationStore（Zustand）
│       ├── components/common/  # SpecimenCard / StatusTag / CabinetGrid / SitePicker
│       ├── hooks/              # usePersistentStore / useSpecimenFilter
│       ├── pages/              # SpecimensPage / SitesPage / CollectPage / DeterminationPage / StoragePage
│       ├── router/index.tsx
│       └── utils/              # codec.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Specimen 标本 | 编号、目/科/属/种、暂定名、采集日期与人、性别虫态、体长、采集方式、**个体总数**、鉴定状态 | `specimens` |
| CollectSite 采集地 | 代码、名称、行政区、经纬度海拔、生境类型、小生境、微气候、采集日期区间 | `sites` |
| Storage 插位分装 | 保藏方式、柜/抽屉/盒/插位序号、**本插位只数 count**、入柜日期、经手人；一份标本可对应多条 | `storages` |
| Determination 鉴定记录 | 鉴定人、日期、结论（学名）、依据文献、置信度、是否需复核 | `determinations` |
| Loan 借出归还 | 借用人/单位、只数、借出/应还日期、经手人；归还为负流水，支持分批归还 | `loans` |
| Movement 出柜流水 | 按只数永久出柜台账（提取、销毁、转移等），记录原插位与原因 | `movements` |

- 数据库名 `gbinsectlog`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史标本补齐默认采集方式（扫网）；
- `version(3)` 支持浸液标本「一份散放多个插位」：`storages` 增加只数字段，旧数据升级后**照旧只占一个插位**，该插位只数补为登记总数；新增 `loans` / `movements` 两张台账表；
- 标本编号规则：`采集地代码-年份-流水号`（如 `QLB-2026-0007`），提交时自动分配并查重；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/specimens` | 标本清单：按目/科、鉴定状态、采集地、采集日期区间与关键字组合筛选，多选批量推进鉴定状态，导出命中清单 |
| `/collect` | 采集登记：选择采集地后自动带出生境/小生境/微气候，一次提交多条同批次标本，编号自动生成并查重 |
| `/sites` | 采集地管理：经纬度格式校验、各地采集次数统计、50 米内邻近采集地提示与一键合并 |
| `/determination` | 鉴定工作流：待鉴定队列逐条处理，落鉴定记录并自动推进标本状态（已鉴定 / 待复核） |
| `/storage` | 保藏分装柜位图：柜-抽屉-盒-位三级展开，一份标本散放进多个插位，每插位记只数；只数对不上整份退回；插位上可按只出柜 / 借出 |
| `/loans` | 借出归还：按只数借出与分批归还，出柜流水台账，账实核对（总数＝在柜＋借出中＋已出柜） |

## 七、业务约定

- 采集地代码是标本编号前缀，代码重复会被拒绝；
- 坐标 50 米内视为同一采集地，页面上给出合并提示，合并会把原采集地标本自动改挂；
- 鉴定记录提交后自动把标本状态推进为「已鉴定」，勾选「需复核」则置为「待复核」；
- **个体总数由采集登记管**（`Specimen.quantity`，正整数），库房只负责把只数分到插位，不回改总数；
- 一份标本可散放进多个插位，每个插位只放它的一部分，**只数按插位记**（`storages.count`）；每个柜位（柜-屉-盒-位）仍只允许一份标本；
- 分装在单个 Dexie 事务内原子提交：只数之和不等于应放只数、批次内插位重复或插位被占用时，**整份退回，本次没放下的不留任何插位**；某一份分装失败只退它自己，不影响别的标本；重试（含整份重排）先清该份旧记录，**不重复占位**；
- 出柜与借出都**按只数算**：从具体插位扣减，扣到 0 自动腾退插位；借出可分批归还，归还只数回补该份现有插位；
- 盘点恒等式：**登记总数 ＝ 在柜只数 ＋ 借出中只数 ＋ 已出柜只数**，借出归还页给出账实核对表；
- 旧数据升级到 v3 后每份仍只占一个插位，只数自动补为该份登记总数，行为照旧。
