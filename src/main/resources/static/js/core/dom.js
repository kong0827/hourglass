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
    timelineBox = $("timelineBox"), btnSaveTask = $("btnSaveTask"), btnDeleteTask = $("btnDeleteTask"),
    taskDrawerTitle = $("taskDrawerTitle"), taskFormHint = $("taskFormHint"),
    fTitle = $("fTitle"), fSubtasks = $("fSubtasks"), fAttach = $("fAttach"),
    fWork = $("fWork"), fTimeline = $("fTimeline"),
    segPri = $("segPri"), segCat = $("segCat"), segDue = $("segDue"), segStart = $("segStart"),
    segProg = $("segProg"), segRecur = $("segRecur");
var searchInput = $("searchInput"), searchWrap = $("searchWrap");
var viewTitle = $("viewTitle"), brandSub = $("brandSub");
var chipsOwner = $("chipsOwner"), chipsPri = $("chipsPri");
var filterActions = $("filterActions"), selectedSummary = $("selectedSummary");
var moreFilterMenu = $("moreFilterMenu"), moreFilterCount = $("moreFilterCount");
var viewBox = $("viewBox");
var reqListEl = $("reqList");
var reqExpanded = {};
var branchDot = $("branchDot");
var iRemindTarget = $("iRemindTarget"), iBlocked = $("iBlocked"), iBlockedReason = $("iBlockedReason");
var fComments = $("fComments"), commentList = $("commentList"), commentCount = $("commentCount"),
    iComment = $("iComment"), btnCommentSend = $("btnCommentSend");
var drawerNotice = $("drawerNotice"), drawerNoticeText = $("drawerNoticeText"),
    drawerNoticeReload = $("drawerNoticeReload");
var offlineBadge = $("offlineBadge");
var segWorkScope = $("segWorkScope"), statsHoursEl = $("statsHours"),
    workScopeTag = $("workScopeTag"), hoursNote = $("hoursNote");
var reviewHoursEl = $("reviewHours"), reviewPendingBox = $("reviewPendingBox"),
    pendingList = $("pendingList"), pendingCount = $("pendingCount"),
    progCountEl = $("progCount"), doneCountEl = $("doneCount");
var unplannedBox = $("unplannedBox"), unplannedCount = $("unplannedCount"), unplannedList = $("unplannedList");
var mineBody = $("mineBody"), mineMeta = $("mineMeta"),
    btnMineRefresh = $("btnMineRefresh"), mineDot = $("mineDot"),
    mineSpaceFilter = $("mineSpaceFilter");
var listBulkBar = $("listBulkBar");
var actList = $("actList"), actCount = $("actCount");
var channelCards = $("channelCards"), notifyStatus = $("notifyStatus"),
    notifyStatusText = $("notifyStatusText"), btnNotifySave = $("btnNotifySave"),
    wsWebhookHint = $("wsWebhookHint"), wsWebhookLabel = $("wsWebhookLabel");

export { $, actCount, actList, attachCount, attachList, board, branchDot, brandSub, btnCommentSend, btnDeleteTask, btnMineRefresh, btnNotifySave, btnSaveTask, btnTimer, channelCards, chipsOwner, chipsPri, commentCount, commentList, doneCountEl, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, filterActions, hoursNote, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTitle, listBulkBar, mineBody, mineDot, mineMeta, mineSpaceFilter, moreFilterCount, moreFilterMenu, notifyStatus, notifyStatusText, offlineBadge, pendingCount, pendingList, progCountEl, progVal, reqExpanded, reqListEl, reviewHoursEl, reviewPendingBox, searchInput, searchWrap, segCat, segDue, segPri, segProg, segRecur, segStart, segWorkScope, selectedSummary, statsHoursEl, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, timelineBox, unplannedBox, unplannedCount, unplannedList, viewBox, viewTitle, workScopeTag, workVal, wsWebhookHint, wsWebhookLabel };
