/* core/dom · 共享 DOM 引用（模块脚本在 DOM 解析后执行） */

function $(id){ return document.getElementById(id); }
var board = $("board");
var taskDrawer = $("taskDrawer");
var taskForm = $("taskForm");
var iTitle = $("iTitle"), iDesc = $("iDesc"), iStart = $("iStart"), iDue = $("iDue"), iCol = $("iCol"),
    iEstimate = $("iEstimate"), iTestEstimate = $("iTestEstimate"), iActual = $("iActual"),
    iReq = $("iReq"), iProg = $("iProg"), progVal = $("progVal"), iNote = $("iNote"),
    iRemind = $("iRemind"), iOwner = $("iOwner"), iTags = $("iTags"), iBranch = $("iBranch"),
    tagWrap = $("tagWrap"), subList = $("subList"), subCount = $("subCount"),
    iSubNew = $("iSubNew"), attachList = $("attachList"), attachCount = $("attachCount"),
    iAttachFile = $("iAttachFile"), workVal = $("workVal"), btnTimer = $("btnTimer"),
    btnTimerAdd = $("btnTimerAdd"), btnActualAdd = $("btnActualAdd"), rfHoursAdd = $("rfHoursAdd"), workLogList = $("workLogList"),
    timelineBox = $("timelineBox"), btnSaveTask = $("btnSaveTask"), btnSaveTaskContinue = $("btnSaveTaskContinue"), btnDeleteTask = $("btnDeleteTask"),
    taskDrawerTitle = $("taskDrawerTitle"), taskFormHint = $("taskFormHint"),
    btnTaskWatch = $("btnTaskWatch"), taskWatchLabel = $("taskWatchLabel"),
    btnTaskNew = $("btnTaskNew"),
    fTitle = $("fTitle"), fSubtasks = $("fSubtasks"), fAttach = $("fAttach"),
    fWork = $("fWork"), fTimeline = $("fTimeline"),
    segPri = $("segPri"), segCat = $("segCat"), segDue = $("segDue"), segStart = $("segStart"),
    segProg = $("segProg"), segRecur = $("segRecur");
var searchInput = $("searchInput"), searchWrap = $("searchWrap");
var viewTitle = $("viewTitle"), brandSub = $("brandSub");
var chipsOwner = $("chipsOwner"), chipsPri = $("chipsPri"), chipsType = $("chipsType"), chipsVersion = $("chipsVersion"),
    chipsReqs = $("chipsReqs"), chipsCats = $("chipsCats"), chipsTags = $("chipsTags"), chipsDate = $("chipsDate");
var filterActions = $("filterActions"), selectedSummary = $("selectedSummary");
var moreFilterMenu = $("moreFilterMenu"), moreFilterCount = $("moreFilterCount");
var dimMenu = $("fbDimMenu"), dimGroup = $("fgDims");
var viewBox = $("viewsMenu");
var reqListEl = $("reqList");
var reqExpanded = {};
var iRemindTarget = $("iRemindTarget"), iBlocked = $("iBlocked"), iBlockedReason = $("iBlockedReason");
var fComments = $("fComments"), commentList = $("commentList"), commentCount = $("commentCount"),
    iComment = $("iComment"), btnCommentSend = $("btnCommentSend"),
    btnCommentAttach = $("btnCommentAttach"), iCommentFiles = $("iCommentFiles"),
    commentAttachChips = $("commentAttachChips"), commentAttachTip = $("commentAttachTip");
var drawerNotice = $("drawerNotice"), drawerNoticeText = $("drawerNoticeText"),
    drawerNoticeReload = $("drawerNoticeReload");
var offlineBadge = $("offlineBadge");
var segWorkScope = $("segWorkScope"), statsHoursEl = $("statsHours"),
    workScopeTag = $("workScopeTag"), hoursNote = $("hoursNote");
var reviewHoursEl = $("reviewHours"), reviewPendingBox = $("reviewPendingBox"),
    pendingList = $("pendingList"), pendingCount = $("pendingCount"),
    progCountEl = $("progCount"), doneCountEl = $("doneCount");
var unplannedBox = $("unplannedBox"), unplannedCount = $("unplannedCount"), unplannedList = $("unplannedList");
var mineTabs = $("mineTabs"), mineCatchup = $("mineCatchup"), mineBrief = $("mineBrief"), mineToolbar = $("mineToolbar"),
    mineChips = $("mineChips"), mineSearch = $("mineSearch"),
    mineFilterPop = $("mineFilterPop"), mineFilterMenu = $("mineFilterMenu"), mineFilterCount = $("mineFilterCount"),
    mineDisplayPop = $("mineDisplayPop"), mineDisplayMenu = $("mineDisplayMenu"),
    mineBody = $("mineBody"), mineNote = $("mineNote"), btnMineRefresh = $("btnMineRefresh");
var listBulkBar = $("listBulkBar");
var actList = $("actList"), actCount = $("actCount"), actTypes = $("actTypes"), actExportBtn = $("actExportBtn"), actExportMenu = $("actExportMenu"), actFilterBtn = $("actFilterBtn"), actFilterPop = $("actFilterPop"), actFilterBadge = $("actFilterBadge");
var dlgTimeAdd = $("dlgTimeAdd"), iTimeUser = $("iTimeUser"), iTimeDate = $("iTimeDate"),
    iTimeHours = $("iTimeHours"), iTimeNote = $("iTimeNote"), iTimeProject = $("iTimeProject"),
    dlgTimeAddCancel = $("dlgTimeAddCancel"), dlgTimeAddOk = $("dlgTimeAddOk");
var channelCards = $("channelCards"), notifyStatus = $("notifyStatus"),
    notifyStatusText = $("notifyStatusText"), btnNotifySave = $("btnNotifySave"),
    wsWebhookHint = $("wsWebhookHint"), wsWebhookLabel = $("wsWebhookLabel");

export { $, actCount, actExportBtn, actExportMenu, actFilterBadge, actFilterBtn, actFilterPop, actList, actTypes, attachCount, attachList, board, brandSub, btnActualAdd, btnCommentAttach, btnCommentSend, btnDeleteTask, btnMineRefresh, btnNotifySave, btnSaveTask, btnSaveTaskContinue, btnTaskNew, btnTaskWatch, btnTimer, btnTimerAdd, rfHoursAdd, channelCards, chipsCats, chipsDate, chipsOwner, chipsPri, chipsReqs, chipsTags, chipsType, chipsVersion, commentAttachChips, commentAttachTip, commentCount, commentList, dlgTimeAdd, dlgTimeAddCancel, dlgTimeAddOk, dimGroup, dimMenu, doneCountEl, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, filterActions, hoursNote, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iCommentFiles, iDesc, iDue, iEstimate, iTestEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTimeDate, iTimeHours, iTimeNote, iTimeProject, iTimeUser, iTitle, listBulkBar, mineBody, mineBrief, mineCatchup, mineChips, mineDisplayMenu, mineDisplayPop, mineFilterCount, mineFilterMenu, mineFilterPop, mineNote, mineSearch, mineTabs, mineToolbar, moreFilterCount, moreFilterMenu, notifyStatus, notifyStatusText, offlineBadge, pendingCount, pendingList, progCountEl, progVal, reqExpanded, reqListEl, reviewHoursEl, reviewPendingBox, searchInput, searchWrap, segCat, segDue, segPri, segProg, segRecur, segStart, segWorkScope, selectedSummary, statsHoursEl, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, taskWatchLabel, timelineBox, unplannedBox, unplannedCount, unplannedList, viewBox, viewTitle, workLogList, workScopeTag, workVal, wsWebhookHint, wsWebhookLabel };
