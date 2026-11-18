package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

@Data
public class ReqSaveRequest {

    /** 选填：导入时由前端指定 ID，不填则服务端生成 */
    @Size(max = 32, message = "需求ID不合法")
    private String id;

    @NotBlank(message = "请填写需求名称")
    @Size(max = 40, message = "需求名称不能超过 40 字")
    private String name;

    @Size(max = 1000, message = "需求描述不能超过 1000 字")
    private String description;

    @Size(max = 400, message = "项目目标不能超过 400 字")
    private String objective;

    @Size(max = 32, message = "项目负责人不合法")
    private String ownerUserId;

    /**
     * 所属项目集：空串表示解除归组；字段不出现（旧客户端）时编辑不改归组关系。
     * 用显式 setter 记录「请求里是否带了这个字段」，避免旧客户端整表保存时把项目集清空。
     */
    @Size(max = 32, message = "项目集不合法")
    private String setId;

    @com.fasterxml.jackson.annotation.JsonIgnore
    private boolean setIdPresent;

    public void setSetId(String setId) {
        this.setId = setId;
        this.setIdPresent = true;
    }

    private java.time.LocalDate plannedStart;
    private java.time.LocalDate plannedEnd;

    @Pattern(regexp = "active|done|hold", message = "需求状态不合法")
    private String status = "active";

    /**
     * 选填，仅编辑生效：打开表单时项目的 updatedAt。传了就做乐观锁，
     * 别人已保存过（updated_at 变了）返回 409，避免整表覆盖对方的修改。
     */
    private java.time.LocalDateTime updatedAt;

    /** 仅新建时生效：blank / standard / test；留空按空白项目处理 */
    @Pattern(regexp = "^(blank|standard|test)?$", message = "项目模板不合法")
    private String template;

    /**
     * 仅新建时生效：创建时一并授予项目权限的成员。
     * 复用 project_member，不新增表结构；未出现的成员仍按空间默认范围处理。
     */
    @Valid
    private List<MemberGrant> members;

    @Data
    public static class MemberGrant {
        @Size(max = 32, message = "成员ID不合法")
        private String userId;
        /** write=可参与（默认），read=只读 */
        @Pattern(regexp = "^(write|read)?$", message = "项目权限不合法")
        private String access;
    }
}
