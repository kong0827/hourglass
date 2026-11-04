package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.DocumentType;
import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 新建 / 保存文档 */
@Data
public class ReqDocSaveRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目不合法")
    private String reqId;

    @NotBlank(message = "文档标题不能为空")
    @Size(max = 100, message = "标题最多 100 字")
    private String title;

    /** 分类；新建省略归入其他，编辑省略沿用原分类 */
    @Pattern(regexp = DocumentType.SAVE_PATTERN, message = "文档分类不合法")
    private String docType;

    /** 父文档 ID（可选，同项目内层级） */
    @Size(max = 32, message = "上级文档不合法")
    private String parentId;

    /** 正文：html 会做白名单清洗；markdown 原样保存并在前端渲染 */
    private String content;

    /** html / markdown；新建时为空按 markdown 处理 */
    @Pattern(regexp = "^(html|markdown)?$", message = "正文格式不合法")
    private String format;

    /** draft / active / done，空则按 draft */
    @Pattern(regexp = "^(draft|active|done)?$", message = "文档状态不合法")
    private String status;

    @Size(max = 32, message = "负责人不合法")
    private String owner;

    /**
     * 乐观锁：打开文档时拿到的 updatedAt，原样带回。
     * 他人先保存导致版本变化时整篇保存被拒绝（409），避免静默覆盖。
     * 为空表示旧客户端/旧数据，跳过校验保持兼容。
     */
    @Size(max = 40, message = "文档版本不合法")
    private String updatedAt;
}
