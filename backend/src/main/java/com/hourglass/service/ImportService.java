package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Csv;
import com.hourglass.common.Nos;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.dto.ImportPreview;
import com.hourglass.dto.ImportRequest;
import com.hourglass.dto.ImportResult;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Excel / CSV 迁移导入：模板 → 列映射 → 预检 → 写入 → 失败行回执。
 *
 * <p>四类对象共用同一套口径：表头驱动、单行失败不影响其余行、预览不写库。
 * 写入走现有领域服务（工作项 / 需求池 / 用例 / 工时），权限、编号、通知与审计沿用原逻辑；
 * 这里刻意不加外层事务——单行失败后内层事务已被标记回滚，合并事务会把成功行一起回滚。</p>
 */
@Service
public class ImportService {

    private static final int MAX_ROWS = 1000;
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_CSV_CHARS = 2_000_000;
    private static final int PREVIEW_LIMIT = 50;

    private static final String KIND_TASK = "task";
    private static final String KIND_DEMAND = "demand";
    private static final String KIND_CASE = "case";
    private static final String KIND_WORKLOG = "worklog";
    /** 前端「未映射」哨兵：用户显式放弃该字段，不再按别名自动匹配 */
    private static final String IGNORE = "__ignore__";

    static {
        /* 防御 xlsx zip 炸弹：拒绝异常压缩比、限制单个解压条目大小；POI 自身还有按记录类型的数组上限 */
        ZipSecureFile.setMinInflateRatio(0.01d);
        ZipSecureFile.setMaxEntrySize(MAX_FILE_BYTES * 4L);
    }

    private static final DateTimeFormatter[] DATE_FORMATS = {
            DateTimeFormatter.ISO_LOCAL_DATE,
            DateTimeFormatter.ofPattern("yyyy/M/d"),
            DateTimeFormatter.ofPattern("yyyy.M.d"),
            DateTimeFormatter.ofPattern("M/d/yy"),
            DateTimeFormatter.ofPattern("M/d/yyyy"),
            DateTimeFormatter.ofPattern("yyyy年M月d日")
    };

    private final RequirementService requirementService;
    private final TaskQueryService taskQueryService;
    private final TaskCommandService taskCommandService;
    private final DemandService demandService;
    private final TestCaseService testCaseService;
    private final TimeLogService timeLogService;
    private final BoardColumnMapper boardColumnMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final TaskMapper taskMapper;
    private final ProjectAccessService projectAccess;

    public ImportService(RequirementService requirementService,
                         TaskQueryService taskQueryService,
                         TaskCommandService taskCommandService,
                         DemandService demandService,
                         TestCaseService testCaseService,
                         TimeLogService timeLogService,
                         BoardColumnMapper boardColumnMapper,
                         WorkspaceMemberMapper memberMapper,
                         UserMapper userMapper,
                         TaskMapper taskMapper,
                         ProjectAccessService projectAccess) {
        this.requirementService = requirementService;
        this.taskQueryService = taskQueryService;
        this.taskCommandService = taskCommandService;
        this.demandService = demandService;
        this.testCaseService = testCaseService;
        this.timeLogService = timeLogService;
        this.boardColumnMapper = boardColumnMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.taskMapper = taskMapper;
        this.projectAccess = projectAccess;
    }

    /* ==================== 模板 ==================== */

    public byte[] template(String rawKind) {
        String kind = kindOf(rawKind);
        List<FieldDef> defs = defs(kind);
        List<String> lines = new ArrayList<String>();
        List<String> headers = new ArrayList<String>();
        for (FieldDef d : defs) {
            headers.add(d.label + (d.required ? "*" : ""));
        }
        lines.add(Csv.row(headers.toArray()));
        for (String[] sample : samples(kind)) {
            lines.add(Csv.row((Object[]) sample));
        }
        return Csv.toCsv(lines);
    }

    private static String[][] samples(String kind) {
        if (KIND_TASK.equals(kind)) {
            return new String[][]{
                    {"登录页改版", "示例项目", "任务", "张三", "进行中", "P2", "2026-12-01", "2026-12-10", "8", "替换说明文字", "前端"},
                    {"支付回调超时", "示例项目", "缺陷", "李四", "待处理", "P1", "", "2026-12-05", "4", "复现步骤见工单", "后端"}
            };
        }
        if (KIND_DEMAND.equals(kind)) {
            return new String[][]{
                    {"支持按项目导出周报", "示例项目", "新功能", "P2", "客户成功", "王五", "2026-12-15", "每周一自动生成", "导出内容与页面一致"}
            };
        }
        if (KIND_CASE.equals(kind)) {
            return new String[][]{
                    {"手机号登录成功", "示例项目", "登录", "P1", "已注册账号", "13800000000 / 短信验证码", "1. 输入手机号\n2. 输入验证码\n3. 点击登录", "1. 发送成功\n2. 校验通过\n3. 进入工作台"}
            };
        }
        return new String[][]{
                {"WI-001", "张三", "2026-12-01", "240", "", "联调接口"},
                {"K123456", "", "2026-12-02", "", "480", "补记上周五"}
        };
    }

    /* ==================== 预检 ==================== */

