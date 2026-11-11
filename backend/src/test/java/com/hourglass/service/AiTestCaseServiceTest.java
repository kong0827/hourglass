package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.dto.AiCaseDraft;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/** AI 用例草稿的清洗口径：标题/步骤为空的不入库，长度与优先级统一收口 */
class AiTestCaseServiceTest {

    private final ObjectMapper om = new ObjectMapper();

    @Test
    void trimCollapsesWhitespaceAndCuts() {
        assertEquals("登录 失败", AiTestCaseService.trim("  登录 \n 失败 ", 20));
        assertEquals("12345", AiTestCaseService.trim("123456", 5));
        assertEquals("", AiTestCaseService.trim(null, 5));
    }

    @Test
    void parseDraftNormalizesFieldsAndDropsBlankSteps() throws Exception {
        JsonNode n = om.readTree("{\"title\":\"  登录失败时提示错误 \",\"precondition\":\" 已注册账号 \","
                + "\"module\":\" 登录 \",\"priority\":\"high\",\"reason\":\" 覆盖密码校验 \","
                + "\"steps\":[{\"action\":\"输入错误密码\",\"expected\":\"提示密码错误\"},"
                + "{\"action\":\"   \",\"expected\":\"忽略这条\"}]}");
        AiCaseDraft d = AiTestCaseService.parseDraft(n);
        assertNotNull(d);
        assertEquals("登录失败时提示错误", d.getTitle());
        assertEquals("已注册账号", d.getPrecondition());
        assertEquals("登录", d.getModule());
        assertEquals("P0", d.getPriority());
        assertEquals("覆盖密码校验", d.getReason());
        assertEquals(1, d.getSteps().size());
        assertEquals("输入错误密码", d.getSteps().get(0).getAction());
    }

    @Test
    void parseDraftRejectsMissingTitleOrSteps() throws Exception {
        assertNull(AiTestCaseService.parseDraft(om.readTree("{\"title\":\"  \",\"steps\":[{\"action\":\"a\"}]}")));
        assertNull(AiTestCaseService.parseDraft(om.readTree("{\"title\":\"有标题没步骤\",\"steps\":[]}")));
    }

    @Test
    void parseDraftCapsSteps() throws Exception {
        StringBuilder steps = new StringBuilder();
        for (int i = 0; i < 20; i++) {
            if (i > 0) {
                steps.append(',');
            }
            steps.append("{\"action\":\"步骤").append(i).append("\",\"expected\":\"结果").append(i).append("\"}");
        }
        AiCaseDraft d = AiTestCaseService.parseDraft(om.readTree(
                "{\"title\":\"步骤上限\",\"steps\":[" + steps + "]}"));
        assertNotNull(d);
        assertEquals(12, d.getSteps().size());
    }
}
