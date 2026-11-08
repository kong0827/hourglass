package com.hourglass.service;

import com.hourglass.common.AppException;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Word 导入为文档正文：docx 保留排版，doc 提取文本，返回清洗后的 HTML。 */
class RequirementDocImportWordTest {

    private final DocPreviewService previewService = mock(DocPreviewService.class);
    private final RequirementDocService docService = new RequirementDocService(
            mock(com.hourglass.mapper.RequirementDocMapper.class),
            mock(com.hourglass.mapper.RequirementDocHistoryMapper.class),
            mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            mock(com.hourglass.mapper.RequirementMapper.class),
            mock(com.hourglass.mapper.UserMapper.class),
            mock(com.hourglass.mapper.TaskMapper.class),
            mock(WorkActivityService.class),
            mock(com.hourglass.mapper.DemandMapper.class),
            mock(ProjectAccessService.class),
            mock(NotificationEventService.class),
            mock(com.hourglass.mapper.ReqDocShareMapper.class),
            mock(com.hourglass.mapper.WorkspaceMapper.class),
            previewService);

    private Map<String, String> previewResult(String content) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        m.put("type", "html");
        m.put("content", content);
        return m;
    }

    @Test
    void importsDocxHtmlAndSanitizes() {
        when(previewService.preview(any(File.class), eq("docx")))
                .thenReturn(previewResult("<html><body><p>Hello</p><script>alert(1)</script></body></html>"));

        String html = docService.importWord(mock(File.class));

        assertTrue(html.contains("<p>Hello</p>"));
        assertTrue(!html.contains("<script>"));
    }

    @Test
    void importsLegacyDocUsingDocConverter() {
        when(previewService.preview(any(File.class), eq("doc")))
                .thenReturn(previewResult("<html><body><p>Legacy</p></body></html>"));

        String html = docService.importWord(mock(File.class), "doc");

        assertTrue(html.contains("<p>Legacy</p>"));
    }

    @Test
    void emptyPreviewContentIsRejected() {
        when(previewService.preview(any(File.class), eq("docx")))
                .thenReturn(previewResult("   "));

        AppException ex = assertThrows(AppException.class, () -> docService.importWord(mock(File.class)));
        assertEquals(400, ex.getCode());
    }
}