    public ImportPreview preview(String workspaceId, String userId, ImportRequest req) {
        String kind = kindOf(req == null ? null : req.getKind());
        /* 查看者统一拒绝，不逐行报「没有写权限」；只读空间里预检也没有意义 */
        projectAccess.assertWrite(workspaceId, userId, null);
        Table table = readTable(req);
        Mapping mapping = mapColumns(kind, table.headers, req.getMapping());
        ImportPreview out = new ImportPreview();
        out.setKind(kind);
        out.setHeaders(table.headers);
        out.setMapping(mapping.chosen);
        out.setIgnored(mapping.ignored);
        out.setFields(fieldViews(kind));
        out.setErrors(mapping.errors);
        Context ctx = context(workspaceId, userId);
        List<ImportPreview.Row> rows = new ArrayList<ImportPreview.Row>();
        int total = 0;
        int valid = 0;
        int invalid = 0;
        if (mapping.errors.isEmpty()) {
            for (int i = table.headerIndex + 1; i < table.rows.size(); i++) {
                Map<String, String> values = valuesOf(table.rows.get(i), mapping, kind);
                if (isEmptyRow(values)) {
                    continue;
                }
                total++;
                Check check = check(kind, values, ctx, req.getReqId());
                if (check.errors.isEmpty()) {
                    valid++;
                } else {
                    invalid++;
                }
                if (rows.size() < PREVIEW_LIMIT) {
                    ImportPreview.Row row = new ImportPreview.Row();
                    row.setRow(i + 1);
                    row.setOk(check.errors.isEmpty());
                    row.setErrors(check.errors);
                    row.setTitle(check.title);
                    row.setProject(check.project);
                    rows.add(row);
                }
            }
        }
        out.setTotal(total);
        out.setValid(valid);
        out.setInvalid(invalid);
        out.setTruncated(total > rows.size());
        out.setRows(rows);
        return out;
    }

    /* ==================== 写入 ==================== */

    public ImportResult commit(String workspaceId, String userId, ImportRequest req) {
        String kind = kindOf(req == null ? null : req.getKind());
        projectAccess.assertWrite(workspaceId, userId, null);
        Table table = readTable(req);
        Mapping mapping = mapColumns(kind, table.headers, req.getMapping());
        if (!mapping.errors.isEmpty()) {
            throw AppException.badRequest(mapping.errors.get(0));
        }
        Context ctx = context(workspaceId, userId);
        ImportResult out = new ImportResult();
        out.setKind(kind);
        out.setIgnored(mapping.ignored);
        List<ImportResult.Error> errors = new ArrayList<ImportResult.Error>();
        List<List<String>> failedRows = new ArrayList<List<String>>();
        int total = 0;
        int created = 0;
        for (int i = table.headerIndex + 1; i < table.rows.size(); i++) {
            List<String> raw = table.rows.get(i);
            Map<String, String> values = valuesOf(raw, mapping, kind);
            if (isEmptyRow(values)) {
                continue;
            }
            total++;
            Check check = check(kind, values, ctx, req.getReqId());
            if (!check.errors.isEmpty()) {
                errors.add(error(i + 1, String.join("；", check.errors)));
                failedRows.add(raw);
                continue;
            }
            try {
                create(kind, userId, ctx, values, check);
                created++;
            } catch (RuntimeException ex) {
                errors.add(error(i + 1, ex.getMessage() == null ? "写入失败" : ex.getMessage()));
                failedRows.add(raw);
            }
        }
        out.setTotal(total);
        out.setCreated(created);
        out.setFailed(errors.size());
        out.setErrors(errors);
        if (!failedRows.isEmpty()) {
            out.setFailedCsv(failedCsv(table.headers, failedRows, errors));
        }
        return out;
    }

    private static ImportResult.Error error(int row, String message) {
        ImportResult.Error e = new ImportResult.Error();
        e.setRow(row);
        e.setMessage(message);
        return e;
    }

    /* ==================== 校验 ==================== */

    private Check check(String kind, Map<String, String> v, Context ctx, String forcedProject) {
        Check c = new Check();
        c.title = Texts.trimToNull(v.get("title"));
        if (KIND_WORKLOG.equals(kind)) {
            checkWorklog(v, ctx, c);
            return c;
        }
        c.project = resolveProject(ctx, Texts.trimToNull(forcedProject) == null ? v.get("project") : forcedProject, c);
        if (c.title == null) {
            c.errors.add("标题必填");
        }
        if (KIND_TASK.equals(kind)) {
            checkTask(v, ctx, c);
        } else if (KIND_DEMAND.equals(kind)) {
            checkDemand(v, ctx, c);
        } else {
            checkCase(v, ctx, c);
        }
        if (c.projectId != null && !projectAccess.canWrite(ctx.workspaceId, ctx.operatorId, c.projectId)) {
            c.errors.add("没有项目「" + c.project + "」的写权限");
        }
        return c;
    }

    private void checkTask(Map<String, String> v, Context ctx, Check c) {
        if (c.title != null && c.title.length() > 60) {
            c.errors.add("标题最多 60 字");
        }
        c.itemType = itemType(v.get("itemType"), c);
        c.priority = priority(v.get("priority"), c);
        c.columnId = column(ctx, v.get("status"), c);
        c.startDate = date(v.get("startDate"), "开始日期", c);
        c.dueDate = date(v.get("dueDate"), "截止日期", c);
        if (c.startDate != null && c.dueDate != null && c.startDate.isAfter(c.dueDate)) {
            c.errors.add("开始日期不能晚于截止日期");
        }
        c.estimateMinutes = minutesFromHours(v.get("estimateHours"), "预估工时", c);
        c.description = Texts.trimToNull(v.get("description"));
        c.tags = tags(v.get("tags"), c);
        c.owner = member(ctx, v.get("owner"), "负责人", c);
    }

