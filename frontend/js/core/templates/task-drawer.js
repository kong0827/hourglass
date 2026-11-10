/* core/templates/task-drawer · 任务详情抽屉的结构模板（从 index.html 拆出）
   纯 HTML 字符串；由 core/templates/index.js 在 core/dom.js 求值前注入。 */

export var TASK_DRAWER_HTML = `<!-- ==================== 任务详情抽屉（§7.1） ==================== -->
<div class="drawer-layer" id="taskDrawer" role="dialog" aria-modal="true" aria-labelledby="taskDrawerTitle">
  <div class="drawer-scrim" id="taskScrim"></div>
  <form class="drawer" id="taskForm" novalidate>
    <div class="sheet-grab" aria-hidden="true"></div>
    <div class="drawer-head">
      <span class="head-icon t-task" id="taskDrawerIcon" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.4" y="3.8" width="11.2" height="12.8" rx="2"/><path d="M7.6 3.8V2.6h4.8v1.2M7.4 8.2h5.2M7.4 11.2h3.6"/></svg>
      </span>
      <div class="head-txt">
        <h2 id="taskDrawerTitle">新建工作项</h2>
        <div class="head-sub" id="taskDrawerSub"></div>
      </div>
      <div class="head-tools">
        <button class="btn sm" type="button" id="btnTaskNew" hidden title="按当前工作项所属项目新建工作项">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 4.4v11.2M4.4 10h11.2"/></svg>
          新建工作项
        </button>
        <button class="btn sm" type="button" id="btnTaskWatch" hidden aria-pressed="false">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2a4.6 4.6 0 0 1 4.6 4.6c0 3.4 1.1 4.6 1.1 4.6H4.3s1.1-1.2 1.1-4.6A4.6 4.6 0 0 1 10 3.2z"/><path d="M8.4 15.2a1.8 1.8 0 0 0 3.2 0"/></svg>
          <span id="taskWatchLabel">关注</span>
        </button>
        <div class="head-more-wrap">
          <button class="icon-btn sm" type="button" id="btnTaskMore" aria-label="更多操作" aria-haspopup="true" aria-expanded="false">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="4.6" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="10" r="1.1" fill="currentColor" stroke="none"/></svg>
          </button>
          <div class="menu" id="taskMoreMenu" hidden>
            <button class="menu-item" type="button" data-task-more="copy-link">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.4 11.6a3.4 3.4 0 0 0 4.8 0l2.6-2.6a3.4 3.4 0 0 0-4.8-4.8L9.8 5.4"/><path d="M11.6 8.4a3.4 3.4 0 0 0-4.8 0L4.2 11a3.4 3.4 0 0 0 4.8 4.8l1.1-1.1"/></svg>
              复制工作项链接
            </button>
            <button class="menu-item" type="button" data-task-more="copy-title">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7.2" y="7.2" width="9.4" height="9.4" rx="2.2"/><path d="M12.8 4.2H5.4a2 2 0 0 0-2 2v7.4"/></svg>
              复制标题
            </button>
            <button class="menu-item" type="button" data-task-more="save-continue" id="taskMoreSaveContinue" hidden>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.6h9.2L16.4 6.8v9.6H3.6z"/><path d="M7 3.6v4.2h5.4V3.6M7 16.4v-3.6h6v3.6"/></svg>
              保存并继续
            </button>
            <div class="menu-sep"></div>
            <button class="menu-item danger" type="button" data-task-more="trash" id="taskMoreTrash">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 5.6h12.8M8.2 5.6V3.8h3.6v1.8M5.4 5.6l.8 10.2h7.6l.8-10.2"/></svg>
              移到回收站
            </button>
          </div>
        </div>
        <button class="icon-btn" type="button" id="btnCloseTask" aria-label="关闭">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
        </button>
      </div>
    </div>

    <div class="drawer-notice" id="drawerNotice" hidden>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 6.2v4.2"/><path d="M10 13.6h.01"/><circle cx="10" cy="10" r="7.6"/></svg>
      <span id="drawerNoticeText"></span>
      <button type="button" id="drawerNoticeReload">点击刷新</button>
    </div>

    <div class="drawer-body">
      <!-- 标题：最高优先级字段 -->
      <div class="title-wrap" id="fTitle">
        <div class="title-row">
          <label class="sr-only" for="iTitle">工作项标题</label>
          <input class="title-input" id="iTitle" type="text" maxlength="60" placeholder="一句话说清要做什么，例如：重构权限校验中间件" autocomplete="off" />
          <span class="req-chip">必填</span>
        </div>
        <div class="title-foot">
          <span class="err">请填写工作项标题</span>
          <span class="counter" id="iTitleCount">0/60</span>
        </div>
      </div>

      <!-- 类型 + 优先级：两个分类动作合成一行 -->
      <div class="classify">
        <span class="seg-label">类型
          <button type="button" class="label-help" id="iItemTypeHelp" aria-label="查看各类型的区别说明" title="各类型的区别"></button>
        </span>
        <div class="type-group" id="typeGroup" role="group" aria-label="工作项类型">
          <button class="type-btn" type="button" data-type="task" aria-pressed="true">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.4" y="3.8" width="11.2" height="12.8" rx="2"/><path d="M7.6 3.8V2.6h4.8v1.2M7.4 8.2h5.2M7.4 11.2h3.6"/></svg>任务
          </button>
          <button class="type-btn" type="button" data-type="story" aria-pressed="false">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3.4h9.6v13.2L10 13.6l-4.8 3z"/></svg>用户故事
          </button>
          <button class="type-btn" type="button" data-type="bug" aria-pressed="false">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10.6" r="4.6"/><path d="M10 6V3.4M6.2 7.6 4.4 5.8M13.8 7.6l1.8-1.8M5.4 10.6H2.8M17.2 10.6h-2.6M6.2 13.6l-1.8 1.8M13.8 13.6l1.8 1.8"/></svg>缺陷
          </button>
          <button class="type-btn" type="button" data-type="epic" aria-pressed="false">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 3.6 6.4 10 9.8l6.4-3.4z"/><path d="m3.6 10 6.4 3.4L16.4 10"/><path d="m3.6 13.4 6.4 3.4 6.4-3.4"/></svg>史诗
          </button>
        </div>
        <select id="iItemType" hidden>
          <option value="task">任务</option>
          <option value="story">用户故事</option>
          <option value="bug">缺陷</option>
          <option value="epic">史诗</option>
        </select>
        <span class="vdiv" aria-hidden="true"></span>
        <span class="seg-label">优先级</span>
        <div class="pri-group" id="segPri" role="group" aria-label="优先级"></div>
      </div>

      <!-- 编辑态速览：关键信息前置，避免在长表单里来回找 -->
      <div class="drawer-facts" id="drawerFacts" hidden aria-label="工作项概览">
        <button class="fact fact-status" type="button" id="factStatus" title="切换工作项状态">
          <span class="fact-k">状态</span>
          <span class="fact-v"><i class="fact-dot" id="factStatusDot"></i><b id="factStatusName">—</b>
            <span class="fact-caret"><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
          </span>
        </button>
        <div class="fact">
          <span class="fact-k">进度</span>
          <span class="fact-v"><span class="fact-bar"><i id="factProgBar"></i></span><b id="factProg">0%</b></span>
        </div>
        <div class="fact">
          <span class="fact-k">实际 / 预估</span>
          <span class="fact-v"><b id="factActual">—</b><span class="fact-sub" id="factEstimate"></span></span>
        </div>
        <div class="fact fact-due" id="factDueWrap">
          <span class="fact-k">截止</span>
          <span class="fact-v"><b id="factDue">—</b><span class="fact-sub" id="factDueNote"></span></span>
        </div>
        <div class="fact" id="factTestWrap" hidden>
          <span class="fact-k">测试</span>
          <span class="fact-v"><b id="factTest">—</b></span>
        </div>
      </div>

      <!-- 归属与分配：高亮信息条 -->
      <div class="ctx" aria-label="归属与分配">
        <div class="ctx-item">
          <label class="ctx-label" for="iReq">所属项目 <span class="auto" id="autoProject" hidden>自动</span></label>
          <select id="iReq" title="工作项可暂不归属项目；需求文档、测试用例与测试计划必须归属项目"></select>
        </div>
        <div class="ctx-item">
          <label class="ctx-label" for="iOwner">负责人</label>
          <select id="iOwner"></select>
        </div>
        <div class="ctx-item" id="ctxColItem">
          <label class="ctx-label" for="iCol" id="ctxColLabel">创建到</label>
          <select id="iCol" aria-label="创建到哪一列"></select>
        </div>
      </div>

      <!-- 主体：内容 / 计划 / 缺陷 / 更多 + 关联 -->
      <div class="task-detail-layout">
        <div class="task-detail-main stack">
          <section class="drawer-card">
            <div class="drawer-card-head"><h3>内容</h3><span class="foot-note">只有标题必填</span></div>
            <div class="field">
              <label class="field-label" for="iDesc">描述</label>
              <textarea id="iDesc" maxlength="2000" placeholder="目标、验收标准、注意事项…（可选）" style="min-height:76px"></textarea>
            </div>
            <div class="field" style="margin-top:11px">
              <div class="field-label"><label for="iTags">标签</label><span class="foot-note" style="margin-left:auto">回车或逗号添加 · 最多 8 个</span></div>
              <div class="tag-input-wrap" id="tagWrap">
                <input id="iTags" type="text" maxlength="16" placeholder="添加标签…" autocomplete="off" list="tagOptions" aria-label="添加标签" />
              </div>
              <datalist id="tagOptions"></datalist>
            </div>
          </section>

          <section class="drawer-card">
            <div class="drawer-card-head"><h3>计划</h3><span class="foot-note">开始留空则只在截止日出现</span></div>
            <div class="date-row">
              <div class="field">
                <label class="field-label" for="iStart">开始日期</label>
                <input id="iStart" type="date" />
              </div>
              <div class="date-arrow" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12M11.6 5.6 16 10l-4.4 4.4"/></svg>
              </div>
              <div class="field">
                <label class="field-label" for="iDue">截止日期</label>
                <input id="iDue" type="date" />
              </div>
            </div>
            <div class="quick-row" id="segStart" role="group" aria-label="开始日期快捷">
              <span class="hint-inline">开始快捷</span>
              <button class="chip" type="button" data-start="0">今天</button>
              <button class="chip ghost" type="button" data-start="">清空</button>
            </div>
            <div class="quick-row" id="segDue" role="group" aria-label="截止日期快捷">
              <span class="hint-inline">截止快捷</span>
              <button class="chip" type="button" data-due="0">今天</button>
              <button class="chip" type="button" data-due="1">明天</button>
              <button class="chip" type="button" data-due="fri">本周五</button>
              <button class="chip" type="button" data-due="mon">下周一</button>
              <button class="chip ghost" type="button" data-due="clear">清空</button>
              <span class="due-note" id="dueNote"></span>
            </div>
            <div class="form-grid" style="margin-top:11px">
              <div class="field">
                <label class="field-label" for="iEstimate">预计耗时 <span class="foot-note">可选</span></label>
                <div class="est-wrap">
                  <input id="iEstimate" type="number" min="0" max="168" step="0.5" placeholder="例如 4" />
                  <span class="est-unit">小时</span>
                </div>
                <span class="hint" id="iEstimateHint">填了才能和实际计时比出你的估时系数</span>
              </div>
              <div class="field">
                <div class="field-label">节点</div>
                <label class="row row-gap" style="gap:8px;height:32px">
                  <input type="checkbox" class="cbx" id="iMilestone" />
                  <span class="toolbar-meta is-strong">里程碑（单日节点）</span>
                </label>
                <span class="hint">勾选后甘特图用菱形展示，不占工期</span>
              </div>
            </div>

            <!-- 进度与投入：编辑已有工作项时展示 -->
            <div class="drawer-edit-block" id="fProgress" hidden>
              <div class="form-grid" style="margin-top:12px">
                <div class="field">
                  <div class="field-label">实际投入</div>
                  <div class="est-actual" id="iActual">—</div>
                  <span class="hint" id="iActualHint">按工作时段折算的计时累计</span>
                </div>
                <div class="field">
                  <label class="field-label" for="iProg">当前进度</label>
                  <div class="progress" id="progWrap">
                    <input id="iProg" type="range" min="0" max="100" step="5" value="0" aria-label="当前进度百分比" />
                    <span class="pv" id="progVal">0%</span>
                  </div>
                  <span class="hint" id="progHint">0–100，拖到 100% 不会自动标记完成（完成以「移入已完成列」为准）</span>
                </div>
              </div>
              <div class="seg mini" id="segProg" style="margin-top:8px">
                <button type="button" data-prog="0">0</button>
                <button type="button" data-prog="25">25</button>
                <button type="button" data-prog="50">50</button>
                <button type="button" data-prog="75">75</button>
                <button type="button" data-prog="100">100</button>
              </div>
              <div class="field" style="margin-top:10px">
                <label class="field-label" for="iNote">进度备注</label>
                <input id="iNote" type="text" maxlength="80" placeholder="本次推进到哪一步、卡点在哪里…" autocomplete="off" />
              </div>
            </div>

            <!-- 测试窗口：进入测试中后自动记录 -->
            <div class="drawer-edit-block" id="fTestWindow" hidden>
              <div class="form-grid" style="margin-top:12px">
                <div class="field">
                  <div class="field-label">开始测试</div>
                  <div class="est-actual" id="iTestStart">—</div>
                </div>
                <div class="field">
                  <div class="field-label">结束测试</div>
                  <div class="est-actual" id="iTestEnd">—</div>
                </div>
              </div>
              <span class="hint">进入「测试中」自动记录开始测试；测试通过或退回时记录结束测试</span>
            </div>
          </section>

          <!-- 缺陷信息：仅工作项类型为缺陷时显示 -->
          <section class="drawer-card drawer-card-defect" id="fDefect" hidden>
            <div class="drawer-card-head"><h3>缺陷信息</h3><span class="foot-note">严重度必填，其余可后补</span></div>
            <div class="field" id="fSeverity">
              <div class="field-label">严重度 <span class="req">*</span></div>
              <div class="sev-grid" id="sevGrid" role="group" aria-label="严重度" tabindex="-1">
                <button class="sev" type="button" data-sev="blocker"><i></i>阻断</button>
                <button class="sev" type="button" data-sev="critical"><i></i>严重</button>
                <button class="sev" type="button" data-sev="major"><i></i>一般</button>
                <button class="sev" type="button" data-sev="minor"><i></i>轻微</button>
              </div>
              <select id="iSeverity" hidden>
                <option value="">请选择</option>
                <option value="blocker">阻断</option>
                <option value="critical">严重</option>
                <option value="major">一般</option>
                <option value="minor">轻微</option>
              </select>
              <span class="err">缺陷必须选择严重度</span>
            </div>
            <div class="form-grid" style="margin-top:11px">
              <div class="field">
                <label class="field-label" for="iFoundVersion">发现版本</label>
                <select id="iFoundVersion"></select>
              </div>
              <div class="field">
                <label class="field-label" for="iEnvironment">发现环境</label>
                <input id="iEnvironment" type="text" maxlength="120" placeholder="浏览器 / 系统 / 环境" autocomplete="off" />
              </div>
            </div>
            <div class="field" style="margin-top:11px">
              <label class="field-label" for="iReproSteps">复现步骤</label>
              <textarea id="iReproSteps" maxlength="2000" placeholder="1. 进入…&#10;2. 点击…&#10;3. 期望…实际…" style="min-height:76px"></textarea>
            </div>
            <div class="field" id="fRegression" hidden style="margin-top:11px">
              <label class="field-label" for="iRegression">回归状态</label>
              <select id="iRegression">
                <option value="">未开始</option>
                <option value="pending">待回归</option>
                <option value="passed">回归通过</option>
                <option value="failed">回归失败</option>
              </select>
              <span class="hint">修复完成后由测试同学回填，管理报表按此口径统计缺陷关闭</span>
            </div>
          </section>

          <!-- 低频设置收进折叠区 -->
          <details class="drawer-more drawer-settings" id="drawerMore">
            <summary>
              <span>更多设置</span>
              <span class="foot-note" id="drawerMoreSummary">· 模块：未设置</span>
              <span class="caret"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </summary>
            <div class="drawer-more-body drawer-settings-body" id="drawerMoreBody">
              <div class="field span2">
                <div class="field-label">模块</div>
                <div class="seg" id="segCat"></div>
              </div>
              <div class="field">
                <div class="field-label">循环</div>
                <div class="seg grid4" id="segRecur"></div>
              </div>
              <div class="field">
                <label class="field-label" for="iRemindTarget">提醒谁</label>
                <select id="iRemindTarget">
                  <option value="owner">仅负责人</option>
                  <option value="owner+admin">负责人 + 空间主</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="iRemind">提醒时间</label>
                <input id="iRemind" type="datetime-local" />
              </div>
              <div class="field">
                <div class="field-label">阻塞 / 卡点</div>
                <div class="blocked-row">
                  <label class="sw sw-warn"><input type="checkbox" id="iBlocked" /> 被阻塞</label>
                  <input id="iBlockedReason" class="input" type="text" maxlength="120" placeholder="等谁 / 等什么 / 预计何时解除" disabled />
                </div>
              </div>
              <div class="field span2">
                <span class="hint">被阻塞的工作项在卡片上会显示橙色条纹，可在筛选栏「更多筛选 → 仅看被阻塞」里集中查看。</span>
              </div>
            </div>
          </details>

          <!-- 检查清单 -->
          <div class="drawer-sect collapsed" id="fSubtasks" hidden>
            <div class="drawer-sect-head" role="button" tabindex="0" aria-expanded="false">
              <h3>检查清单</h3><span class="cnt" id="subCount"></span>
              <span class="caret"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </div>
            <div class="drawer-sect-body">
              <div class="sub-list" id="subList"></div>
              <input id="iSubNew" class="input" type="text" maxlength="60" placeholder="添加一项，回车确认" autocomplete="off" style="margin-top:8px" />
            </div>
          </div>

          <!-- 附件 -->
          <div class="drawer-sect collapsed" id="fAttach" hidden>
            <div class="drawer-sect-head" role="button" tabindex="0" aria-expanded="false">
              <h3>附件</h3><span class="cnt" id="attachCount"></span>
              <span class="caret"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </div>
            <div class="drawer-sect-body">
              <div class="attach-list" id="attachList"></div>
              <div class="row row-gap" style="margin-top:8px">
                <button class="btn sm" type="button" id="btnAttach">上传文件（≤10MB）</button>
                <span class="foot-note">jpg/png/gif/webp/pdf/txt/md/zip/xlsx/xls/doc/docx/ppt/pptx</span>
                <input type="file" id="iAttachFile" hidden />
              </div>
            </div>
          </div>

          <!-- 工时 -->
          <div class="drawer-sect collapsed" id="fWork" hidden>
            <div class="drawer-sect-head" role="button" tabindex="0" aria-expanded="false">
              <h3>工时</h3>
              <span class="caret"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </div>
            <div class="drawer-sect-body">
              <div class="work-row">
                <span class="work-val" id="workVal">—</span>
                <button class="btn sm" type="button" id="btnTimer">开始计时</button>
                <button class="btn sm ghost" type="button" id="btnTimerAdd" title="手工补记一条实际工时（忘开表、加班等）">
                  <span data-icon="plus"></span>&nbsp;补记
                </button>
              </div>
              <div class="work-log" id="workLogList"></div>
            </div>
          </div>

          <!-- 时间线 -->
          <div class="drawer-sect collapsed" id="fTimeline" hidden>
            <div class="drawer-sect-head" role="button" tabindex="0" aria-expanded="false">
              <h3>操作时间线</h3>
              <span class="caret"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </div>
            <div class="drawer-sect-body">
              <div class="timeline" id="timelineBox"></div>
            </div>
          </div>
        </div>

        <aside class="task-detail-side">
          <section class="source-card" id="drawerSource" hidden aria-live="polite">
            <div class="source-head">
              <span class="source-badge">来自需求池</span>
              <button class="link-btn" type="button" id="drawerSourceRemove">移除关联</button>
            </div>
            <h4 id="drawerSourceTitle"></h4>
            <div class="source-meta" id="drawerSourceMeta"></div>
            <div class="source-auto">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2v13.6M3.2 10h13.6"/></svg>
              <span>已自动带出：所属项目</span>
            </div>
          </section>

          <section class="drawer-card">
            <div class="drawer-card-head"><h3>关联</h3><span class="foot-note">关联需求或文档会同步项目</span></div>
            <div class="field">
              <div class="field-label">
                <label for="iVersion">计划版本</label>
                <button type="button" class="label-help" id="iVersionHelp" aria-label="查看版本与首版/迭代的区分逻辑" title="版本与首版/迭代怎么区分"></button>
              </div>
              <select id="iVersion" multiple size="3" aria-label="计划版本（可多选）" title="按住 Cmd / Ctrl 增减选择"></select>
              <span class="hint" id="iVersionHint">可多选；全部取消即「待规划」。计划关联不代表实际交付。</span>
              <span class="hint" id="iDemandTarget" aria-live="polite"></span>
            </div>
            <div class="field" id="fVersionChangeReason" hidden>
              <label class="field-label" for="iVersionChangeReason">版本调整理由 <span class="req">*</span></label>
              <input id="iVersionChangeReason" type="text" maxlength="500" placeholder="说明顺延、解除计划或偏离需求目标的原因" />
            </div>
            <div class="field">
              <div class="field-label">
                <label for="iDemand">关联需求</label>
                <button type="button" class="label-link" id="iDemandView" hidden>查看</button>
              </div>
              <select id="iDemand"></select>
              <span class="hint" id="iDemandHint">先选项目；未选项目时会自动带出需求所属项目。</span>
            </div>
            <details class="assoc-more" id="assocMore">
              <summary>
                <span>更多关联</span>
                <span class="foot-note" id="assocMoreSummary">史诗 / 分支 / 文档</span>
                <span class="caret"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
              </summary>
              <div class="assoc-more-body">
                <div class="field">
                  <div class="field-label">
                    <label for="iEpic">所属史诗</label>
                    <button type="button" class="label-help" id="iEpicHelp" aria-label="查看史诗（Epic）的说明" title="史诗（Epic）是什么"></button>
                  </div>
                  <select id="iEpic"></select>
                  <span class="hint" id="iEpicHint">先选项目，再挂到该项目的史诗下。</span>
                </div>
                <div class="field">
                  <label class="field-label" for="iBranch">所属分支</label>
                  <select id="iBranch"></select>
                  <span class="hint" id="iBranchHint">分支在「分支」页创建，这里负责挂接。</span>
                </div>
                <div class="field">
                  <div class="field-label">
                    <label for="iReqDocPicker">关联文档</label>
                    <button type="button" class="label-link" id="iReqDocView" hidden>查看</button>
                  </div>
                  <button type="button" class="req-doc-trigger" id="iReqDocPicker" aria-haspopup="dialog" aria-expanded="false">
                    <span class="req-doc-trigger-text placeholder" id="iReqDocPickerText">搜索并选择文档</span>
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>
                  </button>
                  <select id="iReqDoc" hidden tabindex="-1" aria-hidden="true"></select>
                  <span class="hint" id="iReqDocHint">可搜索全部可见文档。</span>
                </div>
              </div>
            </details>
          </section>

          <!-- 生产发布事实：有正式发布数据时才出现，避免占用首屏 -->
          <section class="drawer-card" id="taskPublication" hidden>
            <div class="drawer-card-head"><h3>生产发布事实（只读）</h3><span id="taskPublishedBadge"></span></div>
            <p class="hint" id="taskPublicationInfo"></p>
            <div id="taskReleaseRecords" aria-live="polite"></div>
          </section>

          <!-- 评论 / 讨论（N-6） -->
          <div class="drawer-sect" id="fComments" hidden>
            <div class="drawer-sect-head" role="button" tabindex="0" aria-expanded="true">
              <h3>评论</h3><span class="cnt" id="commentCount"></span>
              <span class="caret"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg></span>
            </div>
            <div class="drawer-sect-body">
              <div class="comment-list" id="commentList"></div>
              <div class="comment-form">
                <div class="comment-mention" id="commentMention" hidden></div>
                <div class="comment-compose">
                  <textarea id="iComment" maxlength="500" placeholder="写下讨论、结论或卡点…（输入 @ 可提及成员，Ctrl/⌘ + Enter 发送）"></textarea>
                  <div class="comment-attach-chips" id="commentAttachChips" hidden></div>
                  <div class="comment-compose-actions">
                    <button class="btn sm soft" type="button" id="btnCommentAttach" title="添加附件（图片、PDF、Office、txt、md、zip，单个 ≤10MB）">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 6.4 7.2 11.8a2.2 2.2 0 0 0 3.1 3.1l5.4-5.4a3.8 3.8 0 0 0-5.4-5.4L4.8 9.6a5.4 5.4 0 0 0 7.6 7.6l3.4-3.4"/></svg>
                      附件
                    </button>
                    <span class="comment-attach-tip" id="commentAttachTip"></span>
                    <input type="file" id="iCommentFiles" multiple hidden
                           accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx">
                    <span class="spacer"></span>
                    <button class="btn primary" type="button" id="btnCommentSend">发送</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="after-create" id="afterCreateNote">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.4"/><path d="M10 9.2v4M10 6.6h.01"/></svg>
            <div><b>创建后可继续补充</b><span>检查项、附件、工时、评论与操作时间线在详情里，不再占用创建流程。</span></div>
          </div>
        </aside>
      </div>
    </div>

    <div class="drawer-foot">
      <button class="icon-btn" type="button" id="btnDrawerStatus" aria-label="切换工作项状态" title="切换工作项状态">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.6" width="3.8" height="12.8" rx="1.4"/><rect x="8.2" y="3.6" width="3.8" height="8.6" rx="1.4"/><rect x="13.4" y="3.6" width="3.6" height="11" rx="1.4"/></svg>
      </button>
      <span class="hint" id="taskFormHint">保存后可拖动卡片调整状态与顺序</span>
      <button class="btn danger" type="button" id="btnDeleteTask" hidden>删除</button>
      <button class="btn" type="button" id="btnCancelTask">取消</button>
      <button class="btn" type="submit" id="btnSaveTaskContinue" hidden title="保存后留在当前工作项，继续补充评论、检查项或时间">保存并继续</button>
      <button class="btn primary" type="submit" id="btnSaveTask">保存工作项</button>
    </div>
  </form>
</div>
`;
