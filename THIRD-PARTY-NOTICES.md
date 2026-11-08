# 第三方组件与许可清单（THIRD-PARTY-NOTICES）

沙漏 Hourglass 本体在 [PolyForm Noncommercial License 1.0.0](LICENSE) 下分发（**非商业使用**；商业使用需向版权持有人另行取得授权）。本文件列出随产品一同分发的第三方组件及其许可证。
第三方组件的版权归各自权利人所有，沿用其原始许可证，不因本产品的许可证而改变；本产品的非商业限制**不**适用于这些第三方组件。

标注说明：

- **已核验**：许可证信息直接来自随包文件的版权/许可头部。
- **待核验**：压缩打包时许可头部被移除，需回到上游仓库按实际版本核对后补齐。

## 一、前端内嵌库（`frontend/vendor/`）

前端为零构建方案，以下库以压缩产物形式直接随仓库分发。

| 组件 | 版本 | 许可证 | 位置 | 核验状态 |
| --- | --- | --- | --- | --- |
| marked | 12.0.2 | MIT（Copyright (c) 2011-2024, Christopher Jeffrey） | `vendor/markdown/marked.min.js` | 已核验（文件头部） |
| DOMPurify | 3.4.17 | Apache-2.0 **或** MPL-2.0 双许可（(c) Cure53 and other contributors） | `vendor/markdown/purify.min.js` | 已核验（文件头部） |
| SheetJS（xlsx.js，社区版） | 1.15.0 | Apache-2.0（社区版） | `vendor/sheetjs/xlsx.full.min.js` | 待核验：文件头部仅含版权声明，需按实际版本核对上游条款 |
| SunEditor | 待补 | MIT | `vendor/suneditor/suneditor.min.{js,css}` | 待核验：压缩产物无许可头部 |
| Univer（`@univerjs/*` 开源包） | 待补 | Apache-2.0 | `vendor/univer/*.js` | 待核验：压缩产物无许可头部。已确认**未包含** `@univerjs-pro/*` 商业授权包 |
| React / ReactDOM | 18.3.1 | MIT（Copyright (c) Meta Platforms, Inc. and affiliates） | `vendor/univer/react.min.js`、`react-dom.min.js` | 已核验（版本号取自产物） |
| RxJS | 待补 | Apache-2.0 | `vendor/univer/rxjs.umd.min.js` | 待核验 |
| redi（`@wendellhu/redi`） | 待补 | 待核验 | `vendor/univer/redi.js`、`redi-react.js` | 待核验 |

Univer 相关注意事项：

1. `vendor/univer/telemetry.js` 会被 `frontend/js/core/sheet-viewer.js` 加载。私有化交付前需确认遥测上报是否已关闭，并在客户告知材料中说明。
2. Univer 上游同时存在开源包（Apache-2.0）与商业 Pro 包（独立商业授权）。后续升级依赖时必须继续只引入开源包，Pro 包需单独获得商业授权。

## 二、后端依赖（`backend/pom.xml`）

后端以 Spring Boot 可执行 jar 分发，jar 内含以下传递依赖。

| 组件 | 许可证 | 备注 |
| --- | --- | --- |
| Spring Boot / Spring Framework / Spring Security | Apache-2.0 | |
| MyBatis、mybatis-spring-boot-starter | Apache-2.0 | |
| Apache POI（poi、poi-ooxml、poi-ooxml-full、poi-scratchpad） | Apache-2.0 | Word 导入与在线表格依赖 |
| Apache HttpClient、commons-codec | Apache-2.0 | |
| jsoup 1.23.2 | MIT | 富文本白名单清洗 |
| fr.opensagres.poi.xwpf.converter.xhtml 2.0.4 | 待核验 | docx → XHTML 转换 |
| Lombok | MIT | 编译期，不打入产物 |
| **MySQL Connector/J** | **GPL-2.0 + Oracle FOSS/Universal FOSS Exception** | **需法务确认**：见下 |

### MySQL Connector/J 的授权问题（发布前必须解决）

MySQL Connector/J 采用 **GPLv2 + Oracle FOSS Exception**。该例外的适用前提是：与之组合分发的应用本身采用 Oracle 认可的**开源许可证**。
本产品采用 PolyForm Noncommercial License 1.0.0，属于「源码可用（source-available）」而**非** OSI 认可的开源许可证，因此：

- FOSS Exception 很可能**不适用**于本产品的 fat jar 再分发；
- `backend/pom.xml` 中 `mysql-connector-j` 为 `runtime` 作用域，会被 Spring Boot 打进 `hourglass-server.jar`，属于**再分发**行为。

这是当前**唯一可能直接阻塞对外分发**的依赖项，处理方案（按推荐度排序）：

1. **不随包分发驱动**（推荐）：从 `pom.xml` 移除或改为 `provided`，在部署文档中要求部署者自行下载 `mysql-connector-j`，通过 `java -Dloader.path=/opt/hourglass/drivers -jar hourglass-server.jar` 加载。交付包体积略增步骤，但授权最干净。
2. **改用 MariaDB Connector/J（LGPL-2.1）**：可随包分发，但需同时提供 LGPL 许可文本、说明用户有权替换该库，并验证与 MySQL 8.0.46 的兼容性（认证插件、`allowPublicKeyRetrieval`、时区参数等连接串选项需逐项回归）。
3. **取得 Oracle 商业授权**：成本与谈判周期都高，不建议。

在方案落地前，不要对外发布包含 Connector/J 的构建产物。

## 三、待补齐的自动化核验

上表中「待核验」项与完整传递依赖清单，建议用 `license-maven-plugin` 自动生成后回填：

```bash
mvn -f backend/pom.xml org.codehaus.mojo:license-maven-plugin:add-third-party \
    -Dlicense.outputDirectory=. -Dlicense.thirdPartyFilename=backend-third-party.txt
```

前端库因以压缩产物入库，无包管理器清单可用，需按 `vendor/` 目录逐个记录上游仓库与版本，后续升级时同步更新本文件。