    private void checkDemand(Map<String, String> v, Context ctx, Check c) {
        if (c.title != null && c.title.length() > 80) {
            c.errors.add("标题最多 80 字");
        }
        c.priority = priority(v.get("priority"), c);
        String kindValue = Texts.trimToNull(v.get("itemKind"));
        if (kindValue != null) {
            String mapped = demandKind(kindValue);
            if (mapped == null) {
                c.errors.add("需求类型只能是：新功能 / 体验优化 / 缺陷 / 其他");
            }
            c.itemKind = mapped;
        }
        c.source = Texts.trimToNull(v.get("source"));
        c.expectDate = date(v.get("expectDate"), "期望日期", c);
        c.description = cut(v.get("description"), 2000, "描述", c);
        c.acceptText = cut(v.get("acceptText"), 2000, "验收标准", c);
        c.reviewer = member(ctx, v.get("reviewer"), "评审人", c);
    }

    private void checkCase(Map<String, String> v, Context ctx, Check c) {
        if (c.title != null && c.title.length() > 100) {
            c.errors.add("标题最多 100 字");
        }
        c.priority = priority(v.get("priority"), c);
        c.module = cut(v.get("module"), 50, "分类", c);
        c.precondition = cut(v.get("precondition"), 1000, "前置条件", c);
        c.testData = cut(v.get("testData"), 1000, "测试数据", c);
        c.steps = steps(v.get("steps"), v.get("expected"), c);
    }

    private void checkWorklog(Map<String, String> v, Context ctx, Check c) {
        c.title = Texts.trimToNull(v.get("task"));
        if (c.title == null) {
            c.errors.add("工作项必填（可填任务ID、WI-001 或标题）");
        } else {
            Task task = findTask(ctx, c.title);
            if (task == null) {
                c.errors.add("找不到工作项「" + c.title + "」");
            } else if (task.getDeletedAt() != null) {
                c.errors.add("工作项「" + c.title + "」已删除");
            } else if (!projectAccess.canWrite(ctx.workspaceId, ctx.operatorId, task.getReqId())) {
                c.errors.add("没有工作项所在项目的写权限");
            } else {
                c.taskId = task.getId();
                c.title = task.getTitle();
                c.project = task.getReqId();
                c.projectId = task.getReqId();
            }
        }
        c.memberUserId = memberUserId(ctx, v.get("member"), "成员", c);
        c.date = date(v.get("date"), "日期", c);
        if (c.date != null && c.date.isAfter(LocalDate.now())) {
            c.errors.add("日期不能晚于今天");
        }
        String minutesCell = Texts.trimToNull(v.get("minutes"));
        String hoursCell = Texts.trimToNull(v.get("hours"));
        if (minutesCell != null) {
            c.minutes = intValue(minutesCell, "时长(分钟)", c);
        } else if (hoursCell != null) {
            Double hours = doubleValue(hoursCell, "时长(小时)", c);
            if (hours != null) {
                c.minutes = (int) Math.round(hours * 60);
            }
        } else {
            c.errors.add("时长必填（分钟或小时）");
        }
        if (c.minutes != null && (c.minutes < 1 || c.minutes > 1440)) {
            c.errors.add("单条工时范围 1 分钟 ~ 24 小时");
        }
        c.note = cut(v.get("note"), 200, "备注", c);
    }

    /* ==================== 写入实现 ==================== */

    private void create(String kind, String userId, Context ctx, Map<String, String> v, Check c) {
        if (KIND_TASK.equals(kind)) {
            TaskSaveRequest req = new TaskSaveRequest();
            req.setTitle(c.title);
            req.setReqId(c.projectId);
            req.setItemType(c.itemType);
            req.setPriority(c.priority == null ? "P2" : c.priority);
            req.setBoardColumn(c.columnId == null ? "backlog" : c.columnId);
            req.setStartDate(c.startDate);
            req.setDueDate(c.dueDate);
            req.setEstimateMinutes(c.estimateMinutes);
            req.setDescription(c.description);
            req.setTags(c.tags);
            if (c.owner != null) {
                req.setOwnerUserId(c.owner.getUserId());
                req.setOwner(c.owner.getDisplayName() == null ? c.owner.getUsername() : c.owner.getDisplayName());
            }
            taskCommandService.create(userId, ctx.workspaceId, req);
            return;
        }
        if (KIND_DEMAND.equals(kind)) {
            DemandSaveRequest req = new DemandSaveRequest();
            req.setReqId(c.projectId);
            req.setTitle(c.title);
            req.setItemKind(c.itemKind);
            req.setPriority(c.priority);
            req.setSource(c.source);
            req.setExpectDate(c.expectDate);
            req.setDescription(c.description);
            req.setAcceptText(c.acceptText);
            req.setReviewerUserId(c.reviewer == null ? null : c.reviewer.getUserId());
            demandService.create(userId, ctx.workspaceId, req);
            return;
        }
        if (KIND_CASE.equals(kind)) {
            TestCaseSaveRequest req = new TestCaseSaveRequest();
            req.setReqId(c.projectId);
            req.setTitle(c.title);
            req.setPriority(c.priority);
            req.setModule(c.module);
            req.setPrecondition(c.precondition);
            req.setTestData(c.testData);
            req.setSteps(c.steps);
            testCaseService.create(userId, ctx.workspaceId, req);
            return;
        }
        timeLogService.addManual(userId, ctx.workspaceId, c.taskId,
                c.memberUserId == null ? userId : c.memberUserId, c.date, c.minutes, c.note);
    }

