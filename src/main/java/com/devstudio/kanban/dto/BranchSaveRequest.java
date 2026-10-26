package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 分支新建 / 编辑请求。状态变更走单独的 {@link BranchStatusRequest}（那条要写时间线与时间点）。 */
@Data
public class BranchSaveRequest {

    /**
     * 分支名：允许字母（含中文）、数字、点、下划线、中划线、斜杠 —— 覆盖 git 的常见命名。
     * 空格和 @{}~^:?*[\ 这些 git 本身也不接受，这里一并挡掉。
     */
    @Pattern(regexp = "^[\\p{L}\\p{N}._/-]{1,80}$",
             message = "分支名只允许字母、数字、点、下划线、中划线、斜杠（80 字以内）")
    private String name;

    /** 选填：编辑时不传表示保持不变；新建时不传默认 dev */
    @Pattern(regexp = "dev|testing|merging|released|", message = "分支状态不合法")
    private String status;

    @Size(max = 32, message = "负责人不能超过 32 字")
    private String owner;

    @Size(max = 32, message = "负责人账号ID不合法")
    private String ownerUserId;

    @Size(max = 80, message = "目标分支不能超过 80 字")
    private String targetBranch;

    @Size(max = 200, message = "备注不能超过 200 字")
    private String note;
}
