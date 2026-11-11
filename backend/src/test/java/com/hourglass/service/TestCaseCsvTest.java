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
    private final TestCaseService service = new TestCaseService(cases,
            mock(TestCaseRunMapper.class), mock(TaskCommandService.class),
            mock(ProjectAccessService.class), reqs,
            mock(com.hourglass.mapper.DemandMapper.class),
            mock(com.hourglass.mapper.TestModuleMapper.class),
            mock(com.hourglass.mapper.AttachmentMapper.class),
            mock(AttachmentService.class),
            mock(com.hourglass.mapper.TestPlanMapper.class),
            mock(com.hourglass.mapper.TestPlanCaseMapper.class),
            auditService);

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
                isNull(), eq(true), contains("成功 2 条，失败 1 条"), isNull());
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
        v.setTitle("登录,成功");
        v.setModule("账号\"核心\"");
        v.setPriority("P0");
        v.setPrecondition("已注册");
        v.setStepsJson("[{\"action\":\"打开,登录页\",\"expected\":\"出现 \\\"输入框\\\"\"},{\"action\":\"输入密码\",\"expected\":\"\"}]");
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        rows.add(v);
        when(cases.selectViewByReq(WS, REQ)).thenReturn(rows);

        byte[] out = service.exportCsv(WS, USER, REQ);
        String text = new String(out, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("\uFEFF"));
        List<List<String>> parsed = Csv.parse(text);
        assertEquals(2, parsed.size());
        assertEquals("登录,成功", parsed.get(1).get(0));
        assertEquals("账号\"核心\"", parsed.get(1).get(1));
        assertEquals("打开,登录页 => 出现 \"输入框\"\n输入密码", parsed.get(1).get(4));
    }

    @Test
    void templateHasHeaderAndExample() {
        List<List<String>> rows = Csv.parse(new String(service.templateCsv(), StandardCharsets.UTF_8));
        assertEquals(2, rows.size());
        assertEquals("标题", rows.get(0).get(0));
        assertTrue(rows.get(1).get(4).contains("=>"));
    }
}
