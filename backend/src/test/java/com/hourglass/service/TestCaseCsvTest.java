package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Csv;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.TestCase;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A3：用例 CSV 导入导出（存量测试资产迁移入口） */
class TestCaseCsvTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String REQ = "R1";

    private final TestCaseMapper cases = mock(TestCaseMapper.class);
    private final com.hourglass.mapper.RequirementMapper reqs =
            mock(com.hourglass.mapper.RequirementMapper.class);
    private final AuditService auditService = mock(AuditService.class);
    private final com.hourglass.mapper.TestModuleMapper modules = mock(com.hourglass.mapper.TestModuleMapper.class);
    private final TestCaseService service = new TestCaseService(cases,
            mock(TestCaseRunMapper.class), mock(TaskCommandService.class),
            mock(ProjectAccessService.class), reqs,
            mock(com.hourglass.mapper.DemandMapper.class),
            modules,
            mock(com.hourglass.mapper.AttachmentMapper.class),
            mock(AttachmentService.class),
            mock(com.hourglass.mapper.TestPlanMapper.class),
            mock(com.hourglass.mapper.TestPlanCaseMapper.class),
            auditService, mock(NumberSeqService.class),
            mock(com.hourglass.mapper.TestCaseTaskMapper.class),
            mock(com.hourglass.mapper.TaskMapper.class),
            mock(com.hourglass.mapper.WorkspaceMemberMapper.class),
            new TestModuleService(new CategoryService(
                    mock(com.hourglass.mapper.CategoryMapper.class),
                    mock(com.hourglass.mapper.RequirementMapper.class),
                    mock(ActivityService.class), mock(DeletionTraceService.class),
                    mock(ProjectAccessService.class), mock(ReleasePermissionService.class),
                    mock(WorkspaceMetaCache.class),
                    mock(com.hourglass.mapper.TestCaseMapper.class),
                    mock(com.hourglass.mapper.CaseSetMapper.class)), auditService),
            mock(com.hourglass.mapper.CaseSetMapper.class), mock(DemandCompletionService.class));

    @BeforeEach
    void setUp() {
        Requirement r = new Requirement();
        r.setId(REQ);
        r.setWorkspaceId(WS);
        r.setName("演示项目");
        when(reqs.selectById(REQ)).thenReturn(r);
        LoginUser user = new LoginUser(USER, "u1", "x", "测试同学", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void importCountsCreatedFailedAndSkipped() {
        String text = "\uFEFF标题,模块,优先级,前置条件,步骤（每行：操作 => 预期）\r\n"
                + "登录成功,账号体系,P0,已注册账号,\"打开登录页 => 出现输入框\n输入密码提交 => 进入首页\"\r\n"
                + "坏优先级,,P9,,\r\n"
                + "\r\n"
                + ",,,,\r\n"
                + "只有标题,,,,\r\n";
        Map<String, Object> out = service.importCsv(USER, WS, REQ, text);
        assertEquals(4, out.get("total"));
        assertEquals(2, out.get("created"));
        assertEquals(1, out.get("failed"));
        assertEquals(1, out.get("skipped"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> errors = (List<Map<String, Object>>) out.get("errors");
        assertEquals(1, errors.size());
        assertEquals(3, errors.get(0).get("row"), "错误行号按原文行计（含表头）");
        assertTrue(String.valueOf(errors.get(0).get("message")).contains("P0/P1/P2/P3"));
        verify(cases, times(2)).insert(any(TestCase.class));
        verify(auditService).recordCurrent(eq(WS), eq("test_case_import"), eq("project"), eq(REQ),
                isNull(), eq(true), contains("成功 2 条，失败 1 条，跳过 1 条"), isNull());
    }

    @Test
    void importWithNoSuccessfulRowAuditsFailure() {
        String text = "标题,模块,优先级,前置条件,步骤\r\n"
                + "坏优先级,,P9,,\r\n";
        Map<String, Object> out = service.importCsv(USER, WS, REQ, text);
        assertEquals(0, out.get("created"));
        assertEquals(1, out.get("failed"));
        verify(cases, never()).insert(any(TestCase.class));
        verify(auditService).recordCurrent(eq(WS), eq("test_case_import"), eq("project"), eq(REQ),
                isNull(), eq(false), contains("成功 0 条，失败 1 条，跳过 0 条"), isNull());
    }

    @Test
    void importRejectsOverRowLimit() {
        StringBuilder sb = new StringBuilder("标题,模块,优先级,前置条件,步骤\r\n");
        for (int i = 0; i <= 1000; i++) {
            sb.append("用例").append(i).append(",,P1,,\r\n");
        }
        AppException ex = assertThrows(AppException.class,
                () -> service.importCsv(USER, WS, REQ, sb.toString()));
        assertTrue(ex.getMessage().contains("1000"));
        verify(cases, never()).insert(any(TestCase.class));
    }

    @Test
    void exportRoundTripsQuotedSteps() {
        TestCaseView v = new TestCaseView();
        v.setCaseNo(1);
        v.setTitle("登录,成功");
        v.setModule("账号\"核心\"");
        v.setPriority("P0");
        v.setPrecondition("已注册");
        v.setTestData("账号：demo / 密码：123456");
        v.setStepsJson("[{\"action\":\"打开,登录页\",\"expected\":\"出现 \\\"输入框\\\"\"},{\"action\":\"输入密码\",\"expected\":\"\"}]");
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        rows.add(v);
        when(cases.selectViewByReq(WS, REQ)).thenReturn(rows);

        byte[] out = service.exportCsv(WS, USER, REQ);
        String text = new String(out, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("\uFEFF"));
        List<List<String>> parsed = Csv.parse(text);
        assertEquals(2, parsed.size());
        assertEquals("TC-001", parsed.get(1).get(0));
        assertEquals("登录,成功", parsed.get(1).get(1));
        assertEquals("账号\"核心\"", parsed.get(1).get(2));
        assertEquals("账号：demo / 密码：123456", parsed.get(1).get(5));
        assertEquals("打开,登录页 => 出现 \"输入框\"\n输入密码", parsed.get(1).get(6));
    }

    @Test
    void templateHasHeaderAndExample() {
        List<List<String>> rows = Csv.parse(new String(service.templateCsv(), StandardCharsets.UTF_8));
        assertEquals(2, rows.size());
        assertEquals("用例编号", rows.get(0).get(0));
        assertTrue(rows.get(1).get(6).contains("=>"));
    }

    /* ---------- Excel（.xlsx） ---------- */

    @Test
    void xlsxExportHasStyledHeaderAndExecutionColumns() throws Exception {
        TestCaseView v = new TestCaseView();
        v.setCaseNo(7);
        v.setTitle("登录成功跳转首页");
        v.setModule("账号体系");
        v.setPriority("P0");
        v.setPrecondition("已注册");
        v.setTestData("demo/123456");
        v.setStepsJson("[{\"action\":\"打开登录页\",\"expected\":\"出现输入框\"},{\"action\":\"提交\",\"expected\":\"进入首页\"}]");
        v.setLatestStatus("failed");
        v.setLatestBy("测试同学");
        v.setLatestAt(java.time.LocalDateTime.of(2026, 11, 15, 9, 5));
        v.setLatestNote("首页跳转慢");
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        rows.add(v);
        when(cases.selectViewByReq(WS, REQ)).thenReturn(rows);

        org.apache.poi.ss.usermodel.Workbook book = new org.apache.poi.xssf.usermodel.XSSFWorkbook(
                new java.io.ByteArrayInputStream(service.exportXlsx(WS, USER, REQ)));
        org.apache.poi.ss.usermodel.Sheet sheet = book.getSheetAt(0);
        assertEquals("测试用例-演示项目", sheet.getSheetName());
        assertEquals("用例编号", sheet.getRow(0).getCell(0).getStringCellValue());
        assertEquals("最近备注", sheet.getRow(0).getCell(11).getStringCellValue());
        assertEquals("TC-007", sheet.getRow(1).getCell(0).getStringCellValue());
        assertEquals("1. 打开登录页\n2. 提交", sheet.getRow(1).getCell(6).getStringCellValue());
        assertEquals("1. 出现输入框\n2. 进入首页", sheet.getRow(1).getCell(7).getStringCellValue());
        assertEquals("失败", sheet.getRow(1).getCell(8).getStringCellValue());
        assertEquals("2026-11-15 09:05", sheet.getRow(1).getCell(10).getStringCellValue());
        assertTrue(((org.apache.poi.xssf.usermodel.XSSFCellStyle) sheet.getRow(0).getCell(0)
                .getCellStyle()).getFont().getBold(), "表头加粗");
        assertEquals("FF2563EB", headerFill(sheet), "表头品牌蓝底");
        assertTrue(sheet.getRow(1).getCell(1).getCellStyle().getWrapText(), "长文本自动换行");
        assertTrue(sheet.getColumnWidth(1) > 30 * 256, "标题列宽按内容设定");
        assertNotNull(sheet.getPaneInformation(), "冻结表头与编号列");
        assertTrue(((org.apache.poi.xssf.usermodel.XSSFSheet) sheet).getCTWorksheet().isSetAutoFilter(),
                "全表启用筛选");
        assertEquals("FFFEF3F2", ((org.apache.poi.xssf.usermodel.XSSFCellStyle) sheet.getRow(1)
                .getCell(3).getCellStyle()).getFillForegroundColorColor().getARGBHex(), "P0 浅红底");
        book.close();
    }

    @Test
    void xlsxImportPairsStepsAndKeepsBlankExpectedPosition() throws Exception {
        byte[] book = workbook(new String[][]{
                {"标题", "模块", "优先级", "前置条件", "测试步骤", "预期结果", "最近结果"},
                {"登录", "账号体系", "P0", "", "1. 打开登录页\n2. 输入密码\n3. 提交", "1. 出现输入框\n\n3. 进入首页", "通过"},
                {"坏优先级", "", "P9", "", "", "", ""}
        });
        Map<String, Object> out = service.importExcel(USER, WS, REQ, book);
        assertEquals(2, out.get("total"));
        assertEquals(1, out.get("created"));
        assertEquals(1, out.get("failed"));
        @SuppressWarnings("unchecked")
        List<String> ignored = (List<String>) out.get("ignored");
        assertTrue(ignored.contains("最近结果"), "只读执行列明确回报忽略");
        org.mockito.ArgumentCaptor<TestCase> captor =
                org.mockito.ArgumentCaptor.forClass(TestCase.class);
        verify(cases).insert(captor.capture());
        List<Map<String, String>> steps = new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(captor.getValue().getSteps(),
                        new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, String>>>() { });
        assertEquals(3, steps.size(), "空预期保留位置，不把第 3 步预期错配给第 2 步");
        assertEquals("打开登录页", steps.get(0).get("action"));
        assertEquals("出现输入框", steps.get(0).get("expected"));
        assertEquals("输入密码", steps.get(1).get("action"));
        assertEquals(null, steps.get(1).get("expected"));
        assertEquals("进入首页", steps.get(2).get("expected"));
    }

    @Test
    void xlsxImportFindsHeaderBelowTitleRow() {
        byte[] book = workbook(new String[][]{
                {"XX 系统测试用例", "", ""},
                {"用例名称", "模块", "优先级"},
                {"登录", "账号体系", "P1"}
        });
        Map<String, Object> out = service.importExcel(USER, WS, REQ, book);
        assertEquals(Boolean.TRUE, out.get("headerMode"));
        assertEquals(1, out.get("total"));
        assertEquals(1, out.get("created"));
    }

    @Test
    void xlsxExportCanBeImportedBack() throws Exception {
        TestCaseView v = new TestCaseView();
        v.setCaseNo(3);
        v.setTitle("导出的用例");
        v.setModule("账号体系");
        v.setPriority("P1");
        v.setPrecondition("已注册");
        v.setTestData("demo/123456");
        v.setStepsJson("[{\"action\":\"打开登录页\",\"expected\":\"出现输入框\"},{\"action\":\"提交\",\"expected\":\"进入首页\"}]");
        v.setLatestStatus("passed");
        v.setLatestBy("测试同学");
        v.setLatestAt(java.time.LocalDateTime.of(2026, 11, 15, 10, 0));
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        rows.add(v);
        when(cases.selectViewByReq(WS, REQ)).thenReturn(rows);

        byte[] exported = service.exportXlsx(WS, USER, REQ);
        Map<String, Object> out = service.importExcel(USER, WS, REQ, exported);
        assertEquals(1, out.get("total"));
        assertEquals(1, out.get("created"), "导出文件可原样回导");
        assertEquals(0, out.get("failed"));
        assertEquals(Boolean.TRUE, out.get("renumbered"));
        @SuppressWarnings("unchecked")
        List<String> ignored = (List<String>) out.get("ignored");
        assertTrue(ignored.contains("最近结果") && ignored.contains("执行人")
                && ignored.contains("执行时间") && ignored.contains("最近备注"));

        org.mockito.ArgumentCaptor<TestCase> captor =
                org.mockito.ArgumentCaptor.forClass(TestCase.class);
        verify(cases).insert(captor.capture());
        assertEquals("导出的用例", captor.getValue().getTitle());
        assertEquals("P1", captor.getValue().getPriority());
        assertTrue(captor.getValue().getSteps().contains("打开登录页"));
        assertTrue(captor.getValue().getSteps().contains("进入首页"));
    }

    @Test
    void xlsImportIsSupported() throws Exception {
        org.apache.poi.hssf.usermodel.HSSFWorkbook book = new org.apache.poi.hssf.usermodel.HSSFWorkbook();
        org.apache.poi.ss.usermodel.Sheet sheet = book.createSheet("用例");
        String[] header = {"用例名称", "模块", "优先级", "测试步骤", "预期结果"};
        org.apache.poi.ss.usermodel.Row h = sheet.createRow(0);
        for (int i = 0; i < header.length; i++) {
            h.createCell(i).setCellValue(header[i]);
        }
        org.apache.poi.ss.usermodel.Row r = sheet.createRow(1);
        r.createCell(0).setCellValue("老格式表格");
        r.createCell(1).setCellValue("账号体系");
        r.createCell(2).setCellValue("P2");
        r.createCell(3).setCellValue("1. 打开登录页");
        r.createCell(4).setCellValue("1. 出现输入框");
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        book.write(out);
        book.close();

        Map<String, Object> result = service.importExcel(USER, WS, REQ, out.toByteArray());
        assertEquals(1, result.get("created"));
        assertEquals(0, result.get("failed"));
        verify(cases).insert(any(TestCase.class));
    }

    @Test
    void xlsxTemplateHasExampleInstructionsAndPriorityValidation() throws Exception {
        org.apache.poi.ss.usermodel.Workbook book = new org.apache.poi.xssf.usermodel.XSSFWorkbook(
                new java.io.ByteArrayInputStream(service.templateXlsx()));
        assertEquals(2, book.getNumberOfSheets());
        org.apache.poi.ss.usermodel.Sheet sheet = book.getSheetAt(0);
        assertEquals("测试步骤", sheet.getRow(0).getCell(6).getStringCellValue());
        assertTrue(sheet.getRow(1).getCell(6).getStringCellValue().contains("\n"), "示例行含多步骤");
        assertEquals(1, sheet.getDataValidations().size(), "优先级带下拉校验");
        assertEquals("填写说明", book.getSheetAt(1).getSheetName());
        book.close();
    }

    private static byte[] workbook(String[][] rows) {
        try {
            org.apache.poi.xssf.usermodel.XSSFWorkbook book = new org.apache.poi.xssf.usermodel.XSSFWorkbook();
            org.apache.poi.ss.usermodel.Sheet sheet = book.createSheet("用例");
            for (int r = 0; r < rows.length; r++) {
                org.apache.poi.ss.usermodel.Row row = sheet.createRow(r);
                for (int c = 0; c < rows[r].length; c++) {
                    row.createCell(c).setCellValue(rows[r][c]);
                }
            }
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            book.write(out);
            book.close();
            return out.toByteArray();
        } catch (java.io.IOException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String headerFill(org.apache.poi.ss.usermodel.Sheet sheet) {
        org.apache.poi.xssf.usermodel.XSSFCellStyle style =
                (org.apache.poi.xssf.usermodel.XSSFCellStyle) sheet.getRow(0).getCell(0).getCellStyle();
        return style.getFillForegroundColorColor().getARGBHex();
    }
}