    /* ==================== 文件读取 ==================== */

    private Table readTable(ImportRequest req) {
        if (req == null) {
            throw AppException.badRequest("导入内容为空");
        }
        List<List<String>> rows;
        String fileName = req.getFileName() == null ? "" : req.getFileName().toLowerCase(Locale.ROOT);
        if (Texts.trimToNull(req.getFile()) != null) {
            byte[] bytes;
            try {
                bytes = Base64.getDecoder().decode(req.getFile().trim());
            } catch (IllegalArgumentException e) {
                throw AppException.badRequest("文件内容不是合法的 base64");
            }
            if (bytes.length > MAX_FILE_BYTES) {
                throw AppException.badRequest("文件过大（约 8MB 上限），请拆分文件");
            }
            if (fileName.endsWith(".csv")) {
                rows = Csv.parse(decodeCsv(bytes));
            } else {
                rows = readWorkbook(bytes);
            }
        } else {
            String csv = req.getCsv();
            if (csv == null || csv.trim().isEmpty()) {
                throw AppException.badRequest("导入内容为空");
            }
            if (csv.length() > MAX_CSV_CHARS) {
                throw AppException.badRequest("CSV 内容过大（约 2MB 上限），请拆分文件");
            }
            rows = Csv.parse(csv);
        }
        if (rows.isEmpty()) {
            throw AppException.badRequest("文件里没有可读取的行");
        }
        int headerIndex = findHeaderRow(rows, defs(kindOf(req.getKind())));
        List<String> headers = rows.get(headerIndex);
        List<String> normalized = new ArrayList<String>();
        for (String h : headers) {
            normalized.add(h == null ? "" : h.trim());
        }
        int dataRows = 0;
        for (int i = headerIndex + 1; i < rows.size(); i++) {
            if (!blank(rows.get(i))) {
                dataRows++;
            }
        }
        if (dataRows > MAX_ROWS) {
            throw AppException.badRequest("单次最多导入 " + MAX_ROWS + " 行（当前 " + dataRows + " 行），请拆分文件");
        }
        Table t = new Table();
        t.rows = rows;
        t.headers = normalized;
        t.headerIndex = headerIndex;
        return t;
    }

