package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiSelectionRequest;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 选区处理的纯函数口径：剥外壳 / 字数上限 / 操作类型归一 */
class AiSelectionServiceTest {

    /** 空间级文档没有归属项目，不能提工作项；提示要告诉用户先选项目，且不消耗模型调用 */
    @Test
    void tasksRejectsSpaceLevelDocBeforeCallingModel() {
        RequirementDocService docService = mock(RequirementDocService.class);
        AiConfigService configService = mock(AiConfigService.class);
        AiClient client = mock(AiClient.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        RequirementDoc doc = new RequirementDoc();
        doc.setId("doc1");
        doc.setTitle("空间文档");
        doc.setReqId(null);
        when(docService.getVisible("w1", "u1", "doc1")).thenReturn(doc);

        AiSelectionService svc = new AiSelectionService(docService, configService, client, taskMapper);
        AiSelectionRequest req = new AiSelectionRequest();
        req.setAction("to_task");
        req.setSelection("这里是一段可以拆成任务的话");

        AppException ex = assertThrows(AppException.class, () -> svc.tasks("u1", "w1", "doc1", req));
        assertEquals(400, ex.getCode());
        assertEquals("空间级文档不属于任何项目，先给文档选一个归属项目，再提为工作项", ex.getMessage());
        verify(client, never()).chat(any(), any(), any(), anyBoolean());
    }

    @Test
    void sanitizeStripsCodeFenceAndQuotes() {
        assertEquals("先校验流水号，再出金。",
                AiSelectionService.sanitizeOutput("```text\n先校验流水号，再出金。\n```"));
        assertEquals("先校验流水号，再出金。",
                AiSelectionService.sanitizeOutput("“先校验流水号，再出金。”"));
        assertEquals("先校验流水号，再出金。",
                AiSelectionService.sanitizeOutput("\"先校验流水号，再出金。\""));
    }

    /** 引号只剥外壳：正文里本来就有的引号必须原样保留 */
    @Test
    void sanitizeKeepsInnerQuotesAndParagraphs() {
        String out = AiSelectionService.sanitizeOutput("他说“先校验”，再出金。\n\n\n第二段。");
        assertEquals("他说“先校验”，再出金。\n\n第二段。", out);
    }

    @Test
    void sanitizeEmptyAndNull() {
        assertEquals("", AiSelectionService.sanitizeOutput(null));
        assertEquals("", AiSelectionService.sanitizeOutput("   \n  "));
        assertEquals("", AiSelectionService.sanitizeOutput("```\n```"));
    }

    @Test
    void cleanSelectionRejectsTooShortAndTooLong() {
        assertEquals(400, assertThrows(AppException.class,
                () -> AiSelectionService.cleanSelection("短")).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> AiSelectionService.cleanSelection(repeat("字", 3001))).getCode());
        assertEquals("四个字符", AiSelectionService.cleanSelection("  四个字符  "));
    }

    @Test
    void normalizeActionRejectsUnknown() {
        assertEquals("to_task", AiSelectionService.normalizeAction("TO_TASK"));
        assertEquals("expand", AiSelectionService.normalizeAction(" Expand "));
        assertEquals(400, assertThrows(AppException.class,
                () -> AiSelectionService.normalizeAction("translate")).getCode());
    }

