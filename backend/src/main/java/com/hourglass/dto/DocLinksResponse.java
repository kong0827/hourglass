package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/**
 * 文档引用响应：visible 为当前用户可见的目标列表；
 * hiddenCount 为存在但无权查看或已删除的引用数，只给计数不泄露标题。
 */
@Data
public class DocLinksResponse {
    private List<DocLinkView> visible;
    private int hiddenCount;
}
