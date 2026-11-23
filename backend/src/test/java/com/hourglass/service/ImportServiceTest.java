package com.hourglass.service;

import com.hourglass.common.Csv;
import com.hourglass.dto.ImportPreview;
import com.hourglass.dto.ImportRequest;
import com.hourglass.dto.ImportResult;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Excel / CSV 迁移导入：模板列宽、自动映射、显式忽略、失败行回执与 1000 行批量口径。 */
class ImportServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final RequirementService requirements = mock(RequirementService.class);
    private final TaskQueryService taskQuery = mock(TaskQueryService.class);
    private final TaskCommandService taskCommand = mock(TaskCommandService.class);
    private final DemandService demands = mock(DemandService.class);
    private final TestCaseService testCases = mock(TestCaseService.class);
    private final TimeLogService timeLogs = mock(TimeLogService.class);
    private final BoardColumnMapper columns = mock(BoardColumnMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);

    private ImportService service;

    @BeforeEach
    void setUp() {
        ReqProgress project = new ReqProgress();
        project.setId("P1");
        project.setName("示例项目");
        when(requirements.list(WS, USER)).thenReturn(Collections.singletonList(project));

        WorkspaceMember zhang = new WorkspaceMember();
        zhang.setWorkspaceId(WS);
        zhang.setUserId("U2");
        zhang.setDisplayName("张三");
        zhang.setUsername("zhangsan");
        when(members.selectByWorkspace(WS)).thenReturn(Collections.singletonList(zhang));
        when(columns.selectAll(WS)).thenReturn(Collections.emptyList());
        when(access.canWrite(WS, USER, "P1")).thenReturn(true);

        service = new ImportService(requirements, taskQuery, taskCommand, demands, testCases,
                timeLogs, columns, members, users, tasks, access);
    }

    @Test
    void worklogTemplateRowsMatchHeaderWidth() {
        String csv = new String(service.template("worklog"), StandardCharsets.UTF_8);
        List<List<String>> rows = Csv.parse(csv);
        assertEquals(3, rows.size());
        for (List<String> row : rows) {
            assertEquals(6, row.size(), "模板每行都应与 6 个表头对齐");
        }
        assertEquals("工作项*", rows.get(0).get(0));
    }

    @Test
    void previewAutoMapsChineseHeadersAndCountsInvalidRows() {
        String csv = String.join("\r\n",
                Csv.row("标题", "项目", "负责人", "优先级", "截止日期"),
                Csv.row("登录页改版", "示例项目", "张三", "P2", "2026-12-10"),
                Csv.row("", "示例项目", "", "", ""),
                Csv.row("支付回调超时", "示例项目", "", "P9", ""));

        ImportPreview preview = service.preview(WS, USER, request("task", csv));

        assertEquals(3, preview.getTotal());
        assertEquals(1, preview.getValid());
        assertEquals(2, preview.getInvalid());
        assertEquals("标题", preview.getMapping().get("title"));
        assertEquals("负责人", preview.getMapping().get("owner"));
        assertTrue(preview.getRows().get(0).isOk());
        assertEquals("登录页改版", preview.getRows().get(0).getTitle());
    }

    @Test
    void explicitIgnoreSkipsAutoMappingForOptionalField() {
        String csv = String.join("\r\n",
                Csv.row("标题", "项目", "描述"),
                Csv.row("登录页改版", "示例项目", "替换文案"));
        ImportRequest req = request("task", csv);
        req.setMapping(Collections.singletonMap("description", "__ignore__"));

        ImportPreview preview = service.preview(WS, USER, req);

        assertFalse(preview.getMapping().containsKey("description"));
        assertTrue(preview.getIgnored().contains("描述"));
        assertEquals(1, preview.getValid());
    }

    @Test
    void commitReturnsReceiptAndFailedCsvForBadRows() {
        String csv = String.join("\r\n",
                Csv.row("标题", "项目", "优先级"),
                Csv.row("登录页改版", "示例项目", "P2"),
                Csv.row("", "示例项目", ""),
                Csv.row("支付回调超时", "示例项目", "P1"));

        ImportResult result = service.commit(WS, USER, request("task", csv));

        assertEquals(3, result.getTotal());
        assertEquals(2, result.getCreated());
        assertEquals(1, result.getFailed());
        assertEquals(1, result.getErrors().size());
        assertTrue(result.getFailedCsv().contains("错误原因"));
        assertTrue(result.getFailedCsv().contains("标题必填"));
        verify(taskCommand, times(2)).create(eq(USER), eq(WS), any(TaskSaveRequest.class));
    }

    @Test
    void thousandRowsKeepSuccessAboveNinetyFivePercent() {
        StringBuilder csv = new StringBuilder(Csv.row("标题", "项目")).append("\r\n");
        for (int i = 0; i < 1000; i++) {
            csv.append(Csv.row(i < 960 ? ("迁移任务" + i) : "", "示例项目")).append("\r\n");
        }

        ImportPreview preview = service.preview(WS, USER, request("task", csv.toString()));
        assertEquals(1000, preview.getTotal());
        assertEquals(960, preview.getValid());
        assertEquals(40, preview.getInvalid());
        assertTrue(preview.getValid() * 100 >= preview.getTotal() * 95, "通过率应达到 95%");
        assertTrue(preview.isTruncated());

        ImportResult result = service.commit(WS, USER, request("task", csv.toString()));
        assertEquals(960, result.getCreated());
        assertEquals(40, result.getFailed());
        verify(taskCommand, times(960)).create(anyString(), eq(WS), any(TaskSaveRequest.class));
    }

    @Test
    void gbkEncodedCsvFileIsDecodedInsteadOfGarbled() {
        String csv = String.join("\r\n",
                Csv.row("标题", "项目"),
                Csv.row("登录页改版", "示例项目"));
        ImportRequest req = new ImportRequest();
        req.setKind("task");
        req.setFileName("任务.csv");
        req.setFile(java.util.Base64.getEncoder().encodeToString(
                csv.getBytes(java.nio.charset.Charset.forName("GB18030"))));

        ImportPreview preview = service.preview(WS, USER, req);

        assertEquals(1, preview.getTotal());
        assertEquals(1, preview.getValid());
        assertEquals("标题", preview.getMapping().get("title"));
        assertEquals("登录页改版", preview.getRows().get(0).getTitle());
    }

    private static ImportRequest request(String kind, String csv) {
        ImportRequest req = new ImportRequest();
        req.setKind(kind);
        req.setCsv(csv);
        return req;
    }
}