    /** 待确认假设的清洗口径：去空白、按字截断、超过 4 条丢弃；非数组或全空返回空列表 */
    @Test
    void textListCleansAndCapsItems() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.JsonNode root = om.readTree(
                "{\"assumptions\":[\" 需要确认超时时间 \",\"\",\"   \",\""
                        + repeat("字", 70) + "\",\"第四条\",\"第五条\"]}");
        java.util.List<String> out = AiSelectionService.textList(root, "assumptions", 40, 4);
        assertEquals(4, out.size());
        assertEquals("需要确认超时时间", out.get(0));
        assertEquals(40, AiSelectionService.charCount(out.get(1)));
        assertEquals("第四条", out.get(2));
        assertEquals("第五条", out.get(3));
        assertEquals(0, AiSelectionService.textList(root, "missing", 40, 4).size());
        assertEquals(0, AiSelectionService.textList(null, "assumptions", 40, 4).size());
    }

    /** 字数按码点算：一个 emoji 算一个字，和前端「N 字」口径一致 */
    @Test
    void charCountUsesCodePoints() {
        assertEquals(2, AiSelectionService.charCount("字😀"));
        assertEquals(0, AiSelectionService.charCount(null));
    }

    /** 超长截断按码点切：不能把 emoji 的代理对切成半个字符写回文档 */
    @Test
    void sanitizeTruncatesAtCodePointBoundary() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 5999; i++) {
            sb.append('a');
        }
        sb.append("😀").append('b');
        String out = AiSelectionService.sanitizeOutput(sb.toString());
        assertEquals(6000, AiSelectionService.charCount(out));
        assertEquals("😀", out.substring(out.length() - 2));
    }

    /** 扩写：正文与待确认假设分开返回，替换只用到 text */
    @Test
    void expandKeepsAssumptionsOutOfText() {
        RequirementDocService docService = mock(RequirementDocService.class);
        AiConfigService configService = mock(AiConfigService.class);
        AiClient client = mock(AiClient.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        RequirementDoc doc = new RequirementDoc();
        doc.setId("doc1");
        doc.setTitle("字段说明");
        doc.setFormat("markdown");
        when(docService.getVisible("w1", "u1", "doc1")).thenReturn(doc);
        when(configService.resolve("u1", "w1")).thenReturn(new com.hourglass.dto.AiConfig());
        AiClient.Reply reply = new AiClient.Reply();
        reply.content = "{\"text\":\"字段说明表列出三个字段。\",\"assumptions\":[\" 超时策略待确认 \",\"\"]}";
        when(client.chat(any(), any(), any(), anyBoolean())).thenReturn(reply);

        AiSelectionService svc = new AiSelectionService(docService, configService, client, taskMapper);
        AiSelectionRequest req = new AiSelectionRequest();
        req.setAction("expand");
        req.setSelection("字段说明表列出三个字段：id、status、updatedAt。");

        com.hourglass.dto.AiSelectionResponse res = svc.transform("u1", "w1", "doc1", req);
        assertEquals("expand", res.getAction());
        assertEquals("字段说明表列出三个字段。", res.getText());
        assertEquals(1, res.getNotes().size());
        assertEquals("超时策略待确认", res.getNotes().get(0));
    }

    /** 模型不按 JSON 返回时降级为纯文本建议，不能直接报错丢掉结果 */
    @Test
    void expandFallsBackToPlainTextWhenJsonMissing() {
        RequirementDocService docService = mock(RequirementDocService.class);
        AiConfigService configService = mock(AiConfigService.class);
        AiClient client = mock(AiClient.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        RequirementDoc doc = new RequirementDoc();
        doc.setId("doc1");
        doc.setTitle("字段说明");
        doc.setFormat("markdown");
        when(docService.getVisible("w1", "u1", "doc1")).thenReturn(doc);
        when(configService.resolve("u1", "w1")).thenReturn(new com.hourglass.dto.AiConfig());
        AiClient.Reply reply = new AiClient.Reply();
        reply.content = "```text\n字段说明表列出三个字段。\n```";
        when(client.chat(any(), any(), any(), anyBoolean())).thenReturn(reply);

        AiSelectionService svc = new AiSelectionService(docService, configService, client, taskMapper);
        AiSelectionRequest req = new AiSelectionRequest();
        req.setAction("expand");
        req.setSelection("字段说明表列出三个字段：id、status、updatedAt。");

        com.hourglass.dto.AiSelectionResponse res = svc.transform("u1", "w1", "doc1", req);
        assertEquals("字段说明表列出三个字段。", res.getText());
        assertEquals(0, res.getNotes().size());
    }

    /** 「提要求」：用户补的一句话必须进入提示词，而不是只存在前端 */
    @Test
    void instructionReachesRewritePrompt() {
        RequirementDocService docService = mock(RequirementDocService.class);
        AiConfigService configService = mock(AiConfigService.class);
        AiClient client = mock(AiClient.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        RequirementDoc doc = new RequirementDoc();
        doc.setId("doc1");
        doc.setTitle("字段说明");
        doc.setFormat("html");
        when(docService.getVisible("w1", "u1", "doc1")).thenReturn(doc);
        when(configService.resolve("u1", "w1")).thenReturn(new com.hourglass.dto.AiConfig());
        AiClient.Reply reply = new AiClient.Reply();
        reply.content = "建议文本";
        when(client.chat(any(), any(), any(), anyBoolean())).thenReturn(reply);

        AiSelectionService svc = new AiSelectionService(docService, configService, client, taskMapper);
        AiSelectionRequest req = new AiSelectionRequest();
        req.setAction("rewrite");
        req.setSelection("字段说明表列出三个字段：id、status、updatedAt。");
        req.setInstruction("面向非技术读者，语气更正式");

        svc.transform("u1", "w1", "doc1", req);

        org.mockito.ArgumentCaptor<String> userPrompt = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(client).chat(any(), any(), userPrompt.capture(), anyBoolean());
        assertTrue(userPrompt.getValue().contains("面向非技术读者，语气更正式"));
    }

    private static String repeat(String unit, int times) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < times; i++) {
            sb.append(unit);
        }
        return sb.toString();
    }
}
