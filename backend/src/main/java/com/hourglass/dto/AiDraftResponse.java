package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 字段级 AI 草稿：只回给表单，服务端不落库、不自动保存 */
@Data
public class AiDraftResponse {

    private String kind;
    private List<String> items = new ArrayList<String>();
    /** 信息不足时的补充提示，例如还需要补哪类信息；正常可为空 */
    private String note;
    private AiUsage usage;
}
