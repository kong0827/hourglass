package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 选区处理结果：只是**建议**，不回写文档。
 * 用户点「替换」后由前端写回编辑器，再走正常保存（保存时服务端自动留历史版本）。
 */
@Data
public class AiSelectionResponse {

    private String action;

    /** rewrite/shorten：替换文本（纯文本，段落之间空一行）；explain：解释正文 */
    private String text;

    /** explain 专用：可能引起误解或原文没写清的地方；rewrite/shorten 为空 */
    private List<String> notes = new ArrayList<String>();

    private int beforeChars;
    private int afterChars;
    private AiUsage usage;
}
