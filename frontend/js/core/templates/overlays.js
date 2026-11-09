/* core/templates/overlays · 弹窗层与全局浮层的结构模板（从 index.html 拆出）
   包含空间/视图/成员/确认/搜索等弹窗，以及通知气泡、退出全屏与 toast 容器。
   纯 HTML 字符串；由 core/templates/index.js 在 core/dom.js 求值前注入。 */

export var OVERLAYS_HTML = `<!-- ==================== 弹窗层 ==================== -->

<!-- 新建共享空间 -->
<div class="modal-layer" id="dlgWsCreate" role="dialog" aria-modal="true" aria-labelledby="dlgWsCreateTitle">
  <form class="sheet xs" id="dlgWsCreateForm" novalidate>
    <div class="sheet-head">
      <div style="flex:1 1 auto;min-width:0">
        <h2 id="dlgWsCreateTitle">新建共享空间</h2>
        <div class="desc">创建后生成邀请链接发给同事，对方确认后即可一起维护</div>
      </div>
      <button class="icon-btn sm" type="button" id="dlgWsCreateX" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="sheet-body">
      <div class="field" id="fDlgWsName">
        <label for="dlgWsName">空间名称 <span class="req">*</span></label>
        <input id="dlgWsName" type="text" maxlength="20" placeholder="例如：项目组看板" autocomplete="off" />
        <span class="err">请填写空间名称</span>
      </div>
    </div>
    <div class="sheet-foot">
      <span class="hint"></span>
      <button class="btn" type="button" id="dlgWsCreateCancel">取消</button>
      <button class="btn primary" type="submit" id="dlgWsCreateOk">创建空间</button>
    </div>
  </form>
</div>

<!-- 保存视图命名 -->
<div class="modal-layer" id="dlgViewName" role="dialog" aria-modal="true" aria-labelledby="dlgViewNameTitle">
  <form class="sheet xs" id="dlgViewNameForm" novalidate>
    <div class="sheet-head">
      <div style="flex:1 1 auto;min-width:0">
        <h2 id="dlgViewNameTitle">保存为视图</h2>
        <div class="desc">保存当前全部筛选条件，可跨设备应用</div>
      </div>
      <button class="icon-btn sm" type="button" id="dlgViewNameX" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="sheet-body">
      <div class="field" id="fDlgViewName">
        <label for="dlgViewInput">视图名称 <span class="req">*</span></label>
        <input id="dlgViewInput" type="text" maxlength="20" placeholder="例如：我的 P0、本周待交付" autocomplete="off" />
        <span class="err">请填写视图名称</span>
      </div>
    </div>
    <div class="sheet-foot">
      <span class="hint"></span>
      <button class="btn" type="button" id="dlgViewNameCancel">取消</button>
      <button class="btn primary" type="submit" id="dlgViewNameOk">保存视图</button>
    </div>
  </form>
</div>

<!-- 删除空间（输入名称确认） -->
<div class="modal-layer" id="dlgWsDelete" role="dialog" aria-modal="true" aria-labelledby="dlgWsDeleteTitle">
  <form class="sheet xs" id="dlgWsDeleteForm" novalidate>
    <div class="sheet-head">
      <div style="flex:1 1 auto;min-width:0">
        <h2 id="dlgWsDeleteTitle">删除空间</h2>
        <div class="desc danger">空间内的全部工作项、项目、附件将一并删除，不可恢复</div>
      </div>
      <button class="icon-btn sm" type="button" id="dlgWsDeleteX" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="sheet-body">
      <div class="field" id="fDlgWsDelete">
        <label for="dlgWsDeleteInput">请输入空间名称 <b id="dlgWsDeleteName" style="color:var(--danger)"></b> 以确认</label>
        <input id="dlgWsDeleteInput" type="text" maxlength="20" autocomplete="off" />
        <span class="err">名称不一致</span>
      </div>
    </div>
    <div class="sheet-foot">
      <span class="hint"></span>
      <button class="btn" type="button" id="dlgWsDeleteCancel">取消</button>
      <button class="btn danger-solid" type="submit" id="dlgWsDeleteOk" disabled>彻底删除</button>
    </div>
  </form>
</div>

<!-- 管理员重置密码 -->
<div class="modal-layer" id="dlgUserPwd" role="dialog" aria-modal="true" aria-labelledby="dlgUserPwdTitle">
  <form class="sheet xs" id="dlgUserPwdForm" novalidate>
    <div class="sheet-head">
      <div style="flex:1 1 auto;min-width:0">
        <h2 id="dlgUserPwdTitle">重置密码</h2>
        <div class="desc">为 <b id="dlgUserPwdFor">—</b> 设置新密码（6-64 位）</div>
      </div>
      <button class="icon-btn sm" type="button" id="dlgUserPwdX" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="sheet-body">
      <div class="field" id="fDlgUserPwd">
        <label for="dlgUserPwdInput">新密码 <span class="req">*</span></label>
        <input id="dlgUserPwdInput" type="text" maxlength="64" autocomplete="off" />
        <span class="err">密码至少 6 位</span>
      </div>
    </div>
    <div class="sheet-foot">
      <span class="hint"></span>
      <button class="btn" type="button" id="dlgUserPwdCancel">取消</button>
      <button class="btn primary" type="submit" id="dlgUserPwdOk">重置密码</button>
    </div>
  </form>
</div>

<!-- 管理员编辑账号 -->
<div class="modal-layer" id="dlgUserEdit" role="dialog" aria-modal="true" aria-labelledby="dlgUserEditTitle">
  <form class="sheet xs" id="dlgUserEditForm" novalidate>
    <div class="sheet-head">
      <div style="flex:1 1 auto;min-width:0">
        <h2 id="dlgUserEditTitle">编辑账号</h2>
        <div class="desc">登录名 <b id="dlgUserEditFor">—</b> 创建后不可修改</div>
      </div>
      <button class="icon-btn sm" type="button" id="dlgUserEditX" aria-label="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="sheet-body">
      <div class="field" id="fDlgUserName">
        <label for="dlgUserName">显示名 <span class="req">*</span></label>
        <input id="dlgUserName" type="text" maxlength="32" autocomplete="off" />
        <span class="err">显示名不能为空</span>
      </div>
      <div class="field" id="fDlgUserEmail">
        <label for="dlgUserEmail">邮箱</label>
        <input id="dlgUserEmail" type="email" maxlength="254" autocomplete="off" placeholder="可留空；填写后可用于登录与邮件通知" />
        <span class="err">邮箱格式不正确</span>
      </div>
      <div class="field" id="fDlgUserRole">
        <label for="dlgUserRole">平台角色</label>
        <select id="dlgUserRole">
          <option value="user">普通账号</option>
          <option value="admin">平台管理员</option>
        </select>
        <span class="hint" id="dlgUserRoleHint">普通账号只能管理自己的数据与参与的空间；平台管理员可管理全部账号与系统设置。</span>
      </div>
    </div>
    <div class="sheet-foot">
      <span class="hint"></span>
      <button class="btn" type="button" id="dlgUserEditCancel">取消</button>
      <button class="btn primary" type="submit" id="dlgUserEditOk">保存</button>
    </div>
  </form>
</div>

<!-- 分支详情抽屉：状态切换 + 时间线 + 关联任务 -->
<div class="drawer-layer" id="branchDrawer" role="dialog" aria-modal="true" aria-labelledby="brDrawerTitle">
  <div class="drawer-scrim" id="branchScrim"></div>
  <div class="drawer br-drawer">
    <div class="drawer-head">
      <h2 id="brDrawerTitle">分支</h2>
      <button class="icon-btn" type="button" id="brDrawerClose" aria-label="关闭">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
      </button>
    </div>
    <div class="drawer-body" id="brDrawerBody"></div>
  </div>
</div>

<!-- 统一危险确认框 -->
<div class="modal-layer" id="dlgConfirm" role="dialog" aria-modal="true" aria-labelledby="dlgConfirmTitle">
  <div class="sheet xs confirm-sheet">
    <button class="icon-btn sm confirm-x" type="button" id="dlgConfirmX" aria-label="关闭">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
    </button>
    <span class="confirm-ic danger" id="dlgConfirmIc" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="8"/><path d="M10 5.8v5"/><path d="M10 14h.01"/></svg>
    </span>
    <h3 class="confirm-title" id="dlgConfirmTitle">确认操作</h3>
    <p class="confirm-msg" id="dlgConfirmMsg"></p>
    <div class="confirm-foot">
      <button class="btn" type="button" id="dlgConfirmCancel">取消</button>
      <button class="btn danger-solid" type="button" id="dlgConfirmOk">确定</button>
    </div>
  </div>
</div>

<!-- 甘特图分享：只读链接（30 天有效） -->
        <div class="modal-layer" id="dlgGanttShare" role="dialog" aria-modal="true" aria-labelledby="dlgGanttShareTitle">
          <div class="sheet">
            <h3 class="reqdoc-dlg-title" id="dlgGanttShareTitle">分享甘特图</h3>
            <p class="reqdoc-dlg-msg">拿到链接的人无需登录即可查看只读甘特图；链接 30 天有效，可随时停止分享。</p>
            <div class="reqdoc-dlg-form">
              <label class="reqdoc-dlg-field">
                <span>只读链接</span>
                <input id="ganttShareUrl" type="text" readonly placeholder="点击下方「生成链接」" />
              </label>
            </div>
            <div class="reqdoc-dlg-foot">
              <button class="btn danger" type="button" id="ganttShareRevoke">停止分享</button>
              <button class="btn" type="button" id="ganttShareClose">关闭</button>
              <button class="btn primary" type="button" id="ganttShareCopy">复制链接</button>
            </div>
          </div>
        </div>
<!-- 文档分享：只读链接（30 天有效，需先发布） -->
        <div class="modal-layer" id="dlgReqDocShare" role="dialog" aria-modal="true" aria-labelledby="dlgReqDocShareTitle">
          <div class="sheet">
            <h3 class="reqdoc-dlg-title" id="dlgReqDocShareTitle">分享文档</h3>
            <p class="reqdoc-dlg-msg">拿到链接的人无需登录即可查看文档正文（不含评论与历史）；链接 30 天有效，可随时停止分享。文档需先发布。</p>
            <div class="reqdoc-dlg-form">
              <label class="reqdoc-dlg-field">
                <span>只读链接</span>
                <input id="reqDocShareUrl" type="text" readonly placeholder="点击下方「生成链接」" />
              </label>
            </div>
            <div class="reqdoc-dlg-foot">
              <button class="btn danger" type="button" id="reqDocShareRevoke">停止分享</button>
              <button class="btn" type="button" id="reqDocShareClose">关闭</button>
              <button class="btn primary" type="button" id="reqDocShareCopy">复制链接</button>
            </div>
          </div>
        </div>
<!-- 手工补记工时 -->
        <div class="modal-layer" id="dlgTimeAdd" role="dialog" aria-modal="true" aria-labelledby="dlgTimeAddTitle">
          <div class="sheet">
            <h3 class="reqdoc-dlg-title" id="dlgTimeAddTitle">补记工时</h3>
            <p class="reqdoc-dlg-msg">为忘开表、加班等场景补一条实际工时。补记不经过工作时段裁剪，直接计入工作项与报表；可在下方记录列表删除或作废。</p>
            <div class="reqdoc-dlg-form">
              <label class="reqdoc-dlg-field">
                <span>成员</span>
                <select id="iTimeUser"></select>
              </label>
              <label class="reqdoc-dlg-field">
                <span>日期</span>
                <input id="iTimeDate" type="date" />
              </label>
              <label class="reqdoc-dlg-field">
                <span>时长（小时）</span>
                <input id="iTimeHours" type="number" min="0.5" max="24" step="0.5" placeholder="例如 1.5" />
              </label>
              <label class="reqdoc-dlg-field">
                <span>备注（选填）</span>
                <input id="iTimeNote" type="text" maxlength="200" placeholder="例如 联调支持" />
              </label>
            </div>
            <div class="reqdoc-dlg-foot">
              <button class="btn" type="button" id="dlgTimeAddCancel">取消</button>
              <button class="btn primary" type="button" id="dlgTimeAddOk">保存</button>
            </div>
          </div>
        </div>
<!-- 快捷键与录入语法帮助（?） -->
        <div class="modal-layer" id="dlgHelp" role="dialog" aria-modal="true" aria-labelledby="dlgHelpTitle">
          <div class="sheet">
            <div class="sheet-head">
              <div style="flex:1 1 auto;min-width:0">
                <h2 id="dlgHelpTitle">快捷键与录入语法</h2>
                <div class="desc">按 <kbd>?</kbd> 随时打开；<kbd>g</kbd> 后接字母跳转视图</div>
              </div>
              <button class="icon-btn sm" type="button" id="dlgHelpX" aria-label="关闭">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3 3 13"/></svg>
              </button>
            </div>
            <div class="sheet-body"><div id="helpBody"></div></div>
            <div class="sheet-foot">
              <span class="hint">输入框 / 编辑器中不触发单键快捷键</span>
              <button class="btn primary" type="button" id="dlgHelpOk">知道了</button>
            </div>
          </div>
        </div>
<!-- 全局搜索（Cmd/Ctrl+K） -->
<div class="modal-layer search-palette" id="dlgSearch" role="dialog" aria-modal="true" aria-label="全局搜索">
  <div class="sheet palette-sheet">
    <div class="palette-input">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
        <circle cx="8.8" cy="8.8" r="5.4"/><path d="M12.9 12.9 17 17"/>
      </svg>
      <input id="paletteInput" type="search" placeholder="搜索项目、工作项、文档、需求、用例…" autocomplete="off" aria-label="全局搜索" />
      <kbd>Esc</kbd>
    </div>
    <div class="palette-results" id="paletteResults" role="listbox" aria-label="搜索结果"></div>
    <div class="palette-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 打开</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>
  </div>
</div>
<div class="unread-bubble" id="unreadBubble" hidden>
  <button class="ub-main" type="button" id="unreadBubbleMain" title="打开通知中心">
    <span class="ub-ic" id="unreadBubbleIcon"></span>
    <span class="ub-body">
      <span class="ub-title" id="unreadBubbleTitle"></span>
      <span class="ub-meta" id="unreadBubbleMeta"></span>
    </span>
  </button>
  <button class="ub-x" type="button" id="unreadBubbleX" aria-label="关闭新通知提醒">×</button>
</div>
<button class="fs-exit" id="fsExit" type="button" hidden>退出全屏 <span>Esc</span></button>
<div class="toast-layer" id="toastWrap" aria-live="polite"></div>
`;
