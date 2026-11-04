package com.devstudio.kanban.entity;

/** 文档分类；与文档层级、正文格式和需求/工作项关联相互独立。 */
public enum DocumentType {
    REQUIREMENT("requirement", "需求文档"),
    TECHNICAL("technical", "技术方案"),
    ACCEPTANCE("acceptance", "测试验收"),
    OTHER("other", "其他");

    public static final String SAVE_PATTERN = "^(requirement|technical|acceptance|other)?$";

    private final String code;
    private final String label;

    DocumentType(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String getCode() {
        return code;
    }

    public String getLabel() {
        return label;
    }

    public static DocumentType parse(String code) {
        if (code != null) {
            for (DocumentType type : values()) {
                if (type.code.equals(code.trim())) {
                    return type;
                }
            }
        }
        return null;
    }

    /** 旧数据、旧备份及无效外部分类统一归入其他，不推测分类。 */
    public static DocumentType parseOrOther(String code) {
        DocumentType type = parse(code);
        return type == null ? OTHER : type;
    }
}
