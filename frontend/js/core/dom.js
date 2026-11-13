/* core/dom · 共享 DOM 引用（模块脚本在 DOM 解析后执行） */

function $(id){ return document.getElementById(id); }
var board = $("board");
var taskDrawer = $("taskDrawer");
var taskForm = $("taskForm");
var iTitle = $("iTitle"), iDesc = $("iDesc"), iStart = $("iStart"), iDue = $("iDue"), iCol = $("iCol"),
    iEstimate = $("iEstimate"), iActual = $("iActual"),
    iReq = $("iReq"), iProg = $("iProg"), progVal = $("progVal"), iNote = $("iNote"),
    iRemind = $("iRemind"), iOwner = $("iOwner"), iTags = $("iTags"), iBranch = $("iBranch"),
    tagWrap = $("tagWrap"), subList = $("subList"), subCount = $("subCount"),
    iSubNew = $("iSubNew"), attachList = $("attachList"), attachCount = $("attachCount"),
    iAttachFile = $("iAttachFile"), workVal = $("workVal"), btnTimer = $("btnTimer"),
    btnTimerAdd = $("btnTimerAdd"), btnActualAdd = $("btnActualAdd"), workLogList = $("workLogList"),
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
var viewBox = $("viewBox");
var reqListEl = $("reqList");
var reqExpanded = {};
var iRemindTarget = $("iRemindTarget"), iBlocked = $("iBlocked"), iBlockedReason = $("iBlockedReason");
var fComments = $("fComments"), commentList = $("commentList"), commentCount = $("commentCount"),
    iComment = $("iComment"), btnCommentSend = $("btnCommentSend"), commentMention = $("commentMention"),
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
var mineBody = $("mineBody"), mineMeta = $("mineMeta"), mineStats = $("mineStats"),
    btnMineRefresh = $("btnMineRefresh"), btnMineFields = $("btnMineFields"), btnMineFold = $("btnMineFold"),
    mineSpaceFilter = $("mineSpaceFilter"),
    mineGroup = $("mineGroup"), mineSubgroup = $("mineSubgroup"), mineSort = $("mineSort");
var listBulkBar = $("listBulkBar");
var actList = $("actList"), actCount = $("actCount");
var dlgTimeAdd = $("dlgTimeAdd"), iTimeUser = $("iTimeUser"), iTimeDate = $("iTimeDate"),
    iTimeHours = $("iTimeHours"), iTimeNote = $("iTimeNote"),
    dlgTimeAddCancel = $("dlgTimeAddCancel"), dlgTimeAddOk = $("dlgTimeAddOk");
var channelCards = $("channelCards"), notifyStatus = $("notifyStatus"),
    notifyStatusText = $("notifyStatusText"), btnNotifySave = $("btnNotifySave"),
    wsWebhookHint = $("wsWebhookHint"), wsWebhookLabel = $("wsWebhookLabel");

export { $, actCount, actList, attachCount, attachList, board, brandSub, btnActualAdd, btnCommentAttach, btnCommentSend, btnDeleteTask, btnMineFields, btnMineFold, btnMineRefresh, btnNotifySave, btnSaveTask, btnSaveTaskContinue, btnTaskNew, btnTaskWatch, btnTimer, btnTimerAdd, channelCards, chipsCats, chipsDate, chipsOwner, chipsPri, chipsReqs, chipsTags, chipsType, chipsVersion, commentAttachChips, commentAttachTip, commentCount, commentList, commentMention, dlgTimeAdd, dlgTimeAddCancel, dlgTimeAddOk, dimGroup, dimMenu, doneCountEl, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, filterActions, hoursNote, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iCommentFiles, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTimeDate, iTimeHours, iTimeNote, iTimeUser, iTitle, listBulkBar, mineBody, mineGroup, mineMeta, mineSort, mineSpaceFilter, mineStats, mineSubgroup, moreFilterCount, moreFilterMenu, notifyStatus, notifyStatusText, offlineBadge, pendingCount, pendingList, progCountEl, progVal, reqExpanded, reqListEl, reviewHoursEl, reviewPendingBox, searchInput, searchWrap, segCat, segDue, segPri, segProg, segRecur, segStart, segWorkScope, selectedSummary, statsHoursEl, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, taskWatchLabel, timelineBox, unplannedBox, unplannedCount, unplannedList, viewBox, viewTitle, workLogList, workScopeTag, workVal, wsWebhookHint, wsWebhookLabel };