    /**
     * CSV 解码：优先 UTF-8（含 BOM），严格解码失败时按 GB18030 重解。
     * Excel「另存为 CSV」在中文 Windows 上默认就是 GBK/GB18030，否则中文列名与内容会整片乱码。
     */
    private static String decodeCsv(byte[] bytes) {
        try {
            StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes));
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (java.nio.charset.CharacterCodingException e) {
            return new String(bytes, java.nio.charset.Charset.forName("GB18030"));
        }
    }

    private static List<List<String>> readWorkbook(byte[] bytes) {
        List<List<String>> rows = new ArrayList<List<String>>();
        try (Workbook wb = WorkbookFactory.create(new ByteArrayInputStream(bytes))) {
            Sheet sheet = wb.getNumberOfSheets() == 0 ? null : wb.getSheetAt(0);
            if (sheet == null) {
                return rows;
            }
            DataFormatter fmt = new DataFormatter();
            int nonBlank = 0;
            for (int r = 0; r <= sheet.getLastRowNum(); r++) {
                /* 空白行也会占一条记录：行号被恶意撑到百万级时，不能逐行把空列表都留在内存里 */
                if (rows.size() > MAX_ROWS + 1000) {
                    throw AppException.badRequest("单次最多导入 " + MAX_ROWS + " 行，请拆分文件");
                }
                Row row = sheet.getRow(r);
                if (row == null) {
                    rows.add(Collections.<String>emptyList());
                    continue;
                }
                List<String> cells = new ArrayList<String>();
                for (int c = 0; c < row.getLastCellNum(); c++) {
                    Cell cell = row.getCell(c);
                    cells.add(cell == null ? "" : fmt.formatCellValue(cell).trim());
                }
                rows.add(cells);
                /* 先按非空行掐断，避免超大工作簿把整表复制进内存后才在 readTable 里报超限。
                   表头最多扫前 10 行，额外留 100 行余量给未映射列的前言/分隔行。 */
                if (!blank(cells) && ++nonBlank > MAX_ROWS + 100) {
                    throw AppException.badRequest("单次最多导入 " + MAX_ROWS + " 行，请拆分文件");
                }
            }
        } catch (AppException e) {
            throw e;
        } catch (Exception e) {
            throw AppException.badRequest("无法读取 Excel 文件，请另存为 .xlsx 或 CSV 后重试");
        }
        return rows;
    }

    private static int findHeaderRow(List<List<String>> rows, List<FieldDef> defs) {
        int fallback = 0;
        for (int i = 0; i < rows.size() && i < 10; i++) {
            List<String> row = rows.get(i);
            if (blank(row)) {
                continue;
            }
            int hits = 0;
            for (String cell : row) {
                if (matchField(defs, cell) != null) {
                    hits++;
                }
            }
            if (hits >= 1) {
                return i;
            }
            fallback = i;
        }
        return fallback;
    }

    private static boolean blank(List<String> row) {
        if (row == null) {
            return true;
        }
        for (String cell : row) {
            if (cell != null && !cell.trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    /* ==================== 列映射 ==================== */

    private Mapping mapColumns(String kind, List<String> headers, Map<String, String> requested) {
        Mapping m = new Mapping();
        m.headers = headers;
        List<FieldDef> defs = defs(kind);
        Set<Integer> used = new LinkedHashSet<Integer>();
        for (FieldDef def : defs) {
            String header = requested == null ? null : requested.get(def.key);
            int index = -1;
            if (header == null) {
                index = autoIndex(headers, def, used);
            } else if (!IGNORE.equals(header)) {
                index = indexOf(headers, header);
                if (index < 0) {
                    m.errors.add("映射的列「" + header + "」不在表头里");
                    continue;
                }
            }
            if (index >= 0) {
                m.chosen.put(def.key, headers.get(index));
                used.add(index);
            } else if (def.required) {
                m.errors.add("缺少必填列：" + def.label);
            }
        }
        for (int i = 0; i < headers.size(); i++) {
            if (!used.contains(i) && !headers.get(i).trim().isEmpty()) {
                m.ignored.add(headers.get(i));
            }
        }
        if (KIND_WORKLOG.equals(kind) && !m.chosen.containsKey("minutes") && !m.chosen.containsKey("hours")) {
            m.errors.add("缺少时长列：时长(分钟) 或 时长(小时)");
        }
        return m;
    }

    private static int autoIndex(List<String> headers, FieldDef def, Set<Integer> used) {
        for (int i = 0; i < headers.size(); i++) {
            if (used.contains(i)) {
                continue;
            }
            if (def.matches(headers.get(i))) {
                return i;
            }
        }
        return -1;
    }

    private static int indexOf(List<String> headers, String header) {
        String needle = normalize(header);
        for (int i = 0; i < headers.size(); i++) {
            if (normalize(headers.get(i)).equals(needle)) {
                return i;
            }
        }
        return -1;
    }

    private static FieldDef matchField(List<FieldDef> defs, String header) {
        for (FieldDef def : defs) {
            if (def.matches(header)) {
                return def;
            }
        }
        return null;
    }

    private static Map<String, String> valuesOf(List<String> row, Mapping mapping, String kind) {
        Map<String, String> out = new HashMap<String, String>();
        if (row == null) {
            return out;
        }
        for (Map.Entry<String, String> e : mapping.chosen.entrySet()) {
            int idx = indexOfRaw(mapping.headers, e.getValue());
            String value = idx >= 0 && idx < row.size() ? Texts.trimToNull(row.get(idx)) : null;
            if (value != null) {
                out.put(e.getKey(), value);
            }
        }
        return out;
    }

    /* mapping.headers 保存的是原始表头顺序，需要在 Mapping 里带一份 */
    private static int indexOfRaw(List<String> headers, String header) {
        for (int i = 0; i < headers.size(); i++) {
            if (header.equals(headers.get(i))) {
                return i;
            }
        }
        return -1;
    }

    private static boolean isEmptyRow(Map<String, String> values) {
        for (String v : values.values()) {
            if (v != null && !v.trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private static String failedCsv(List<String> headers, List<List<String>> rows, List<ImportResult.Error> errors) {
        List<String> lines = new ArrayList<String>();
        List<String> head = new ArrayList<String>(headers);
        head.add("错误原因");
        lines.add(Csv.row(head.toArray()));
        for (int i = 0; i < rows.size(); i++) {
            List<String> cells = new ArrayList<String>(rows.get(i));
            while (cells.size() < headers.size()) {
                cells.add("");
            }
            String message = i < errors.size() ? errors.get(i).getMessage() : "";
            cells = new ArrayList<String>(cells.subList(0, headers.size()));
            cells.add(message);
            lines.add(Csv.row(cells.toArray()));
        }
        return new String(Csv.toCsv(lines), StandardCharsets.UTF_8);
    }

    /* ==================== 上下文与解析 ==================== */

    private Context context(String workspaceId, String userId) {
        Context ctx = new Context();
        ctx.workspaceId = workspaceId;
        ctx.operatorId = userId;
        for (ReqProgress p : requirementService.list(workspaceId, userId)) {
            ctx.projects.put(p.getId(), p);
            String key = normalize(p.getName());
            List<ReqProgress> list = ctx.projectsByName.get(key);
            if (list == null) {
                list = new ArrayList<ReqProgress>();
                ctx.projectsByName.put(key, list);
            }
            list.add(p);
        }
        ctx.columns = boardColumnMapper.selectAll(workspaceId);
        ctx.members = memberMapper.selectByWorkspace(workspaceId);
        AppUser me = userMapper.selectById(userId);
        if (me != null) {
            ctx.me = new WorkspaceMember();
            ctx.me.setUserId(me.getId());
            ctx.me.setDisplayName(me.getDisplayName());
            ctx.me.setUsername(me.getUsername());
        }
        return ctx;
    }

    private static String resolveProject(Context ctx, String ref, Check c) {
        String value = Texts.trimToNull(ref);
        if (value == null) {
            c.errors.add("项目必填");
            return null;
        }
        ReqProgress byId = ctx.projects.get(value);
        if (byId != null) {
            c.projectId = byId.getId();
            return byId.getName();
        }
        List<ReqProgress> byName = ctx.projectsByName.get(normalize(value));
        if (byName == null || byName.isEmpty()) {
            c.errors.add("找不到项目「" + value + "」");
            return null;
        }
        if (byName.size() > 1) {
            c.errors.add("项目名「" + value + "」不唯一，请改填项目ID");
            return null;
        }
        c.projectId = byName.get(0).getId();
        return byName.get(0).getName();
    }

    private static WorkspaceMember member(Context ctx, String ref, String label, Check c) {
        WorkspaceMember m = memberOrNull(ctx, ref, label, c);
        return m;
    }

    private static String memberUserId(Context ctx, String ref, String label, Check c) {
        WorkspaceMember m = memberOrNull(ctx, ref, label, c);
        return m == null ? ctx.operatorId : m.getUserId();
    }

    private static WorkspaceMember memberOrNull(Context ctx, String ref, String label, Check c) {
        String value = Texts.trimToNull(ref);
        if (value == null) {
            return null;
        }
        List<WorkspaceMember> matched = new ArrayList<WorkspaceMember>();
        for (WorkspaceMember m : ctx.members) {
            if (value.equals(m.getUserId())
                    || value.equals(m.getDisplayName())
                    || value.equals(m.getUsername())) {
                matched.add(m);
            }
        }
        if (matched.isEmpty()) {
            if (ctx.me != null && ("我".equals(value) || "自己".equals(value)
                    || value.equals(ctx.me.getUserId()) || value.equals(ctx.me.getDisplayName()))) {
                return ctx.me;
            }
            c.errors.add(label + "「" + value + "」不是空间成员");
            return null;
        }
        if (matched.size() > 1) {
            c.errors.add(label + "「" + value + "」重名，请改填账号ID");
            return null;
        }
        return matched.get(0);
    }

    private static String column(Context ctx, String ref, Check c) {
        String value = Texts.trimToNull(ref);
        if (value == null) {
            return null;
        }
        for (BoardColumn col : ctx.columns) {
            if (value.equals(col.getId()) || value.equals(col.getName())) {
                return col.getId();
            }
        }
        c.errors.add("状态/列「" + value + "」不存在");
        return null;
    }

    private Task findTask(Context ctx, String ref) {
        Task byId = taskMapper.selectById(ref);
        if (byId != null && ctx.workspaceId.equals(byId.getWorkspaceId())) {
            return byId;
        }
        Integer no = Nos.parseWorkItem(ref);
        BoardQueryHolder holder = new BoardQueryHolder(ref);
        TaskListResponse page = taskQueryService.list(ctx.workspaceId, ctx.operatorId, holder.query, "updated", 0, 20);
        for (Task t : page.getItems()) {
            if (ref.equals(t.getId()) || ref.equals(t.getTitle())) {
                return t;
            }
            if (no != null && no.equals(t.getItemNo())) {
                return t;
            }
        }
        return null;
    }

    private static String itemType(String value, Check c) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        if ("任务".equals(v) || "task".equalsIgnoreCase(v)) return "task";
        if ("需求".equals(v) || "故事".equals(v) || "story".equalsIgnoreCase(v)) return "story";
        if ("缺陷".equals(v) || "bug".equalsIgnoreCase(v)) return "bug";
        if ("史诗".equals(v) || "epic".equalsIgnoreCase(v)) return "epic";
        c.errors.add("类型只能是：任务 / 需求 / 缺陷 / 史诗");
        return null;
    }

    private static String priority(String value, Check c) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        v = v.toUpperCase(Locale.ROOT);
        if ("P0".equals(v) || "P1".equals(v) || "P2".equals(v) || "P3".equals(v)) {
            return v;
        }
        c.errors.add("优先级只能是 P0 / P1 / P2 / P3");
        return null;
    }

    private static String demandKind(String value) {
        if ("新功能".equals(value)) return "新功能";
        if ("体验优化".equals(value)) return "体验优化";
        if ("缺陷".equals(value)) return "缺陷";
        if ("其他".equals(value)) return "其他";
        return null;
    }

    private static LocalDate date(String value, String label, Check c) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        for (DateTimeFormatter fmt : DATE_FORMATS) {
            try {
                return LocalDate.parse(v, fmt);
            } catch (Exception ignored) {
                /* try next */
            }
        }
        c.errors.add(label + "格式应为 yyyy-MM-dd");
        return null;
    }

    private static Integer minutesFromHours(String value, String label, Check c) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        Double hours = doubleValue(v, label, c);
        if (hours == null) {
            return null;
        }
        if (hours < 0 || hours > 168) {
            c.errors.add(label + "需在 0 ~ 168 小时之间");
            return null;
        }
        return hours == 0 ? null : (int) Math.round(hours * 60);
    }

    private static Integer intValue(String value, String label, Check c) {
        try {
            return (int) Math.round(Double.parseDouble(value.trim()));
        } catch (NumberFormatException e) {
            c.errors.add(label + "应为数字");
            return null;
        }
    }

    private static Double doubleValue(String value, String label, Check c) {
        try {
            return Double.parseDouble(value.trim());
        } catch (NumberFormatException e) {
            c.errors.add(label + "应为数字");
            return null;
        }
    }

    private static String cut(String value, int max, String label, Check c) {
        String v = Texts.trimToNull(value);
        if (v != null && v.length() > max) {
            c.errors.add(label + "最多 " + max + " 字");
            return null;
        }
        return v;
    }

    private static List<String> tags(String value, Check c) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        List<String> out = new ArrayList<String>();
        for (String part : v.split("[,，、;；\\s]+")) {
            String tag = Texts.trimToNull(part);
            if (tag == null || out.contains(tag)) {
                continue;
            }
            if (tag.length() > 16) {
                c.errors.add("标签「" + tag + "」最多 16 字");
                return null;
            }
            out.add(tag);
        }
        if (out.size() > 8) {
            c.errors.add("标签最多 8 个");
            return null;
        }
        return out.isEmpty() ? null : out;
    }

    private static List<TestCaseSaveRequest.StepItem> steps(String stepsCell, String expectedCell, Check c) {
        List<String> actions = lines(stepsCell);
        List<String> expected = lines(expectedCell);
        if (actions.isEmpty() && expected.isEmpty()) {
            return null;
        }
        if (actions.size() > 30) {
            c.errors.add("步骤最多 30 条");
            return null;
        }
        List<TestCaseSaveRequest.StepItem> out = new ArrayList<TestCaseSaveRequest.StepItem>();
        for (int i = 0; i < actions.size(); i++) {
            String action = stripNo(actions.get(i));
            String exp = i < expected.size() ? stripNo(expected.get(i)) : null;
            int arrow = action.indexOf("=>");
            if (arrow >= 0) {
                if (exp == null) {
                    exp = Texts.trimToNull(action.substring(arrow + 2));
                }
                action = Texts.trimToNull(action.substring(0, arrow));
            }
            if (action == null) {
                continue;
            }
            if (action.length() > 200) {
                c.errors.add("第 " + (i + 1) + " 步操作最多 200 字");
                return null;
            }
            if (exp != null && exp.length() > 500) {
                c.errors.add("第 " + (i + 1) + " 步预期结果最多 500 字");
                return null;
            }
            TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
            item.setAction(action);
            item.setExpected(exp);
            out.add(item);
        }
        return out.isEmpty() ? null : out;
    }

    private static List<String> lines(String value) {
        List<String> out = new ArrayList<String>();
        String v = Texts.trimToNull(value);
        if (v == null) {
            return out;
        }
        for (String line : v.split("\\r?\\n")) {
            String t = Texts.trimToNull(line);
            if (t != null) {
                out.add(t);
            }
        }
        return out;
    }

    private static String stripNo(String value) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        return Texts.trimToNull(v.replaceFirst("^\\s*\\d+[.、)．]\\s*", ""));
    }

    /* ==================== 字段定义 ==================== */

    private static List<FieldDef> defs(String kind) {
        List<FieldDef> list = new ArrayList<FieldDef>();
        if (KIND_TASK.equals(kind)) {
            list.add(new FieldDef("title", "标题", true, "标题", "工作项标题", "任务标题", "名称", "title"));
            list.add(new FieldDef("project", "项目", true, "项目", "所属项目", "project"));
            list.add(new FieldDef("itemType", "类型", false, "类型", "工作项类型", "type"));
            list.add(new FieldDef("owner", "负责人", false, "负责人", "处理人", "指派给", "owner"));
            list.add(new FieldDef("status", "状态", false, "状态", "所在列", "看板列", "status"));
            list.add(new FieldDef("priority", "优先级", false, "优先级", "priority"));
            list.add(new FieldDef("startDate", "开始日期", false, "开始日期", "开始", "start date", "start"));
            list.add(new FieldDef("dueDate", "截止日期", false, "截止日期", "结束日期", "截止", "due date", "due"));
            list.add(new FieldDef("estimateHours", "预估工时(小时)", false, "预估工时", "预估(小时)", "预估耗时", "estimate"));
            list.add(new FieldDef("description", "描述", false, "描述", "说明", "详情", "description"));
            list.add(new FieldDef("tags", "标签", false, "标签", "tags"));
            return list;
        }
        if (KIND_DEMAND.equals(kind)) {
            list.add(new FieldDef("title", "标题", true, "标题", "需求标题", "名称", "title"));
            list.add(new FieldDef("project", "项目", true, "项目", "所属项目", "project"));
            list.add(new FieldDef("itemKind", "类型", false, "类型", "需求类型", "kind"));
            list.add(new FieldDef("priority", "优先级", false, "优先级", "priority"));
            list.add(new FieldDef("source", "来源", false, "来源", "提出人", "source"));
            list.add(new FieldDef("reviewer", "评审人", false, "评审人", "负责人", "reviewer"));
            list.add(new FieldDef("expectDate", "期望日期", false, "期望日期", "期望交付", "期望交付日期", "expect date"));
            list.add(new FieldDef("description", "描述", false, "描述", "说明", "description"));
            list.add(new FieldDef("acceptText", "验收标准", false, "验收标准", "验收", "accept"));
            return list;
        }
        if (KIND_CASE.equals(kind)) {
            list.add(new FieldDef("title", "标题", true, "标题", "用例标题", "用例名称", "title"));
            list.add(new FieldDef("project", "项目", true, "项目", "所属项目", "project"));
            list.add(new FieldDef("module", "分类", false, "分类", "模块", "module"));
            list.add(new FieldDef("priority", "优先级", false, "优先级", "priority"));
            list.add(new FieldDef("precondition", "前置条件", false, "前置条件", "precondition"));
            list.add(new FieldDef("testData", "测试数据", false, "测试数据", "data", "test data"));
            list.add(new FieldDef("steps", "测试步骤", false, "测试步骤", "步骤", "操作步骤", "steps"));
            list.add(new FieldDef("expected", "预期结果", false, "预期结果", "期望结果", "预期", "expected"));
            return list;
        }
        list.add(new FieldDef("task", "工作项", true, "工作项", "任务", "工作项编号", "任务编号", "task"));
        list.add(new FieldDef("member", "成员", false, "成员", "工时归属", "人员", "member"));
        list.add(new FieldDef("date", "日期", true, "日期", "补记日期", "date"));
        list.add(new FieldDef("minutes", "时长(分钟)", false, "时长(分钟)", "分钟", "工时(分钟)", "minutes"));
        list.add(new FieldDef("hours", "时长(小时)", false, "时长(小时)", "小时", "工时(小时)", "hours"));
        list.add(new FieldDef("note", "备注", false, "备注", "说明", "note"));
        return list;
    }

    private static List<ImportPreview.Field> fieldViews(String kind) {
        List<ImportPreview.Field> out = new ArrayList<ImportPreview.Field>();
        for (FieldDef def : defs(kind)) {
            ImportPreview.Field f = new ImportPreview.Field();
            f.setKey(def.key);
            f.setLabel(def.label);
            f.setRequired(def.required);
            out.add(f);
        }
        return out;
    }

    private static String kindOf(String raw) {
        String v = Texts.trimToNull(raw);
        if (v == null || KIND_TASK.equals(v)) return KIND_TASK;
        if (KIND_DEMAND.equals(v)) return KIND_DEMAND;
        if (KIND_CASE.equals(v)) return KIND_CASE;
        if (KIND_WORKLOG.equals(v)) return KIND_WORKLOG;
        throw AppException.badRequest("不支持的导入类型：" + v);
    }

    private static String normalize(String value) {
        if (value == null) {
            return "";
        }
        String v = value.toLowerCase(Locale.ROOT).replace(" ", "").replace("　", "")
                .replace("（", "(").replace("）", ")").replace("*", "");
        if (v.endsWith("(必填)")) {
            v = v.substring(0, v.length() - 4);
        }
        return v;
    }

    private static final class FieldDef {
        final String key;
        final String label;
        final boolean required;
        final String[] aliases;

        FieldDef(String key, String label, boolean required, String... aliases) {
            this.key = key;
            this.label = label;
            this.required = required;
            this.aliases = aliases;
        }

        boolean matches(String header) {
            String h = normalize(header);
            if (h.isEmpty()) {
                return false;
            }
            for (String alias : aliases) {
                if (h.equals(normalize(alias))) {
                    return true;
                }
            }
            return false;
        }
    }

    private static final class Table {
        List<List<String>> rows;
        List<String> headers;
        int headerIndex;
    }

    private final class Mapping {
        final Map<String, String> chosen = new LinkedHashMap<String, String>();
        final List<String> errors = new ArrayList<String>();
        final List<String> ignored = new ArrayList<String>();
        List<String> headers = new ArrayList<String>();
    }

    private static final class Context {
        String workspaceId;
        String operatorId;
        WorkspaceMember me;
        final Map<String, ReqProgress> projects = new HashMap<String, ReqProgress>();
        final Map<String, List<ReqProgress>> projectsByName = new HashMap<String, List<ReqProgress>>();
        List<BoardColumn> columns = new ArrayList<BoardColumn>();
        List<WorkspaceMember> members = new ArrayList<WorkspaceMember>();
    }

    private static final class Check {
        final List<String> errors = new ArrayList<String>();
        String title;
        String project;
        String projectId;
        String itemType;
        String itemKind;
        String priority;
        String columnId;
        String description;
        String acceptText;
        String source;
        String module;
        String precondition;
        String testData;
        String note;
        List<String> tags;
        List<TestCaseSaveRequest.StepItem> steps;
        LocalDate startDate;
        LocalDate dueDate;
        LocalDate expectDate;
        LocalDate date;
        Integer estimateMinutes;
        Integer minutes;
        WorkspaceMember owner;
        WorkspaceMember reviewer;
        String memberUserId;
        String taskId;
    }

    /** 只为按编号/标题兜底检索工作项，避免在导入服务里再拼一套查询条件 */
    private static final class BoardQueryHolder {
        final com.hourglass.dto.BoardQuery query = new com.hourglass.dto.BoardQuery();

        BoardQueryHolder(String keyword) {
            query.setQ(keyword);
        }
    }
}
