package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;
import java.util.List;

@Data
public class TaskCommentRequest {

    @NotBlank(message = "评论内容不能为空")
    @Size(max = 500, message = "评论最多 500 字")
    private String content;

    /** 前端从候选列表选中的成员；与正文里的 @名字 合并去重，重名时也能精确通知 */
    @Size(max = 20, message = "一次最多提及 20 人")
    private List<String> mentionUserIds;
}
