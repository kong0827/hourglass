package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiSelectionRequest;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
        assertEquals(400, assertThrows(AppException.class,
                () -> AiSelectionService.normalizeAction("translate")).getCode());
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

    private static String repeat(String unit, int times) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < times; i++) {
            sb.append(unit);
        }
        return sb.toString();
    }
}
